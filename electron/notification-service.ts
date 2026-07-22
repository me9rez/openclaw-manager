// ---------------------------------------------------------------------------
// 通知服务
// ---------------------------------------------------------------------------
//
// 设计目标:
//   - 单例。Manager 进程内只允许有一个通知服务,所有 GatewayClient 通过
//     `getNotificationService()` 拿到同一份状态(配置、聚合窗口、监听器)。
//   - 路由:把网关推过来的 event 帧映射成 title/body/icon/sound 模板。
//   - 聚合:同实例同事件在 `aggregateWindowSec` 内的多条合并为一条,
//     防止高并发 agent 时把通知中心炸穿。
//   - 静默时段:按本地时间窗判断,跨夜支持(22:00 → 08:00 视作
//     22:00-23:59 + 00:00-08:00)。
//   - 点击交互:点击通知 → emit "click" 事件,main.ts 监听后唤起窗口 +
//     切到对应实例 tab。
//
// 不依赖任何外部 npm 包,只用 Node 内置 EventEmitter + Electron Notification。

import { EventEmitter } from "events";
import { Notification, nativeImage } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getNotificationConfig, type NotificationConfig } from "./store";

// ---------------------------------------------------------------------------
// 路由表:event 名 → 模板
// ---------------------------------------------------------------------------
//
// 实际 OpenClaw 网关下发的 event 帧并不像 plugin hooks 文档里的
// "agent.end" / "run.end" 那样顶层命名,而是统一叫 "agent" / "chat",
// 完成/错误/中断在 payload 内部用 stream / state 区分(见 debug log
// 里的 agent.lifecycle 与 chat.final 帧)。
//
// 匹配模型从「精确字符串」改成「顶层 event 名 + 谓词函数」,这样以后
// 加 error / aborted 等其它信号只需要新增一条 rule,不动主流程。

export type NotificationCategory = "success" | "error" | "info";

export interface NotificationTemplate {
  /** 通知标题。 */
  title: string;
  /** 通知正文(支持简单字符串插值,见 `formatBody`)。 */
  body: string;
  /** 通知类别,影响 icon / 是否震动。 */
  category: NotificationCategory;
  /**
   * 是否"重要"——重要的不进入静默时段过滤(例:agent 报错),避免用户错过。
   * 默认 false。
   */
  important?: boolean;
}

export interface NotificationRule {
  /**
   * 顶层 event 名(例如 "chat"、"agent")。匹配即进入 `match` 谓词;
   * 不匹配直接跳过本条规则。命名保持和 GatewayClient 帧的 `event` 字段
   * 一致,方便对照 debug log。
   */
  event: string;
  /**
   * payload 谓词。返回 true 表示该帧命中此规则,触发通知。
   * payload 类型是 unknown,需要规则自己判别。
   */
  match: (payload: unknown) => boolean;
  /** 通知模板。 */
  template: NotificationTemplate;
  /** 顶层 event 名,用于 settings 的订阅勾选和日志关联。 */
  name: string;
  /** UI 展示名。 */
  label: string;
  /** 默认是否勾选。 */
  defaultOn: boolean;
  /** 标记为重要(通知不受静默时段影响)。 */
  important: boolean;
}

// ---------------------------------------------------------------------------
// 谓词工具
// ---------------------------------------------------------------------------

/**
 * `chat` 帧的最终态。OpenClaw 推流式输出时,同一次 run 会有
 *   state: "delta"  → state: "final" 两条
 * 我们只对 final 触发通知(用户在 webUI 看到 "Agent 回复" 的时刻)。
 */
function isChatFinal(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { state?: unknown };
  return p.state === "final";
}

// ---------------------------------------------------------------------------
// 内容提取工具
// ---------------------------------------------------------------------------

/**
 * 从 chat 帧的 `message.content` 里拿到一段简短摘要,塞到通知 body 里。
 *
 * OpenClaw 的 content 形态多样,我们按可能性依次尝试:
 *   1. `string`                              → 原样
 *   2. `Array<{ type, text }>`               → 拼出所有 type==="text" 的 text
 *   3. 其它(对象等)                          → JSON.stringify 后截断
 *
 * 输出再做一次"压平":把换行 / 多余空白压成单个空格,让通知在多行平台
 * (macOS / Windows toast) 上不会换行错位。
 */
