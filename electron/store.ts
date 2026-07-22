import { app } from "electron";
import fs from "fs";
import path from "path";

export interface InstanceRecord {
  name: string;
  version: string;
  port: number;
  token: string;
}

export interface ConfigTemplate {
  id: string;
  name: string;
  description?: string;
  blockKey: string;
  content: unknown;
  createdAt: number;
  updatedAt: number;
}

/**
 * 通知配置。事件名采用通配数组,匹配时按精确字符串比对。
 * - 静默时段使用 24h `HH:MM`,跨夜时把结束时间视作次日(例如 22:00 → 08:00)。
 */
export interface NotificationConfig {
  /** 总开关。 */
  enabled: boolean;
  /** 监听的事件名列表。空数组等价于"全选"未启用,留给上层决定默认。 */
  events: string[];
  /** 静默时段。开启后这段时间内的通知不会弹系统气泡,只走聚合队列。 */
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  /** 同实例同事件在窗口内的多条合并成一条;窗口(秒)。0 = 不聚合。 */
  aggregateWindowSec: number;
}

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  // rule.name 列表(与 notification-service 的 RULES 同步),不是顶层 event 名。
  // 命名约定是 "chat.completed" / "chat.aborted" / "chat.error"。
  // 用户在 settings 里看到的就是这三条独立勾选项。
  events: ["chat.completed", "chat.aborted", "chat.error"],
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  aggregateWindowSec: 30,
};

interface StoreData {
  instances: InstanceRecord[];
  versions: string[];
  nextPort: number;
  managerDir: string;
  configTemplates: ConfigTemplate[];
  backupRetention: number | null;
  autoStart: boolean;
  autoStartInstances: boolean;
  autoStartInstanceList: string[];
  notifications: NotificationConfig;
}

const storePath = path.join(app.getPath("userData"), "manager-config.json");

function ensureDir(): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function read(): StoreData {
  try {
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        instances: parsed.instances ?? [],
        versions: parsed.versions ?? [],
        nextPort: parsed.nextPort ?? 18789,
        managerDir: parsed.managerDir ?? path.join(app.getPath("home"), ".openclaw-manager"),
        configTemplates: parsed.configTemplates ?? [],
        backupRetention: parsed.backupRetention ?? 20,
        autoStart: parsed.autoStart ?? false,
        autoStartInstances: parsed.autoStartInstances ?? false,
        autoStartInstanceList: parsed.autoStartInstanceList ?? [],
        notifications: normalizeNotificationConfig(parsed.notifications),
      };
    }
  } catch {
    // fall through to defaults
  }
  return {
    instances: [],
    versions: [],
    nextPort: 18789,
    managerDir: path.join(app.getPath("home"), ".openclaw-manager"),
    configTemplates: [],
    backupRetention: 20,
    autoStart: false,
    autoStartInstances: false,
    autoStartInstanceList: [],
    notifications: { ...DEFAULT_NOTIFICATION_CONFIG },
  };
}

/**
 * 把磁盘上读到的 `notifications` 字段与默认值做并集,避免老数据缺字段。
 *
 * 关键约束:`events` 数组里的每一项都必须是当前 `notification-service` 还在
 * 使用的 rule.name。历史版本里我们用过 "chat.final",现在改名成
 * "chat.completed" / "chat.aborted" / "chat.error"。
 *
 * `events` 的回退策略分两档,不要混:
 *   1) 字段本身缺失/损坏 → 用默认全勾(老 manager 升级上来应该自动可用)
 *   2) 字段是数组,但里面的项都"过期"(老 rule 名) → 也回退到默认全勾
 *   3) 字段是数组,且过滤后至少剩一个已知 rule → 用过滤后的值(尊重用户选择)
 *   4) 字段是空数组(用户主动取消所有勾选)→ 尊重,保持空数组
 *
 * "老 rule 名过滤后剩 0 个"和"用户主动存空数组"在数据结构上无法区分,
 * 区分靠"原始 events 数组是否非空 + 过滤后是否非空"两条信息组合判断:
 *   - 原空 + 过滤后空 → 尊重(用户主动清空)
 *   - 原非空 + 过滤后空 → 老数据,回退默认
 */
const KNOWN_NOTIFICATION_RULES: ReadonlySet<string> = new Set([
  "chat.completed",
  "chat.aborted",
  "chat.error",
]);

