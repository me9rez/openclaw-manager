import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { registerIpcHandlers, setupEventForwarders, initInstances } from "./ipc-handlers";
import { createTray, destroyTray, setTrayIconPath } from "./tray";
import { stopAllInstances, startInstance } from "./instance-manager";
import { getIsQuitting, setIsQuitting } from "./app-state";
import { getSettings } from "./store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

function iconPath(): string {
  const dev = path.join(__dirname, "..", "assets", "icon.ico");
  const prod = path.join(process.resourcesPath, "icon.ico");
  if (fs.existsSync(dev)) return dev;
  return prod;
}

function trayIconPath(): string {
  const dev = path.join(__dirname, "..", "assets", "icon-tray.png");
  const prod = path.join(process.resourcesPath, "icon-tray.png");
  if (fs.existsSync(dev)) return dev;
  return prod;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "OpenClaw Manager",
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setupEventForwarders(mainWindow);

  mainWindow.on("close", (e) => {
    if (!getIsQuitting()) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function tryCreateTray(win: BrowserWindow): void {
  if (process.platform === "darwin") return;
  try {
    createTray(win);
  } catch (err) {
    console.warn("[manager] tray init failed (likely headless):", err);
  }
}

if (gotLock) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    initInstances();

    const settings = getSettings();
    if (settings.autoStart && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    if (settings.autoStartInstances) {
      for (const name of settings.autoStartInstanceList) {
        startInstance(name).catch((err) => console.warn(`[auto-start] ${name}:`, err));
      }
    }

    setTrayIconPath(trayIconPath());
    createWindow();
    if (mainWindow) tryCreateTray(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        if (mainWindow) tryCreateTray(mainWindow);
      }
    });
  });
}

app.on("before-quit", () => {
  setIsQuitting(true);
});

app.on("will-quit", async (e) => {
  if (process.platform === "darwin") return;
  e.preventDefault();
  try {
    await stopAllInstances();
  } catch {
    /* swallow */
  }
  destroyTray();
  app.exit(0);
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin" && !getIsQuitting()) return;
  if (getIsQuitting()) {
    setIsQuitting(false);
  }
});
