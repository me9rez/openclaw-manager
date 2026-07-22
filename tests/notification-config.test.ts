import { describe, it, expect, beforeEach, vi } from "vitest";

// store.ts 在 import 时就调 `app.getPath("userData")`,vitest node env 没有
// `electron.app`,所以必须先 vi.mock electron,再 vi.mock store,再 import 被测逻辑。
//
// 但 store.ts 的 normalize 函数并不导出,只能通过 getNotificationConfig
// 间接验证。我们用 vi.mock 把 store 内部的 read 行为隔离,直接调
// getNotificationConfig 然后断言返回的 events 数组。

const userDataMock: { path: string } = { path: "C:\\fake\\userData" };

vi.mock("electron", () => ({
  app: {
    getPath: (key: string) => {
      if (key === "userData") return userDataMock.path;
      if (key === "home") return "C:\\fake\\home";
      if (key === "logs") return "C:\\fake\\logs";
      return "C:\\fake";
    },
  },
}));

import * as fs from "fs";
import * as path from "path";

const storeFile = path.join(userDataMock.path, "manager-config.json");

function writeConfig(notifications: unknown) {
  // 确保 userData 目录存在
  fs.mkdirSync(userDataMock.path, { recursive: true });
  const data = { notifications };
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2), "utf-8");
}

function clearConfig() {
  if (fs.existsSync(storeFile)) {
    fs.unlinkSync(storeFile);
  }
}

beforeEach(() => {
  clearConfig();
  vi.resetModules();
});

describe("store / normalizeNotificationConfig", () => {
  it("无 manager-config.json 时,events 走默认(3 个新 rule 全勾)", async () => {
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed", "chat.aborted", "chat.error"]);
  });

  it("空 notifications 字段时,events 走默认", async () => {
    writeConfig({});
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed", "chat.aborted", "chat.error"]);
  });

  it("老数据 events=['chat.final'] → 未知 rule 被过滤 → 回退到默认全勾", async () => {
    writeConfig({ events: ["chat.final"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    // 不能保留 ["chat.final"](它是已废弃的 rule 名,会让人误以为有通知但实际没有)
    expect(cfg.events).not.toContain("chat.final");
    // 必须回退到默认,否则用户看到"勾了但还是不弹"
    expect(cfg.events).toEqual(["chat.completed", "chat.aborted", "chat.error"]);
  });

  it("events 同时含有效 + 未知 → 只保留有效的,不全清空", async () => {
    writeConfig({ events: ["chat.completed", "chat.final", "chat.error", "weird"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed", "chat.error"]);
  });

  it("events 全是未知 → 回退到默认", async () => {
    writeConfig({ events: ["chat.final", "agent.end", "weird"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed", "chat.aborted", "chat.error"]);
  });

  it("events 空数组(用户主动清空)→ 保持空数组(尊重用户选择)", async () => {
    writeConfig({ events: [] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    // 区分两种"空":用户主动清空 vs 老数据全是过期 rule。
    // 这里 raw.events 本身就是 []  → 尊重,events 也得是 []
    expect(cfg.events).toEqual([]);
  });

  it("events 全是未知 rule(老数据)→ 回退到默认", async () => {
    writeConfig({ events: ["chat.final", "agent.end", "weird"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    // 数组非空但过滤后全无效 → 老数据,回退默认
    expect(cfg.events).toEqual(["chat.completed", "chat.aborted", "chat.error"]);
  });

  it("events 含非字符串(数字 / null)→ 只留 string,其余按上面规则过滤", async () => {
    writeConfig({ events: ["chat.completed", 42, null, "chat.error"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed", "chat.error"]);
  });

  it("用户主动取消勾选某条应该被尊重(只勾 completed)", async () => {
    writeConfig({ events: ["chat.completed"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.events).toEqual(["chat.completed"]);
  });

  it("enabled=false 应该被尊重(用户主动关总开关)", async () => {
    writeConfig({ enabled: false, events: ["chat.completed", "chat.aborted", "chat.error"] });
    const { getNotificationConfig } = await import("../electron/store");
    const cfg = getNotificationConfig();
    expect(cfg.enabled).toBe(false);
  });

  it("updateNotificationConfig 落盘后再读,值保持一致", async () => {
    const { updateNotificationConfig, getNotificationConfig } = await import("../electron/store");
    const next = updateNotificationConfig({ events: ["chat.error"] });
    expect(next.events).toEqual(["chat.error"]);
    // 再次读
    const reread = getNotificationConfig();
    expect(reread.events).toEqual(["chat.error"]);
  });
});
