import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = path.join(__dirname, "..", "dist-electron", "main.js");

function electronExecutable(): string {
  const electronDir = path.join(__dirname, "..", "node_modules", "electron", "dist");
  if (os.platform() === "win32") return path.join(electronDir, "electron.exe");
  if (os.platform() === "darwin") return path.join(electronDir, "Electron.app", "Contents", "MacOS", "Electron");
  return path.join(electronDir, "electron");
}

const TEST_INSTANCE = "e2e-test-reconn";

interface InstanceInfo {
  name: string;
  status: string;
  statusMessage?: string;
  port: number;
  startedAt?: number;
}

async function setupApp(): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ args: [APP_PATH], executablePath: electronExecutable() });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  const installed = await win.evaluate(() => (window as any).api.versions.listInstalled());
  if (installed.length === 0) {
    await win.evaluate(() => (window as any).api.versions.install("v2026.6.11"));
  }
  try { fs.rmSync(path.join(os.homedir(), ".openclaw-manager", "instances", TEST_INSTANCE), { recursive: true, force: true }); } catch {}
  return { app, win };
}

async function createAndStart(win: Page): Promise<InstanceInfo> {
  const versions = await win.evaluate(() => (window as any).api.versions.listInstalled());
  try { await win.evaluate((n) => (window as any).api.instances.remove(n), TEST_INSTANCE); } catch {}
  await win.evaluate(
    ({ name, version }: { name: string; version: string }) =>
      (window as any).api.instances.create({ name, version }),
    { name: TEST_INSTANCE, version: versions[0] },
  );
  await win.evaluate((n) => (window as any).api.instances.start(n), TEST_INSTANCE);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const list = (await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[]);
    const inst = list.find((x) => x.name === TEST_INSTANCE);
    if (inst?.status === "running") return inst;
    if (inst?.status === "crashed" || inst?.status === "error") {
      throw new Error(`Instance failed to start: status=${inst.status} msg=${inst.statusMessage}`);
    }
  }
  throw new Error("Instance did not reach running within 30s");
}

test.describe("Gateway reconnect", () => {
  test("should auto-reconnect after WS drop without killing the process", async () => {
    const { app, win } = await setupApp();
    const initial = await createAndStart(win);
    const startedAt = initial.startedAt;
    expect(startedAt).toBeTruthy();

    // Simulate WS drop (process stays alive)
    await win.evaluate((n) => (window as any).api.instances.debugDisconnectGateway(n), TEST_INSTANCE);

    // Should briefly enter reconnecting (poll at 200ms — reconnect cycle can complete in <1s)
    let sawReconnecting = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const inst = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
        .find((x) => x.name === TEST_INSTANCE))!;
      if (inst.status === "reconnecting") {
        sawReconnecting = true;
        expect(inst.statusMessage).toMatch(/重新连接中/);
        break;
      }
    }
    expect(sawReconnecting).toBe(true);

    // Should return to running
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const inst = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
        .find((x) => x.name === TEST_INSTANCE))!;
      if (inst.status === "running") {
        // Process should not have been respawned (same startedAt)
        expect(inst.startedAt).toBe(startedAt);
        await app.close();
        return;
      }
      if (inst.status === "crashed" || inst.status === "error") {
        throw new Error(`Reconnect failed: status=${inst.status} msg=${inst.statusMessage}`);
      }
    }
    throw new Error("Did not return to running within 30s after simulated WS drop");
  });

  test("should stop reconnecting on user request and flip to error", async () => {
    const { app, win } = await setupApp();
    await createAndStart(win);

    // Trigger reconnecting
    await win.evaluate((n) => (window as any).api.instances.debugDisconnectGateway(n), TEST_INSTANCE);

    // Wait for reconnecting
    let inReconnecting = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const inst = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
        .find((x) => x.name === TEST_INSTANCE))!;
      if (inst.status === "reconnecting") { inReconnecting = true; break; }
    }
    expect(inReconnecting).toBe(true);

    // User clicks 停止重连
    await win.evaluate((n) => (window as any).api.instances.stopReconnect(n), TEST_INSTANCE);
    await new Promise((r) => setTimeout(r, 500));

    const after = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
      .find((x) => x.name === TEST_INSTANCE))!;
    expect(after.status).toBe("error");
    expect(after.statusMessage).toMatch(/已停止重连/);

    // After 2s, should NOT have flipped back to reconnecting
    await new Promise((r) => setTimeout(r, 2000));
    const stable = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
      .find((x) => x.name === TEST_INSTANCE))!;
    expect(stable.status).toBe("error");

    await app.close();
  });

  test("should reset attempts and return to running on force reconnect", async () => {
    const { app, win } = await setupApp();
    await createAndStart(win);

    // Simulate WS drop twice to bump attempts
    for (let i = 0; i < 2; i++) {
      await win.evaluate((n) => (window as any).api.instances.debugDisconnectGateway(n), TEST_INSTANCE);
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Wait until back to running
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const inst = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
        .find((x) => x.name === TEST_INSTANCE))!;
      if (inst.status === "running") break;
    }

    // Force another disconnect, then immediately call forceReconnect mid-flight
    await win.evaluate((n) => (window as any).api.instances.debugDisconnectGateway(n), TEST_INSTANCE);
    await new Promise((r) => setTimeout(r, 1500));
    await win.evaluate((n) => (window as any).api.instances.forceReconnect(n), TEST_INSTANCE);

    // Should reach running without exhausting 10 attempts
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const inst = ((await win.evaluate(() => (window as any).api.instances.list()) as InstanceInfo[])
        .find((x) => x.name === TEST_INSTANCE))!;
      if (inst.status === "running") {
        await app.close();
        return;
      }
      if (inst.status === "crashed") {
        throw new Error(`Force reconnect should not have crashed: ${inst.statusMessage}`);
      }
    }
    throw new Error("Force reconnect did not reach running within 20s");
  });
});
