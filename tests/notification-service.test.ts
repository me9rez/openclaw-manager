import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// notification-service 拉 electron Notification/store 的依赖比较重,
// 用 vi.mock 隔离。下面这套 mock 模式跟项目里其它测试保持一致。

const storeMock: { cfg: unknown } = {
  cfg: {
    enabled: true,
    // rule.name 列表(与 production 一致)
    events: ["chat.completed", "chat.aborted", "chat.error"],
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
    aggregateWindowSec: 30,
  },
};

vi.mock("../electron/store", () => ({
  getNotificationConfig: () => storeMock.cfg,
  updateNotificationConfig: (patch: Record<string, unknown>) => {
    storeMock.cfg = { ...(storeMock.cfg as object), ...patch };
    return storeMock.cfg;
  },
}));

class FakeNotification {
  static instances: FakeNotification[] = [];
  static isSupportedValue = true;
  title: string;
  body: string;
  urgency: string | undefined;
  silent: boolean | undefined;
  icon: unknown;
  shown = false;
  private listeners = new Map<string, Array<() => void>>();

  static isSupported() {
    return FakeNotification.isSupportedValue;
  }

  constructor(opts: { title: string; body: string; urgency?: string; silent?: boolean; icon?: unknown }) {
    this.title = opts.title;
    this.body = opts.body;
    this.urgency = opts.urgency;
    this.silent = opts.silent;
    this.icon = opts.icon;
    FakeNotification.instances.push(this);
  }

  on(event: string, cb: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
    return this;
  }

  show() {
    this.shown = true;
  }

  close() {
    this.shown = false;
    this.emit("close");
  }

  emit(event: string) {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }

  static reset() {
    FakeNotification.instances.length = 0;
    FakeNotification.isSupportedValue = true;
  }
}

vi.mock("electron", () => ({
  Notification: FakeNotification,
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => false }),
  },
}));

// 注意:被测文件依赖 `./store`,mock 路径要正确。
const { getNotificationService, resetNotificationService } = await import("../electron/notification-service");

beforeEach(() => {
  FakeNotification.reset();
  storeMock.cfg = {
    enabled: true,
    events: ["chat.completed", "chat.aborted", "chat.error"],
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
    aggregateWindowSec: 30,
  };
  resetNotificationService();
});

afterEach(() => {
  resetNotificationService();
  vi.useRealTimers();
});

