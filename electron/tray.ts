import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import {
  getInstanceSummaries,
  getRunningCount,
  onStatus,
} from "./instance-manager";
import { setIsQuitting } from "./app-state";

const STATUS_LABEL: Record<string, string> = {
  installed: "已安装",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  stopped: "已停止",
  error: "错误",
  crashed: "崩溃",
};

let tray: Tray | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let unsubscribeStatus: (() => void) | null = null;
let trayIconPath = "";

export function setTrayIconPath(p: string): void {
  trayIconPath = p;
}

function buildMenu(win: BrowserWindow): Menu {
  const summaries = getInstanceSummaries();
  const running = summaries.filter((s) => s.status === "running" || s.status === "starting");
  const runningCount = getRunningCount();

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "显示主窗口",
      click: () => showWindow(win),
    },
    { type: "separator" },
  ];

  if (running.length > 0) {
    template.push({
      label: `运行中的实例 (${runningCount})`,
      enabled: false,
    });
    for (const s of running) {
      template.push({
        label: `${s.name}   ${STATUS_LABEL[s.status] ?? s.status}`,
        click: () => {
          showWindow(win);
          win.webContents.send("tray:navigate-instance", s.name);
        },
      });
    }
    template.push({ type: "separator" });
  }

  if (summaries.length > 0) {
    template.push({
      label: `所有实例 (${summaries.length})`,
      enabled: false,
    });
    for (const s of summaries) {
      template.push({
        label: `${s.name}   ${STATUS_LABEL[s.status] ?? s.status}`,
        click: () => {
          showWindow(win);
          win.webContents.send("tray:navigate-instance", s.name);
        },
      });
    }
    template.push({ type: "separator" });
  }

  template.push({
    label: "退出",
    click: () => {
      setIsQuitting(true);
      app.quit();
    },
  });

  return Menu.buildFromTemplate(template);
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function scheduleRefresh(win: BrowserWindow): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!tray || tray.isDestroyed()) return;
    try {
      tray.setContextMenu(buildMenu(win));
    } catch {
      /* tray may be gone */
    }
  }, 200);
}

export function createTray(win: BrowserWindow): Tray {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildMenu(win));
    return tray;
  }
  let image = nativeImage.createFromPath(trayIconPath);
  if (image.isEmpty()) {
    const fallback = trayIconPath.replace(/icon-tray\.png$/, "icon.ico");
    console.warn(`[tray] icon not loaded from ${trayIconPath}, falling back to ${fallback}`);
    image = nativeImage.createFromPath(fallback);
  }
  tray = new Tray(image);
  tray.setToolTip("OpenClaw Manager");
  tray.setContextMenu(buildMenu(win));
  tray.on("click", () => {
    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
    } else {
      showWindow(win);
    }
  });
  if (!unsubscribeStatus) {
    unsubscribeStatus = onStatus(() => scheduleRefresh(win));
  }
  return tray;
}

export function destroyTray(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (unsubscribeStatus) {
    unsubscribeStatus();
    unsubscribeStatus = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

export function refreshTrayMenu(win: BrowserWindow): void {
  scheduleRefresh(win);
}
