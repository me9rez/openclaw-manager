import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { registerIpcHandlers, setupEventForwarders, initInstances } from "./ipc-handlers";
import { createTray, destroyTray, setTrayIconPath } from "./tray";
import { stopAllInstances, startInstance } from "./instance-manager";
import { getIsQuitting, setIsQuitting } from "./app-state";
import { getSettings } from "./store";
import { getNotificationService } from "./notification-service";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Windows 上 Notification 需要 AppUserModelId,否则通知会被归到 "Electron"
// 这个通用名字下,且点不开。Linux 不需要,macOS 走 bundle id。
// 必须在 app.whenReady() 之前设置,否则 Windows 不生效。
if (process.platform === "win32") {
  app.setAppUserModelId("com.openclaw.manager");
}

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// 进程级错误兜底
// ---------------------------------------------------------------------------
//
// 我们把 uncaughtException + unhandledRejection 的 handler 装在最前面,
// 让 Electron 主进程永远不会因为一次意外的 throw 就弹出 "A JavaScript
// error occurred in the main process" 对话框。两类 throw 以前会触达用户:
//
//   1. 异步的 `WebSocket.terminate()` / `.close()` 错误,由 `ws` 库在
//      CONNECTING 状态的 socket 被强拆时发出(典型场景:用户在握手中途
//      停止实例)。throw 发生在下一个 tick,而我们之前已经
//      `.removeAllListeners()` 把它丢出去了,没人接。
//   2. 任何 fire-and-forget 链上的 Promise reject(例如一不小心
//      `void doWork()` 漏了 catch)。
//
// 我们把每次这样的错误都记到 stderr 和 `app.getPath("logs")` 下的滚动
// 文件,并对相同 message 做去重,避免死循环把日志刷爆。
function installProcessErrorGuards(): void {
  const logFile = (() => {
    try {
      const dir = app.getPath("logs");
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, "main-uncaught.log");
    } catch {
      return null;
    }
  })();

  // 按 message 节流:一个一直抛的 `setInterval` 不能把日志刷爆。
  // map 存首次见到的时间戳;每次调用时把 5s 前的过期项清掉。
  const recent = new Map<string, number>();
  const WINDOW_MS = 5_000;
  const MAX_KEYS = 200;

  const shouldLog = (key: string): boolean => {
    const now = Date.now();
    for (const [k, t] of recent) {
      if (now - t > WINDOW_MS) recent.delete(k);
    }
    if (recent.size > MAX_KEYS) recent.clear();
    if (recent.has(key)) return false;
    recent.set(key, now);
    return true;
  };

  const record = (kind: "uncaughtException" | "unhandledRejection", payload: unknown): void => {
    const err = payload instanceof Error ? payload : new Error(String(payload));
    const key = `${kind}::${err.name}::${err.message}`;
    if (!shouldLog(key)) return;

    const stamp = new Date().toISOString();
    const lines = [
      `[${stamp}] ${kind}: ${err.message}`,
      err.stack ?? "(no stack)",
      "",
    ];
    const block = lines.join("\n");
    // eslint-disable-next-line no-console
    console.error(block);

    if (logFile) {
      try {
        fs.appendFileSync(logFile, block, "utf-8");
      } catch {
        // ignore — best-effort logging,失败也不能让记录路径再炸
      }
    }
  };

  process.on("uncaughtException", (err) => {
    record("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    record("unhandledRejection", reason);
  });
}

installProcessErrorGuards();

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
    /* 吞掉,关 app 时不再雪上加霜 */
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