describe("notification-service / handleEvent", () => {
  it("totally disabled 不会弹任何通知", () => {
    storeMock.cfg = { ...(storeMock.cfg as object), enabled: false };
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    expect(FakeNotification.instances.length).toBe(0);
  });

  it("chat.delta 不触发,只 final 才触发", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "delta", deltaText: "abc" });
    svc.handleEvent("inst-a", "chat", { state: "delta", deltaText: "abcd" });
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop", message: { role: "assistant" } });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toBe("Agent 回复完成");
    expect(FakeNotification.instances[0].body).toContain("inst-a");
  });

  it("用户没订阅任何 chat.* rule 就不弹", () => {
    storeMock.cfg = { ...(storeMock.cfg as object), events: [] };
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(0);
  });

  it("只取消订阅 chat.aborted,正常完成仍弹", () => {
    storeMock.cfg = { ...(storeMock.cfg as object), events: ["chat.completed", "chat.error"] };
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "aborted" });
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toBe("Agent 回复完成");
  });

  it("agent lifecycle 帧(没订阅的 event)不弹", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "agent", { stream: "lifecycle", data: { stopReason: "stop" } });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(0);
  });

  it("health 帧不弹(顶层 event 就不在路由表里)", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "health", { ok: true });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(0);
  });

  it("stopReason=stop 走 chat.completed(success)", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", {
      state: "final",
      stopReason: "stop",
      agentId: "main",
      message: { role: "assistant", content: "好的,任务已完成。" },
    });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    const n = FakeNotification.instances[0];
    expect(n.title).toBe("Agent 回复完成");
    expect(n.urgency).toBe("normal");
    expect(n.body).toContain("inst-a");
    expect(n.body).toContain("main");
    expect(n.body).toContain("好的,任务已完成。");
  });

  it("stopReason=aborted 走 chat.aborted", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "aborted", agentId: "main" });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    const n = FakeNotification.instances[0];
    expect(n.title).toBe("Agent 已取消");
    expect(n.body).toContain("对话被中断");
  });

  it("stopReason=length / 其它非 stop 非 aborted 走 chat.error(important)", () => {
    storeMock.cfg = {
      ...(storeMock.cfg as object),
      quietHours: { enabled: true, start: "00:00", end: "23:59" },
    };
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", {
      state: "final",
      stopReason: "length",
      agentId: "main",
      message: { content: "输出被截断…" },
    });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    const n = FakeNotification.instances[0];
    expect(n.title).toBe("Agent 运行异常");
    expect(n.urgency).toBe("critical");
    // 静默时段开着,因为 important,仍然能弹
    expect(n.body).toContain("stopReason=length");
  });

  it("content 数组(多段 text)合并成一段,压平空白", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", {
      state: "final",
      stopReason: "stop",
      agentId: "main",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "第一段\n第二段" },
          { type: "text", text: "  第三段  " },
          { type: "tool_use", id: "x" }, // 非 text 段应被忽略
        ],
      },
    });
    svc.flush();
    const n = FakeNotification.instances[0];
    expect(n.body).toContain("第一段 第二段 第三段");
  });

  it("content 截断到 80 字符 + 省略号", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    const long = "啊".repeat(200);
    svc.handleEvent("inst-a", "chat", {
      state: "final",
      stopReason: "stop",
      agentId: "main",
      message: { content: long },
    });
    svc.flush();
    const n = FakeNotification.instances[0];
    const previewLine = n.body.split("\n").pop() ?? "";
    expect(previewLine.endsWith("…")).toBe(true);
    expect(previewLine.length).toBeLessThanOrEqual(81); // 80 + "…"
  });

  it("聚合窗口内多条 chat.completed 合并为一条,标题带 (×N)", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    for (let i = 0; i < 3; i++) {
      svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop", runId: String(i) });
    }
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toBe("Agent 回复完成 (×3)");
  });

  it("不同实例各自成桶,instanceA 的完成不影响 instanceB", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    svc.handleEvent("inst-b", "chat", { state: "final", stopReason: "stop" });
    svc.flush();
    expect(FakeNotification.instances.length).toBe(2);
  });

  it("聚合窗口到期后自动 flush(用真定时器)", async () => {
    storeMock.cfg = { ...(storeMock.cfg as object), aggregateWindowSec: 0.05 };
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeNotification.instances.length).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(FakeNotification.instances.length).toBe(1);
  });

  it("formatBody 占位符替换", () => {
    const svc = getNotificationService();
    expect(svc.formatBody("hi {name}, {missing}", { name: "foo" })).toBe("hi foo, {missing}");
  });

  it("real-world 完整流:delta * N + final(stop) → 只弹一次 success", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    for (let i = 0; i < 20; i++) {
      svc.handleEvent("test-v71", "chat", { state: "delta", seq: i, deltaText: `chunk-${i}` });
    }
    expect(FakeNotification.instances.length).toBe(0);
    svc.handleEvent("test-v71", "chat", {
      state: "final",
      stopReason: "stop",
      agentId: "main",
      message: { content: "有的！`find-skills` 是一个用来**发现和安装新技能**的技能" },
    });
    expect(FakeNotification.instances.length).toBe(0);
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toBe("Agent 回复完成");
    // body 应该包含实例名、agentId、首行摘要
    const body = FakeNotification.instances[0].body;
    expect(body).toContain("test-v71");
    expect(body).toContain("main");
    expect(body).toContain("find-skills");
  });
});

describe("notification-service / isInQuietHours", () => {
  const svc = getNotificationService();
  it("同时间点不算静默", () => {
    expect(svc.isInQuietHours("08:00", "08:00")).toBe(false);
  });
  it("正常区间:start < end,落在中间", () => {
    // 用 00:00-23:59 涵盖任何时分
    expect(svc.isInQuietHours("00:00", "23:59")).toBe(true);
  });
  it("跨夜区间:start=22:00, end=08:00,现在 23:00 → 静默", () => {
    const real = Date;
    const fake = class extends real {
      constructor() {
        super();
      }
      getHours() { return 23; }
      getMinutes() { return 0; }
    } as unknown as DateConstructor;
    vi.stubGlobal("Date", fake);
    expect(svc.isInQuietHours("22:00", "08:00")).toBe(true);
    vi.unstubAllGlobals();
  });
  it("跨夜区间:start=22:00, end=08:00,现在 09:00 → 不静默", () => {
    const real = Date;
    const fake = class extends real {
      getHours() { return 9; }
      getMinutes() { return 0; }
    } as unknown as DateConstructor;
    vi.stubGlobal("Date", fake);
    expect(svc.isInQuietHours("22:00", "08:00")).toBe(false);
    vi.unstubAllGlobals();
  });
  it("非法时间字符串返回 false", () => {
    expect(svc.isInQuietHours("foo", "08:00")).toBe(false);
    expect(svc.isInQuietHours("25:00", "08:00")).toBe(false);
  });
});

