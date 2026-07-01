import { test, _electron as electron } from "@playwright/test";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = path.join(__dirname, "..", "dist-electron", "main.js");
const SHOTS_DIR = path.join(__dirname, "..", "docs", "screenshots");

function electronExecutable(): string {
  const electronDir = path.join(__dirname, "..", "node_modules", "electron", "dist");
  if (os.platform() === "win32") return path.join(electronDir, "electron.exe");
  if (os.platform() === "darwin") return path.join(electronDir, "Electron.app", "Contents", "MacOS", "Electron");
  return path.join(electronDir, "electron");
}

test.describe("Screenshots", () => {
  test("capture views", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(400);

    await window.screenshot({ path: path.join(SHOTS_DIR, "01-dashboard.png") });

    const navLinks = window.locator(".nav-link");
    await navLinks.nth(1).click();
    await window.waitForTimeout(600);
    await window.screenshot({ path: path.join(SHOTS_DIR, "02-versions.png") });

    await navLinks.nth(2).click();
    await window.waitForTimeout(600);
    await window.screenshot({ path: path.join(SHOTS_DIR, "03-config.png") });

    await navLinks.first().click();
    await window.waitForTimeout(400);
    await window.getByRole("button", { name: "+ 新建实例" }).click();
    await window.waitForTimeout(300);
    await window.screenshot({ path: path.join(SHOTS_DIR, "04-create-modal.png") });

    await electronApp.close();
  });
});