function normalizeNotificationConfig(input: unknown): NotificationConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_NOTIFICATION_CONFIG };
  const raw = input as Partial<NotificationConfig> & { quietHours?: Partial<NotificationConfig["quietHours"]> };
  let events: string[];
  if (!Array.isArray(raw.events)) {
    // 字段缺失 / 不是数组 → 用默认
    events = [...DEFAULT_NOTIFICATION_CONFIG.events];
  } else {
    const rawIsEmpty = raw.events.length === 0;
    const filtered = raw.events.filter(
      (e): e is string => typeof e === "string" && KNOWN_NOTIFICATION_RULES.has(e),
    );
    if (filtered.length > 0) {
      // 至少有一个已知 rule,尊重用户选择
      events = filtered;
    } else if (rawIsEmpty) {
      // 用户主动清空所有勾选 → 尊重,保持空
      events = [];
    } else {
      // 数组非空但全是过期/无效 rule(老数据)→ 回退默认
      events = [...DEFAULT_NOTIFICATION_CONFIG.events];
    }
  }
  const qh = raw.quietHours ?? DEFAULT_NOTIFICATION_CONFIG.quietHours;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_NOTIFICATION_CONFIG.enabled,
    events,
    quietHours: {
      enabled: typeof qh.enabled === "boolean" ? qh.enabled : DEFAULT_NOTIFICATION_CONFIG.quietHours.enabled,
      start: typeof qh.start === "string" && /^\d{2}:\d{2}$/.test(qh.start) ? qh.start : DEFAULT_NOTIFICATION_CONFIG.quietHours.start,
      end: typeof qh.end === "string" && /^\d{2}:\d{2}$/.test(qh.end) ? qh.end : DEFAULT_NOTIFICATION_CONFIG.quietHours.end,
    },
    aggregateWindowSec:
      typeof raw.aggregateWindowSec === "number" && raw.aggregateWindowSec >= 0
        ? Math.min(raw.aggregateWindowSec, 600)
        : DEFAULT_NOTIFICATION_CONFIG.aggregateWindowSec,
  };
}

function write(data: StoreData): void {
  ensureDir();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getInstances(): InstanceRecord[] {
  return read().instances;
}

export function setInstances(instances: InstanceRecord[]): void {
  const data = read();
  data.instances = instances;
  write(data);
}

export function getInstance(name: string): InstanceRecord | undefined {
  return getInstances().find((i) => i.name === name);
}

export function addInstance(record: InstanceRecord): void {
  const list = getInstances();
  list.push(record);
  setInstances(list);
}

export function removeInstance(name: string): void {
  setInstances(getInstances().filter((i) => i.name !== name));
}

export function updateInstance(name: string, update: Partial<InstanceRecord>): void {
  const list = getInstances();
  const idx = list.findIndex((i) => i.name === name);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...update };
    setInstances(list);
  }
}

export function getVersions(): string[] {
  return read().versions;
}

export function addVersion(version: string): void {
  const data = read();
  if (!data.versions.includes(version)) {
    data.versions.push(version);
    write(data);
  }
}

export function removeVersion(version: string): void {
  const data = read();
  data.versions = data.versions.filter((v) => v !== version);
  write(data);
}

export function getNextPort(reservedPorts?: Set<number>): number {
  const data = read();
  const reserved = reservedPorts ?? new Set<number>();
  let port = data.nextPort;
  for (let i = 0; i < 1000; i++) {
    if (!reserved.has(port)) {
      data.nextPort = port + 1;
      write(data);
      return port;
    }
    port++;
  }
  data.nextPort = port + 1;
  write(data);
  return port;
}

export function getManagerDir(): string {
  return read().managerDir;
}

export function getInstanceDir(name: string): string {
  return path.join(getManagerDir(), "instances", name);
}

export function getVersionDir(version: string): string {
  return path.join(getManagerDir(), "versions", version);
}

export function listTemplates(): ConfigTemplate[] {
  return read().configTemplates;
}

export function getTemplate(id: string): ConfigTemplate | undefined {
  return read().configTemplates.find((t) => t.id === id);
}

export function addTemplate(template: ConfigTemplate): void {
  const data = read();
  data.configTemplates.push(template);
  write(data);
}

export function updateTemplate(id: string, patch: Partial<ConfigTemplate>): ConfigTemplate | undefined {
  const data = read();
  const idx = data.configTemplates.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  data.configTemplates[idx] = { ...data.configTemplates[idx], ...patch, id, updatedAt: Date.now() };
  write(data);
  return data.configTemplates[idx];
}

export function removeTemplate(id: string): void {
  const data = read();
  data.configTemplates = data.configTemplates.filter((t) => t.id !== id);
  write(data);
}

export function getBackupRetention(): number | null {
  return read().backupRetention;
}

export function setBackupRetention(count: number | null): void {
  const data = read();
  data.backupRetention = count;
  write(data);
}

export function getSettings(): { autoStart: boolean; autoStartInstances: boolean; autoStartInstanceList: string[] } {
  const data = read();
  return {
    autoStart: data.autoStart,
    autoStartInstances: data.autoStartInstances,
    autoStartInstanceList: data.autoStartInstanceList,
  };
}

export function updateSettings(patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }): void {
  const data = read();
  if (patch.autoStart !== undefined) data.autoStart = patch.autoStart;
  if (patch.autoStartInstances !== undefined) data.autoStartInstances = patch.autoStartInstances;
  if (patch.autoStartInstanceList !== undefined) data.autoStartInstanceList = patch.autoStartInstanceList;
  write(data);
}

export function getNotificationConfig(): NotificationConfig {
  return read().notifications;
}

export function updateNotificationConfig(patch: Partial<NotificationConfig>): NotificationConfig {
  const data = read();
  // 走一遍 normalize,保证即使用户传了脏数据也落成干净形态。
  const next = normalizeNotificationConfig({ ...data.notifications, ...patch });
  data.notifications = next;
  write(data);
  return next;
}
