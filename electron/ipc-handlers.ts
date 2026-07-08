import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { ipcMain, BrowserWindow, shell, app, dialog, clipboard } from "electron";
import {
  listAvailableVersions,
  installVersion,
  uninstallVersion,
  getInstalledVersions,
} from "./version-manager";
import {
  createInstance,
  startInstance,
  stopInstance,
  removeInstance,
  forceReconnectInstance,
  stopReconnectInstance,
  getAllInstanceStatuses,
  getInstanceLogs,
  syncStoreToMemory,
  onStatus,
  onLog,
} from "./instance-manager";
import { getInstances as storeGetInstances, getInstance, getInstanceDir, getVersionDir, getSettings, updateSettings } from "./store";
import * as configManager from "./config-manager";

export function registerIpcHandlers(): void {
  // Versions
  ipcMain.handle("versions:list-installed", () => {
    return getInstalledVersions();
  });

  ipcMain.handle("versions:list-available", async (_event, force?: boolean) => {
    return await listAvailableVersions(force ?? false);
  });

  ipcMain.handle("versions:install", async (_event, version: string) => {
    await installVersion(version);
  });

  ipcMain.handle("versions:remove", async (_event, version: string) => {
    uninstallVersion(version);
  });

  // Instances
  ipcMain.handle("instances:list", () => {
    const records = storeGetInstances();
    const statuses = getAllInstanceStatuses();
    return records.map((r) => {
      const s = statuses.find((s) => s.name === r.name);
      return {
        ...r,
        status: s?.status || "stopped",
        statusMessage: s?.statusMessage,
        startedAt: s?.startedAt,
        health: s?.health,
      };
    });
  });

  ipcMain.handle("instances:create", async (_event, params: { name: string; version: string; port?: number }) => {
    await createInstance(params.name, params.version, params.port);
  });

  ipcMain.handle("instances:start", async (_event, name: string) => {
    await startInstance(name);
  });

  ipcMain.handle("instances:stop", async (_event, name: string) => {
    await stopInstance(name);
  });

  ipcMain.handle("instances:restart", async (_event, name: string) => {
    await stopInstance(name);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await startInstance(name);
  });

  ipcMain.handle("instances:remove", async (_event, name: string) => {
    removeInstance(name);
    const s = getSettings();
    if (s.autoStartInstanceList.includes(name)) {
      updateSettings({ autoStartInstanceList: s.autoStartInstanceList.filter((n) => n !== name) });
    }
  });

  ipcMain.handle("instances:force-reconnect", async (_event, name: string) => {
    forceReconnectInstance(name);
  });

  ipcMain.handle("instances:stop-reconnect", async (_event, name: string) => {
    stopReconnectInstance(name);
  });

  // Diagnostic: simulate a WS drop without killing the gateway process,
  // so the auto-reconnect path can be exercised from tests.
  ipcMain.handle("instances:debug-disconnect-gateway", async (_event, name: string) => {
    const inst = getAllInstanceStatuses().find((s) => s.name === name);
    if (!inst) throw new Error(`Instance "${name}" not found`);
    inst.gateway?.simulateDisconnect();
  });

  ipcMain.handle("instances:getLogs", async (_event, name: string) => {
    return getInstanceLogs(name);
  });

  ipcMain.handle("instances:open-webui", async (_event, port: number, token: string) => {
    const url = `http://127.0.0.1:${port}/#token=${encodeURIComponent(token)}`;
    await shell.openExternal(url);
  });

  ipcMain.handle("instances:open-terminal", async (_event, instanceName: string) => {
    const record = getInstance(instanceName);
    if (!record) throw new Error(`Instance "${instanceName}" not found`);
    const cwd = getInstanceDir(instanceName);
    const binDir = path.join(getVersionDir(record.version), "node_modules", ".bin");
    const psScript = path.join(os.tmpdir(), `openclaw-${instanceName}.ps1`);
    const psCmd = [
      `$env:PATH = "${binDir};$env:PATH"`,
      `$env:OPENCLAW_CONFIG_PATH = "${path.join(cwd, "openclaw.json")}"`,
      `$env:OPENCLAW_STATE_DIR = "${cwd}"`,
      `$env:OPENCLAW_GATEWAY_TOKEN = "${record.token}"`,
      `$env:OPENCLAW_WORKSPACE_DIR = "${path.join(cwd, "workspace")}"`,
      `Set-Location '${cwd}'`,
    ].join("; ");
    fs.writeFileSync(psScript, psCmd, "utf-8");
    exec(
      `start "PowerShell" powershell.exe -NoExit -WindowStyle Normal -ExecutionPolicy Bypass -File "${psScript}"`,
      (error) => { if (error) console.error(`[open-terminal] exec error:`, error); },
    );
  });

  ipcMain.handle("instances:open-folder", async (_event, instanceName: string) => {
    const record = getInstance(instanceName);
    if (!record) throw new Error(`Instance "${instanceName}" not found`);
    const dir = getInstanceDir(instanceName);
    await shell.openPath(dir);
  });

  // Diagnostic: test spawning a process
  ipcMain.handle("debug:spawn", async (_event, command: string, args?: string[]) => {
    const { execFileSync } = await import("child_process");
    const opts = {
      encoding: "utf-8" as const,
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      windowsHide: true,
    };
    try {
      let result: string;
      if (args) {
        result = execFileSync(command, args, opts);
      } else if (process.platform === "win32") {
        result = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], opts);
      } else {
        result = execFileSync("sh", ["-c", command], opts);
      }
      return { ok: true, output: result };
    } catch (err: unknown) {
      const e = err as { message?: string; stderr?: string; status?: number };
      return {
        ok: false,
        error: e.message || String(err),
        stderr: e.stderr || "",
        code: e.status,
      };
    }
  });

  // Config
  ipcMain.handle("config:read", (_event, name: string) => configManager.readInstanceConfig(name));
  ipcMain.handle("config:listBlocks", (_event, name: string) => configManager.listInstanceBlocks(name));
  ipcMain.handle("config:getBlock", (_event, name: string, blockKey: string) =>
    configManager.getInstanceBlock(name, blockKey),
  );
  ipcMain.handle("config:setBlock", async (_event, name: string, blockKey: string, content: unknown) => {
    return configManager.setInstanceBlock(name, blockKey, content);
  });
  ipcMain.handle("config:deleteBlock", async (_event, name: string, blockKey: string) => {
    return configManager.deleteInstanceBlock(name, blockKey);
  });
  ipcMain.handle("config:diffBlock", (_event, from: unknown, to: unknown) => configManager.diffBlock(from, to));
  ipcMain.handle("config:listInstances", () => configManager.listAllInstancesWithConfig());
  ipcMain.handle("config:syncBlock", async (_event, sourceName: string, blockKey: string, targetNames: string[], mode: "overwrite" | "merge") => {
    return configManager.syncBlockToInstances(sourceName, blockKey, targetNames, mode);
  });
  ipcMain.handle("config:listTemplates", () => configManager.listTemplates());
  ipcMain.handle("config:createTemplate", (_event, input: { name: string; description?: string; blockKey: string; content: unknown }) =>
    configManager.createTemplate(input),
  );
  ipcMain.handle("config:updateTemplate", (_event, id: string, patch: { name?: string; description?: string; blockKey?: string; content?: unknown }) =>
    configManager.updateTemplate(id, patch),
  );
  ipcMain.handle("config:deleteTemplate", (_event, id: string) => configManager.deleteTemplate(id));
  ipcMain.handle("config:applyTemplate", async (_event, templateId: string, targets: string[], mode: "overwrite" | "merge") => {
    return configManager.applyTemplate(templateId, targets, mode);
  });
  ipcMain.handle("config:importTemplates", (_event, inputs: { name: string; description?: string; blockKey: string; content: unknown }[]) =>
    configManager.importTemplates(inputs),
  );
  ipcMain.handle("config:importOpenclawPreview", async () => {
    const opts: Electron.OpenDialogOptions = {
      title: "选择 openclaw.json",
      properties: ["openFile"],
      filters: [{ name: "OpenClaw 配置", extensions: ["json"] }],
    };
    const win = BrowserWindow.getFocusedWindow();
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const preview = configManager.parseOpenclawJsonBlocks(content, path.basename(filePath));
      return { canceled: false, preview };
    } catch (err) {
      return { canceled: false, error: (err as Error).message };
    }
  });
  ipcMain.handle("config:listBackups", (_event, instanceName: string) => configManager.listBackups(instanceName));
  ipcMain.handle("config:listAllBackups", () => configManager.listAllBackups());
  ipcMain.handle("config:restoreBackup", async (_event, instanceName: string, backupId: string) => {
    return configManager.restoreBackup(instanceName, backupId);
  });
  ipcMain.handle("config:deleteBackup", async (_event, instanceName: string, backupId: string) => {
    await configManager.deleteBackup(instanceName, backupId);
  });
  ipcMain.handle("config:getBackupRetention", () => configManager.getBackupRetentionSetting());
  ipcMain.handle("config:setBackupRetention", (_event, count: number | null) => {
    configManager.setBackupRetentionSetting(count);
  });

  // App
  ipcMain.handle("app:copyText", (_event, text: string) => {
    clipboard.writeText(text);
  });

  // Settings
  ipcMain.handle("settings:get", () => {
    return getSettings();
  });

  ipcMain.handle("settings:set", (_event, patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }) => {
    if (patch.autoStart !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.autoStart });
    }
    updateSettings(patch);
  });
}

export function setupEventForwarders(window: BrowserWindow): void {
  const cleanup: (() => void)[] = [];

  cleanup.push(
    onStatus((data) => {
      if (!window.isDestroyed()) {
        window.webContents.send("instance:status-changed", data);
      }
    }),
  );

  cleanup.push(
    onLog((data) => {
      if (!window.isDestroyed()) {
        window.webContents.send("instance:log", data);
      }
    }),
  );

  window.on("closed", () => {
    for (const fn of cleanup) fn();
  });
}

export function initInstances(): void {
  syncStoreToMemory();
}