export function extractMessagePreview(payload: unknown, maxLen = 80): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { message?: unknown };
  const msg = p.message;
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { content?: unknown };
  const content = m.content;
  if (typeof content === "string") {
    return clamp(flatten(content), maxLen);
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const t = (part as { type?: unknown }).type;
        const text = (part as { text?: unknown }).text;
        if (t === "text" && typeof text === "string") {
          parts.push(text);
        }
      }
    }
    if (parts.length > 0) {
      return clamp(flatten(parts.join(" ")), maxLen);
    }
  }
  return "";
}

function flatten(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clamp(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

/**
 * 从 chat 帧里读 stopReason。OpenClaw 协议里常见的:
 *   - "stop": 正常完成
 *   - "aborted": 用户取消 / 中断
 *   - "length": 输出超长被截断
 *   - 其它(error / tool_fail 等): 视为异常
 */
function readStopReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return (payload as { stopReason?: unknown }).stopReason as string ?? "";
}

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------
//
// chat.final 是一个"统一终点",OpenClaw 不管 run 怎么结束都发 final 帧。
// 我们按 stopReason 拆出三条独立 rule,用户在 settings 里看到三条独立勾选项:
//
//   - chat.completed   (stopReason="stop")        → 正常完成,success
//   - chat.aborted     (stopReason="aborted")     → 用户取消,info
//   - chat.error       (其它 stopReason)          → 异常,error + important
//
// 不想被 abort 通知刷屏就只勾 completed + error,互不干扰。

function readAgentId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return (payload as { agentId?: unknown }).agentId as string ?? "";
}

function matchStopReason(expected: string) {
  return (payload: unknown): boolean => {
    if (!payload || typeof payload !== "object") return false;
    if ((payload as { state?: unknown }).state !== "final") return false;
    return readStopReason(payload) === expected;
  };
}

const RULES: NotificationRule[] = [
  {
    name: "chat.completed",
    label: "chat.completed(Agent 正常完成)",
    event: "chat",
    match: matchStopReason("stop"),
    template: {
      title: "Agent 回复完成",
      body: "{instance} · {agentId}\n{preview}",
      category: "success",
    },
    defaultOn: true,
    important: false,
  },
  {
    name: "chat.aborted",
    label: "chat.aborted(对话被中断 / 取消)",
    event: "chat",
    match: matchStopReason("aborted"),
    template: {
      title: "Agent 已取消",
      body: "{instance} · {agentId}\n对话被中断",
      category: "info",
    },
    defaultOn: true,
    important: false,
  },
  {
    name: "chat.error",
    label: "chat.error(运行异常:length / 工具失败等)",
    event: "chat",
    match: (payload: unknown) => {
      // final 帧 + stopReason 不是 stop 也不是 aborted → 异常
      if (!payload || typeof payload !== "object") return false;
      if ((payload as { state?: unknown }).state !== "final") return false;
      const r = readStopReason(payload);
      return r.length > 0 && r !== "stop" && r !== "aborted";
    },
    template: {
      title: "Agent 运行异常",
      body: "{instance} · {agentId}\nstopReason={stopReason}\n{preview}",
      category: "error",
    },
    defaultOn: true,
    important: true,
  },
];

/**
 * 顶层 event 名 → 该 event 下所有规则。
 * 用户在 settings 里勾选的是 `name`(rule 的稳定 ID),所以这里再做一层
 * "顶层 event → rule.name[]" 的索引,方便快速判断某条帧是否在白名单内,
 * 不需要遍历全部规则。
 */
const RULES_BY_EVENT: Map<string, NotificationRule[]> = (() => {
  const m = new Map<string, NotificationRule[]>();
  for (const r of RULES) {
    const list = m.get(r.event) ?? [];
    list.push(r);
    m.set(r.event, list);
  }
  return m;
})();

/** 暴露给 SettingsManager 做勾选 UI。 */
export const SUBSCRIBABLE_EVENTS: { name: string; label: string; defaultOn: boolean; important: boolean }[] =
  RULES.map((r) => ({ name: r.name, label: r.label, defaultOn: r.defaultOn, important: r.important }));

// ---------------------------------------------------------------------------
// 内部状态
// ---------------------------------------------------------------------------

