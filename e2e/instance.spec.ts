import { test, expect, _electron as electron } from "@playwright/test";
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

const testInstanceName = "e2e-test-611";

test.describe("Instance lifecycle", () => {
  test.beforeAll(() => {
    try { fs.rmSync(path.join(os.homedir(), ".openclaw-manager", "instances", testInstanceName), { recursive: true, force: true }); } catch {}
  });

  test("should create and start a test instance", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Install version
    const installed = await window.evaluate(() => window.api.versions.listInstalled());
    if (installed.length === 0) {
      await window.evaluate(() => window.api.versions.install("v2026.6.11"));
    }
    const versions = await window.evaluate(() => window.api.versions.listInstalled());
    expect(versions.length).toBeGreaterThan(0);
    console.log("Version:", versions[0]);

    // Debug: Test spawning node --version from main process
    const nodeVersionCheck = await window.evaluate(() =>
      window.api.instances.debug.spawn("node --version"),
    );
    console.log("node --version via cmd /c:", JSON.stringify(nodeVersionCheck));

    // Debug: Test spawning the bundled node directly
    const bundledNodeCheck = await window.evaluate(() =>
      window.api.instances.debug.spawn(
        'dir "C:\\project\\resources\\node" /B',
      ),
    );
    console.log("Bundled node dir:", JSON.stringify(bundledNodeCheck));

    // Debug: Test spawning openclaw --help
    const homedir = os.homedir();
    const entry = path.join(homedir, ".openclaw-manager", "versions", "v2026.6.11", "node_modules", "openclaw", "openclaw.mjs");
    const openclawHelp = await window.evaluate(
      (entryPath: string) => window.api.instances.debug.spawn(`node "${entryPath}" --help`),
      entry,
    );
    console.log("openclaw --help:", JSON.stringify(openclawHelp));

    // Clean & create instance
    try { await window.evaluate((n) => window.api.instances.remove(n), testInstanceName); } catch {}
    await window.evaluate(
      ({ name, version }) => window.api.instances.create({ name, version }),
      { name: testInstanceName, version: versions[0] },
    );

    const list = await window.evaluate(() => window.api.instances.list());
    const inst = list.find((i) => i.name === testInstanceName);
    expect(inst).toBeTruthy();
    console.log("Port:", inst!.port);

    // Start instance and monitor
    await window.evaluate((n) => window.api.instances.start(n), testInstanceName);

    let status = "";
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const current = (await window.evaluate(() => window.api.instances.list())).find(
        (i) => i.name === testInstanceName,
      );
      status = current?.status || "";
      const msg = current?.statusMessage || "";
      const logs = await window.evaluate((n) => window.api.instances.getLogs(n), testInstanceName);
      console.log(`[${i * 2}s] status=${status} msg="${msg}" logs=${logs.length}`);
      if (logs.length > 0) console.log("  LOGS:", logs.slice(-3).join(" | "));
      if (["running", "error", "crashed"].includes(status)) break;
    }

    const finalLogs = await window.evaluate((n) => window.api.instances.getLogs(n), testInstanceName);
    console.log("=== ALL LOGS ===");
    console.log(finalLogs.join("\n"));

    expect(status).toBe("running");

    await window.evaluate((n) => window.api.instances.stop(n), testInstanceName);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const c = (await window.evaluate(() => window.api.instances.list())).find((i) => i.name === testInstanceName);
      if (c?.status === "stopped") break;
    }
    await window.evaluate((n) => window.api.instances.remove(n), testInstanceName);
    await electronApp.close();
  });
});
