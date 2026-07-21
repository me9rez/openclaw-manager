import fs from "fs";
import path from "path";
import os from "os";
import { exec, spawn } from "child_process";
import { ipcMain, BrowserWindow, shell, app, dialog, clipboard } from "electron";
import {
  listAvailableVersions,
  installVersion,
  uninstallVersion,
  getInstalledVersions,
  findInstancesUsingVersion,
} from "./version-manager";
import { getInstances as storeGetInstances, getInstance, getInstanceDir, getVersionDir, getSettings, updateSettings, updateInstance } from "./store";
import { isPortAvailable } from "./port-utils";
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
  updateInstancePort,
  checkConfigConsistency,
} from "./instance-manager";
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
    // Refuse to uninstall a version that's still referenced by one or more
    // instances — deleting the directory would break the instance's
    // `node_modules/openclaw/openclaw.mjs` entry the next time it tries
    // to spawn, and the manager has no way to roll that back.
    const inUse = findInstancesUsingVersion(version, storeGetInstances);
    if (inUse.length > 0) {
      throw new Error(
        `版本 ${version} 正被以下实例使用,无法删除: ${inUse.join(", ")}。请先删除或迁移这些实例。`,
      );
    }
    await uninstallVersion(version);
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
    return await createInstance(params.name, params.version, params.port);
  });

  // Probe a single TCP port. Returns whether the port is free right now, plus
  // metadata the UI can show ("checking…", "available", "in use").
  ipcMain.handle("ports:check-availability", async (_event, port: number, host?: string) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }
    const available = await isPortAvailable(port, host ?? "127.0.0.1");
    return { port, host: host ?? "127.0.0.1", available };
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

  // Show a native confirm dialog before the renderer deletes an instance.
  // The renderer can pass the instance's `running` flag so we can warn
  // about stopping + deletion together, and `port` so the dialog can
  // point the user at the right instance.
  ipcMain.handle(
    "instances:confirm-remove",
    async (_event, name: string, isRunning: boolean) => {
      const win = BrowserWindow.getFocusedWindow();
      const detail = isRunning
        ? `实例 "${name}" 仍在运行。删除会先停止网关进程,再删除状态目录和配置,且不可恢复。`
        : `删除会移除实例的状态目录和配置,且不可恢复。`;
      const opts: Electron.MessageBoxOptions = {
        type: "warning",
        buttons: ["取消", "删除"],
        defaultId: 0,
        cancelId: 0,
        title: "删除实例",
        message: `确定要删除实例 "${name}" 吗?`,
        detail,
        noLink: true,
      };
      const result = win
        ? await dialog.showMessageBox(win, opts)
        : await dialog.showMessageBox(opts);
      return result.response === 1;
    },
  );

  // Update the port of an existing instance. The instance must be stopped
  // (or at least not running) — changing the port on a running gateway
  // would desync the in-memory client, the store, and the child process.
  ipcMain.handle(
    "instances:update-port",
    async (_event, name: string, port: number) => {
      return updateInstancePort(name, port);
    },
  );

  // Compare the port in manager-config.json with the port in
  // <instanceDir>/openclaw.json and report any drift.
  ipcMain.handle("instances:check-config-consistency", async (_event, name: string) => {
    return checkConfigConsistency(name);
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

  ipcMain.handle("instances:open-vscode", async (_event, instanceName: string) => {
    const record = getInstance(instanceName);
    if (!record) throw new Error(`Instance "${instanceName}" not found`);
    const instanceDir = getInstanceDir(instanceName);
    const workspaceDir = path.join(instanceDir, "workspace");
    const target = fs.existsSync(workspaceDir) ? workspaceDir : instanceDir;

    const isWin = process.platform === "win32";
    const binName = isWin ? "code.cmd" : "code";

    const opened = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(binName, [target], {
          stdio: "ignore",
          windowsHide: true,
          detached: !isWin,
          shell: isWin,
        });
      } catch {
        finish(false);
        return;
      }
      child.on("error", () => finish(false));
      child.once("spawn", () => finish(true));
      setTimeout(() => finish(true), 150);
      child.unref();
    });
    if (opened) return { ok: true };

    const errMsg = await shell.openPath(target);
    return errMsg ? { ok: false, error: errMsg } : { ok: true };
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