interface AggregateBucket {
  /** 首次入桶时间(用于判断窗口)。 */
  firstAt: number;
  /** 累计条数(1-based,首条也算 1)。 */
  count: number;
  /** 累计的"代表性 payload"——首条 payload,合并时附在通知里。 */
  representativePayload: unknown;
  /** 排定的 flush 计时器,新事件来时清掉重排。 */
  flushTimer: NodeJS.Timeout | null;
  /**
   * 首条事件携带的实例 auth 信息(端口 + token),用于拼通知点击 deeplink。
   * 后续同 key 事件不会改它(实例的 port/token 在生命周期内不会变)。
   */
  auth: { port: number; token: string } | null;
}

const DEFAULT_AGGREGATE_WINDOW_SEC = 30;
const AGGREGATE_TIMER_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Icon 解析(模块级一次性,缓存结果)
// ---------------------------------------------------------------------------
//
// 之前在 resolveIcon() 里每次 fire 通知都跑一遍:
//   1. 拼接候选路径
//   2. fs.existsSync
//   3. nativeImage.createFromPath(内部 readFileSync)
//
// pop 通知 30s 窗口聚合一条还行,但当用户调成"不聚合"或高频 agent 任务跑完,
// 一晚上可能上百条通知 → 上百次磁盘 stat + readFileSync + 解析 PNG,纯浪费。
//
// 改成模块加载时一次性算好并缓存;`null` 也缓存(避免每次再尝试找路径)。
// 测试覆盖 reset 行为。

const __filename = fileURLToPath(import.meta.url);
const __dirname_ = path.dirname(__filename);

/**
 * 按优先级列出 icon 候选路径。dev 模式下用 `__dirname/../assets`(打包后
 * 不会变,跟 main.ts 的 iconPath() 一致),prod 用 `process.resourcesPath`。
 * 同时备 .ico(Windows)和 .png(其它平台),谁先找到用谁。
 */
function buildIconCandidates(): string[] {
  const candidates: string[] = [];
  const devAssets = path.join(__dirname_, "..", "assets");
  candidates.push(path.join(devAssets, "icon.png"));
  candidates.push(path.join(devAssets, "icon.ico"));
  try {
    const res = (process as { resourcesPath?: string }).resourcesPath;
    if (res) {
      candidates.push(path.join(res, "icon.png"));
      candidates.push(path.join(res, "icon.ico"));
    }
  } catch {
    // process.resourcesPath 在 renderer 不可用,Electron 跨进程时可能 throw
  }
  return candidates;
}

/**
 * 模块加载时一次性解析 icon。`undefined` 表示"没找到",后续 fire 直接传 undefined,
 * Electron 会用 app 自身的 icon 兜底(我们 setAppUserModelId 后 Windows 上能用)。
 */