describe("notification-service / sendTest", () => {
  it("系统不支持时返回 supported=false", () => {
    FakeNotification.isSupportedValue = false;
    const svc = getNotificationService();
    const res = svc.sendTest("inst-a");
    expect(res.ok).toBe(false);
    expect(res.supported).toBe(false);
  });

  it("系统支持时弹一条测试通知", () => {
    FakeNotification.isSupportedValue = true;
    const svc = getNotificationService();
    const res = svc.sendTest("inst-a");
    expect(res.ok).toBe(true);
    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toContain("测试通知");
  });
});

describe("notification-service / onClicked", () => {
  it("通知被点击时触发回调,带 instanceName + rule + deeplink", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    const fn = vi.fn();
    const off = svc.onClicked(fn);
    svc.handleEvent(
      "inst-a",
      "chat",
      { state: "final", stopReason: "stop", sessionKey: "agent:main:dashboard:abc-123" },
      { port: 18791, token: "tok" },
    );
    svc.flush();
    const n = FakeNotification.instances[0] as unknown as FakeNotification & { emit: (e: string) => void };
    n.emit("click");
    expect(fn).toHaveBeenCalledWith({
      instanceName: "inst-a",
      rule: "chat.completed",
      event: "click",
      deeplink: "http://127.0.0.1:18791/chat?session=agent%3Amain%3Adashboard%3Aabc-123#token=tok",
    });
    off();
  });

  it("没有 auth 时 deeplink 为 null(只聚焦 Manager,不开浏览器)", () => {
    vi.useFakeTimers();
    const svc = getNotificationService();
    const fn = vi.fn();
    const off = svc.onClicked(fn);
    svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop" });
    svc.flush();
    const n = FakeNotification.instances[0] as unknown as FakeNotification & { emit: (e: string) => void };
    n.emit("click");
    expect(fn).toHaveBeenCalledWith({
      instanceName: "inst-a",
      rule: "chat.completed",
      event: "click",
      deeplink: null,
    });
    off();
  });
});

