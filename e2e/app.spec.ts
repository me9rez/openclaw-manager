import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";
import os from "os";
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

test.describe("OpenClaw Manager E2E", () => {
  test("should launch the app and show the main window", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await expect(window).toHaveTitle(/OpenClaw Manager/);
    await electronApp.close();
  });

  test("should display Dashboard as default view", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await expect(window.locator("h1")).toHaveText("实例列表");

    const navButtons = window.locator(".nav-link");
    await expect(navButtons.first()).toBeVisible();
    await expect(navButtons).toHaveCount(3);

    await electronApp.close();
  });

  test("should navigate between tabs", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const navLinks = window.locator(".nav-link");

    await navLinks.nth(1).click();
    await expect(window.locator("h1")).toHaveText("版本管理");

    await navLinks.nth(2).click();
    await expect(window.locator("h1")).toHaveText("配置块管理");

    await navLinks.nth(0).click();
    await expect(window.locator("h1")).toHaveText("实例列表");

    await electronApp.close();
  });

  test("should show the create instance modal", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    await window.getByRole("button", { name: "+ 新建实例" }).click();

    const modal = window.locator(".modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("h2")).toHaveText("创建实例");

    await window.getByRole("button", { name: "取消" }).click();
    await expect(modal).not.toBeVisible();

    await electronApp.close();
  });

  test("should show instance detail when clicking a card", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const cards = window.locator(".card");
    const cardCount = await cards.count();

    if (cardCount > 0) {
      await cards.first().click();
      await expect(window.locator(".detail")).toBeVisible();
      await expect(window.locator("h1")).toBeVisible();

      await window.locator(".btn-back").click();
      await expect(window.locator("h1")).toHaveText("实例列表");
    }

    await electronApp.close();
  });

  test("should handle app quit gracefully", async () => {
    const electronApp = await electron.launch({
      args: [APP_PATH],
      executablePath: electronExecutable(),
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const appClosed = electronApp.close();
    await expect(appClosed).resolves.toBeUndefined();
  });
});