const RESOLVED_ICON: Electron.NativeImage | undefined = (() => {
  for (const p of buildIconCandidates()) {
    try {
      if (p && fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      // 单个候选失败不阻断,继续试下一个
    }
  }
  return undefined;
})();

/**
 * 调试开关:设置 `OPENCLAW_MANAGER_DEBUG_EVENTS=1` 后,所有从 GatewayClient
 * 透传过来的 event 帧都会打到 stderr,格式为单行 JSON:
 *   `[notify-debug] {"instance":"x","event":"agent.end","payload":{...}}`
 *
 * payload 截断到 200 字符,避免刷屏。
 *
 * 设计原则:
 *   - 走环境变量不进 store,避免"调试态"污染用户配置。
 *   - 在事件刚到就打印,即使后续被通知服务/聚合/静默时段过滤掉也能看到,
 *     方便对账 OpenClaw 实际下发的事件名。
 *   - 不影响正常路径的性能:不开时就是个 `if` 跳过。
 */
const DEBUG_EVENTS_ENV = "OPENCLAW_MANAGER_DEBUG_EVENTS";
const DEBUG_PAYLOAD_MAX = 200;

function isDebugEventsEnabled(): boolean {
  const v = process.env[DEBUG_EVENTS_ENV];
  if (!v) return false;
  // 1 / true / yes / on 都视作开启
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes" || v.toLowerCase() === "on";
}

function debugLogEvent(instanceName: string, event: string, payload: unknown): void {
  let payloadRepr: string;
  try {
    const s = JSON.stringify(payload);
    if (s === undefined) {
      payloadRepr = String(payload);
    } else {
      payloadRepr = s.length > DEBUG_PAYLOAD_MAX ? `${s.slice(0, DEBUG_PAYLOAD_MAX)}…` : s;
    }
  } catch {
    payloadRepr = "[unserializable]";
  }
  // 用 console.error 而非 console.log:让 npm run dev / `electron .` 启动时
  // 直接出现在终端显眼位置,不会被 Vite 的 stdout 缓冲吞掉。
  // eslint-disable-next-line no-console
  console.error(`[notify-debug] ${JSON.stringify({ instance: instanceName, event, payload: payloadRepr })}`);
}

class NotificationService {
  private emitter = new EventEmitter();
  private buckets = new Map<string, AggregateBucket>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** 当前正在展示的 Notification 引用(主要用于 test 时的"等待关闭")。 */
  private active: Notification | null = null;

  // ---- 公共 API --------------------------------------------------------

  /**
   * 收到一条网关事件,经过配置/路由/聚合后,决定是否弹通知。
   * `payload` 直接透传给 `formatBody` 作为简单插值上下文。
   * `auth` 携带实例的 port + token,用于通知点击拼 deeplink。
   */
  handleEvent(
    instanceName: string,
    event: string,
    payload: unknown,
    auth?: { port: number; token: string } | null,
  ): void {
    // 调试日志放在所有过滤之前,即使被白名单/静默/聚合吞掉也能看到原始事件名,
    // 方便对账 OpenClaw 实际下发的 event 命名。
    if (isDebugEventsEnabled()) {
      debugLogEvent(instanceName, event, payload);
    }
    const cfg = this.getConfigSnapshot();
    if (!cfg.enabled) return;
    const rules = RULES_BY_EVENT.get(event);
    if (!rules || rules.length === 0) return;
    for (const rule of rules) {
      // 1) settings 订阅白名单:按 rule.name(稳定 ID)判断,而不是 event 名
      if (!cfg.events.includes(rule.name)) continue;
      // 2) payload 谓词:不命中直接跳过,例如 delta 帧就走不到 final 规则
      if (!rule.match(payload)) continue;
      this.dispatch(instanceName, rule, payload, cfg, auth ?? null);
    }
  }

  /** 立即把当前聚合桶全部 flush(用于 app 退出前不要丢事件)。 */
  flush(): void {
    for (const [key, bucket] of this.buckets) {
      this.fireAggregated(key, bucket, true);
      if (bucket.flushTimer) {
        clearTimeout(bucket.flushTimer);
      }
    }
    this.buckets.clear();
  }

  /** 测试用:从外部直接发一条通知(走"非聚合"路径)。 */
  sendTest(instanceName: string): { ok: boolean; supported: boolean; error?: string } {
    if (!Notification.isSupported()) {
      return { ok: false, supported: false, error: "当前系统不支持通知" };
    }
    const title = "OpenClaw Manager · 测试通知";
    const body = `实例 ${instanceName} 的通知通道已就绪。点击此通知可跳到对应实例。`;
    // 测试通知不属于任何业务 rule,造一个临时 rule 走 buildNotification 通用路径
    const stubRule: NotificationRule = {
      name: "test",
      label: "test",
      event: "test",
      match: () => true,
      template: { title, body, category: "info" },
      defaultOn: true,
      important: false,
    };
    // 测试通知不带 auth(没有具体实例会话),deeplink 留 null,点击只聚焦 Manager。
    const n = this.buildNotification(title, body, "info", instanceName, stubRule, null);
    if (!n) return { ok: false, supported: false, error: "无法构建 Notification 实例" };
    try {
      n.show();
      this.active = n;
      n.on("close", () => {
        if (this.active === n) this.active = null;
      });
      return { ok: true, supported: true };
    } catch (err) {
      return { ok: false, supported: true, error: (err as Error).message };
    }
  }

  /** 通知被点击——外部(main.ts)订阅这个事件,负责唤起窗口 + 切 tab。 */
  onClicked(
    handler: (data: {
      instanceName: string;
      rule: string;
      event: string;
      deeplink: string | null;
    }) => void,
  ): () => void {
    this.emitter.on("click", handler);
    return () => this.emitter.off("click", handler);
  }

  /** 关闭并清理。 */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    for (const [, bucket] of this.buckets) {
      if (bucket.flushTimer) clearTimeout(bucket.flushTimer);
    }
    this.buckets.clear();
    this.active?.close();
    this.active = null;
    this.emitter.removeAllListeners();
  }

  // ---- 内部 -----------------------------------------------------------

  private getConfigSnapshot(): NotificationConfig {
    try {
      return getNotificationConfig();
    } catch {
      // store 还没就绪(e2e 单测早期)——返回兜底
      return {
        enabled: true,
        events: RULES.map((r) => r.name),
        quietHours: { enabled: false, start: "22:00", end: "08:00" },
        aggregateWindowSec: DEFAULT_AGGREGATE_WINDOW_SEC,
      };
    }
  }

  private dispatch(
    instanceName: string,
    rule: NotificationRule,
    payload: unknown,
    cfg: NotificationConfig,
    auth: { port: number; token: string } | null,
  ): void {
    if (!Notification.isSupported()) return;

    // 静默时段过滤:important 规则不参与。
    if (
      !rule.important &&
      cfg.quietHours.enabled &&
      this.isInQuietHours(cfg.quietHours.start, cfg.quietHours.end)
    ) {
      return;
    }

    // 聚合:窗口 ≤ 0 视作不聚合,直接弹。
    if (!cfg.aggregateWindowSec || cfg.aggregateWindowSec <= 0) {
      this.fireNotification(instanceName, rule, payload, 1, auth);
      return;
    }
    this.aggregate(instanceName, rule, payload, cfg.aggregateWindowSec, auth);
  }

  private aggregate(
    instanceName: string,
    rule: NotificationRule,
    payload: unknown,
    windowSec: number,
    auth: { port: number; token: string } | null,
  ): void {
    const key = `${instanceName}::${rule.name}`;
    const now = Date.now();
    const existing = this.buckets.get(key);
    const windowMs = windowSec * 1_000;

    if (existing) {
      existing.count += 1;
      // 用最新 payload 覆盖 representative,让用户看到最近一次的状态
      existing.representativePayload = payload;
      // 新事件来了:清掉旧 timer,重新排到期时刻
      if (existing.flushTimer) clearTimeout(existing.flushTimer);
      existing.flushTimer = this.scheduleFlush(key, existing, windowMs);
      return;
    }

    const bucket: AggregateBucket = {
      firstAt: now,
      count: 1,
      representativePayload: payload,
      flushTimer: null,
      auth,
    };
    bucket.flushTimer = this.scheduleFlush(key, bucket, windowMs);
    this.buckets.set(key, bucket);
    this.ensureFlushTimer();
  }

  /** 排一个到期时刻的 flush;返回 timer 句柄。 */
  private scheduleFlush(key: string, bucket: AggregateBucket, windowMs: number): NodeJS.Timeout {
    return setTimeout(() => {
      // 桶可能已经被外部 flush 掉了,做一次存在性检查
      const live = this.buckets.get(key);
      if (!live || live !== bucket) return;
      this.fireAggregated(key, bucket, false);
      this.buckets.delete(key);
    }, windowMs);
  }

  /**
   * 启动后台定时器,周期性检查所有桶是否到期。
   * 兜底用,避免 `setTimeout` 单点漂移导致窗口内事件漏 flush。
   */
  private ensureFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      const cfg = this.getConfigSnapshot();
      const windowMs = (cfg.aggregateWindowSec ?? DEFAULT_AGGREGATE_WINDOW_SEC) * 1_000;
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.firstAt >= windowMs) {
          this.fireAggregated(key, bucket, false);
          this.buckets.delete(key);
        }
      }
    }, AGGREGATE_TIMER_INTERVAL_MS);
    // 进程退出时不阻塞
    this.flushTimer.unref?.();
  }

  private fireAggregated(key: string, bucket: AggregateBucket, _force: boolean): void {
    const [instanceName, ruleName] = key.split("::");
    const rule = RULES.find((r) => r.name === ruleName);
    if (!rule) return;
    this.fireNotification(instanceName, rule, bucket.representativePayload, bucket.count, bucket.auth);
  }

  private fireNotification(
    instanceName: string,
    rule: NotificationRule,
    payload: unknown,
    count: number,
    auth: { port: number; token: string } | null,
  ): void {
    const tpl = rule.template;
    const title = count > 1 ? `${tpl.title} (×${count})` : tpl.title;
    const body = this.formatBody(tpl.body, {
      instance: instanceName,
      event: rule.event,
      rule: rule.name,
      count: String(count),
      agentId: readAgentId(payload) || "?",
      preview: extractMessagePreview(payload, 80) || "(无内容摘要)",
      stopReason: readStopReason(payload) || "?",
      payload: safeStringify(payload),
    });
    // deeplink 在 fire 阶段就拼好,作为 click 回调的闭包变量持有,
    // 避免多通知并发时 lastAuth 互相覆盖。
    const deeplink = this.buildDeeplink(rule, auth, payload);
    const n = this.buildNotification(title, body, tpl.category, instanceName, rule, deeplink);
    if (!n) return;
    try {
      n.show();
      this.active = n;
      n.on("close", () => {
        if (this.active === n) this.active = null;
      });
    } catch (err) {
      console.warn("[notification-service] show() failed:", err);
    }
  }

  private buildNotification(
    title: string,
    body: string,
    category: NotificationCategory,
    instanceName: string,
    rule: NotificationRule,
    deeplink: string | null,
  ): Notification | null {
    try {
      const n = new Notification({
        title,
        body,
        // 不同系统 urgency 映射不同,这里给个统一 hint
        urgency: category === "error" ? "critical" : "normal",
        silent: false,
        icon: this.resolveIcon(),
      });
      n.on("click", () => {
        this.emitter.emit("click", { instanceName, rule: rule.name, event: "click", deeplink });
      });
      return n;
    } catch (err) {
      console.warn("[notification-service] build Notification failed:", err);
      return null;
    }
  }

  /**
   * 根据 rule + auth + payload 拼出 deeplink。
   * 返回 null 表示该通知不应该打开 webUI(例如没有 auth 上下文或无法推断路径)。
   * 上层(main.ts)在收到 click 后,deeplink 为 null 时只聚焦 Manager 窗口,
   * 不弹浏览器。
   */
  buildDeeplink(
    rule: NotificationRule,
    auth: { port: number; token: string } | null,
    payload?: unknown,
  ): string | null {
    if (!auth) return null;
    const path = this.deeplinkPathFor(rule, payload);
    if (!path) return null;
    // 127.0.0.1 而不是 localhost,避免在某些 Windows / WSL 环境下
    // localhost 解析到 ::1 而 OpenClaw 只绑 127.0.0.1 导致 503。
    return `http://127.0.0.1:${auth.port}${path}#token=${encodeURIComponent(auth.token)}`;
  }

  /**
   * 根据 rule 类型和 payload 拼出 path 部分。
   * - chat 类型的 final 帧 → `/chat?session=<sessionKey>`(本次主要诉求)
   * - agent 类型的 lifecycle 帧 → 暂落到实例首页(后续按需扩展)
   * - 其它 → `/` 实例首页
   */
  private deeplinkPathFor(rule: NotificationRule, payload: unknown): string | null {
    if (rule.event === "chat" && payload && typeof payload === "object") {
      const sessionKey = (payload as { sessionKey?: unknown }).sessionKey;
      if (typeof sessionKey === "string" && sessionKey.length > 0) {
        return `/chat?session=${encodeURIComponent(sessionKey)}`;
      }
    }
    // 没有匹配的 session 信息时,落到实例首页
    return "/";
  }

  /**
   * 取启动时已缓存的 icon。不再每次重新解析,避免高频通知时反复读盘。
   * 找不到时返回 undefined,Notification 会用 app 自身 icon 兜底。
   */
  private resolveIcon(): Electron.NativeImage | undefined {
    return RESOLVED_ICON;
  }

  /**
   * 把 `{name}` 形式的占位符替换成 context 同名字段的值。
   * 不存在的占位符原样保留,避免模板写错时静默吞字。
   */
  formatBody(template: string, context: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
      return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match;
    });
  }

  /**
   * 当前本地时间是否落在 [start, end) 区间内,跨夜时拆成两段。
   * 端点用闭区间,实操差异忽略不计。
   */
  isInQuietHours(start: string, end: string): boolean {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null) return false;
    const now = currentMinutesOfDay();
    if (s === e) return false; // 同分,空区间
    if (s < e) {
      return now >= s && now < e;
    }
    // 跨夜:[s, 24:00) ∪ [00:00, e)
    return now >= s || now < e;
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!_instance) {
    _instance = new NotificationService();
  }
  return _instance;
}

/** 测试 / app 退出时用,清掉单例。 */
export function resetNotificationService(): void {
  if (_instance) {
    _instance.shutdown();
    _instance = null;
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function currentMinutesOfDay(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function safeStringify(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    const s = JSON.stringify(payload);
    if (s === undefined) return "";
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch {
    return String(payload);
  }
}