describe("notification-service / icon 缓存", () => {
  it("模块加载时一次性解析 icon,后续 fire 通知复用同一份 NativeImage", async () => {
    // RESOLVED_ICON 是模块顶层 IIFE,在 import 时已经算好。
    // 这里通过 spy-on `electron.nativeImage.createFromPath`,验证
    // 通知服务后续 fire 时不再调它(用 cached)。
    const electron = await import("electron");
    const spy = vi.spyOn(electron.nativeImage, "createFromPath");
    vi.useFakeTimers();
    const svc = getNotificationService();
    // 弹 5 条通知(走同一条 rule,聚合为 1 条)
    for (let i = 0; i < 5; i++) {
      svc.handleEvent("inst-a", "chat", { state: "final", stopReason: "stop", message: { content: `msg ${i}` } });
    }
    svc.flush();
    expect(FakeNotification.instances.length).toBe(1);
    // spy 装在模块加载之后 → 模块顶层 IIFE 不算在 spy 期间
    // 期望:本次 spy 期间 createFromPath 调用次数为 0(全部走缓存)
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("notification-service / buildDeeplink", () => {
  const svc = getNotificationService();
  const auth = { port: 18791, token: "tok" };

  it("chat.final + sessionKey → /chat?session=<encoded>", () => {
    const url = svc.buildDeeplink(
      { name: "chat.final", event: "chat", match: () => true, template: { title: "", body: "", category: "info" }, defaultOn: true, important: false, label: "" },
      auth,
      { sessionKey: "agent:main:dashboard:abc-123" },
    );
    expect(url).toBe("http://127.0.0.1:18791/chat?session=agent%3Amain%3Adashboard%3Aabc-123#token=tok");
  });

  it("chat.final 无 sessionKey → 落到实例首页 /", () => {
    const url = svc.buildDeeplink(
      { name: "chat.final", event: "chat", match: () => true, template: { title: "", body: "", category: "info" }, defaultOn: true, important: false, label: "" },
      auth,
      {},
    );
    expect(url).toBe("http://127.0.0.1:18791/#token=tok");
  });

  it("sessionKey 里的特殊字符(空格 / 斜杠 / 中文)被正确编码", () => {
    const url = svc.buildDeeplink(
      { name: "chat.final", event: "chat", match: () => true, template: { title: "", body: "", category: "info" }, defaultOn: true, important: false, label: "" },
      auth,
      { sessionKey: "agent:main:测试/会话" },
    );
    expect(url).toBe(
      "http://127.0.0.1:18791/chat?session=agent%3Amain%3A%E6%B5%8B%E8%AF%95%2F%E4%BC%9A%E8%AF%9D#token=tok",
    );
  });

  it("auth 缺失返回 null", () => {
    const url = svc.buildDeeplink(
      { name: "chat.final", event: "chat", match: () => true, template: { title: "", body: "", category: "info" }, defaultOn: true, important: false, label: "" },
      null,
      { sessionKey: "x" },
    );
    expect(url).toBeNull();
  });

  it("用 127.0.0.1 而非 localhost,避免 IPv6 解析问题", () => {
    const url = svc.buildDeeplink(
      { name: "chat.final", event: "chat", match: () => true, template: { title: "", body: "", category: "info" }, defaultOn: true, important: false, label: "" },
      auth,
      { sessionKey: "x" },
    );
    expect(url).not.toBeNull();
    expect(url!.startsWith("http://127.0.0.1:")).toBe(true);
    expect(url!.includes("localhost")).toBe(false);
  });
});

describe("notification-service / debug events", () => {
  it("env 关闭时 handleEvent 不打 console.error", () => {
    delete process.env.OPENCLAW_MANAGER_DEBUG_EVENTS;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "final" });
    const debugCalls = errSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("[notify-debug]"),
    );
    expect(debugCalls.length).toBe(0);
    errSpy.mockRestore();
  });

  it("env=1 时每条 event 都打一行 [notify-debug] JSON", () => {
    process.env.OPENCLAW_MANAGER_DEBUG_EVENTS = "1";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = getNotificationService();
    svc.handleEvent("inst-a", "chat", { state: "delta" });
    svc.handleEvent("inst-a", "chat", { state: "final" });
    const debugLines = errSpy.mock.calls
      .map((args) => args[0])
      .filter((s): s is string => typeof s === "string" && s.startsWith("[notify-debug] "));
    expect(debugLines.length).toBe(2);
    const parsed1 = JSON.parse(debugLines[0].replace("[notify-debug] ", ""));
    expect(parsed1).toMatchObject({ instance: "inst-a", event: "chat" });
    expect(parsed1.payload).toContain("delta");
    errSpy.mockRestore();
  });

  it("env=true/yes/on 也认", () => {
    for (const v of ["true", "TRUE", "yes", "on"]) {
      process.env.OPENCLAW_MANAGER_DEBUG_EVENTS = v;
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const svc = getNotificationService();
      svc.handleEvent("inst-a", "chat", { state: "final" });
      const debugLines = errSpy.mock.calls.filter((args) =>
        typeof args[0] === "string" && args[0].includes("[notify-debug]"),
      );
      expect(debugLines.length).toBe(1);
      errSpy.mockRestore();
    }
  });

  it("payload 截断到 200 字符,过长加省略号", () => {
    process.env.OPENCLAW_MANAGER_DEBUG_EVENTS = "1";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = getNotificationService();
    const big = { x: "a".repeat(500) };
    svc.handleEvent("inst-a", "chat", big);
    const line = errSpy.mock.calls
      .map((args) => args[0])
      .find((s): s is string => typeof s === "string" && s.startsWith("[notify-debug] "));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.replace("[notify-debug] ", ""));
    expect(parsed.payload.length).toBeLessThanOrEqual(DEBUG_PAYLOAD_MAX_FOR_TEST + 1);
    expect(parsed.payload.endsWith("…")).toBe(true);
    errSpy.mockRestore();
  });

  it("payload 含循环引用不会让进程炸", () => {
    process.env.OPENCLAW_MANAGER_DEBUG_EVENTS = "1";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = getNotificationService();
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => svc.handleEvent("inst-a", "chat", cyclic)).not.toThrow();
    const line = errSpy.mock.calls
      .map((args) => args[0])
      .find((s): s is string => typeof s === "string" && s.startsWith("[notify-debug] "));
    expect(line).toBeDefined();
    expect(line).toContain("[unserializable]");
    errSpy.mockRestore();
  });
});

const DEBUG_PAYLOAD_MAX_FOR_TEST = 200;
