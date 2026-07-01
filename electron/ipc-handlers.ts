import { ipcMain, BrowserWindow, shell } from "electron";
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
  getAllInstanceStatuses,
  getInstanceLogs,
  syncStoreToMemory,
  onStatus,
  onLog,
} from "./instance-manager";
import { getInstances as storeGetInstances } from "./store";
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
  });

  ipcMain.handle("instances:getLogs", async (_event, name: string) => {
    return getInstanceLogs(name);
  });

  ipcMain.handle("instances:open-webui", async (_event, port: number, token: string) => {
    const url = `http://127.0.0.1:${port}/#token=${encodeURIComponent(token)}`;
    await shell.openExternal(url);
  });

  // Diagnostic: test spawning a process
  ipcMain.handle("debug:spawn", async (_event, command: string) => {
    const { execFileSync } = await import("child_process");
    try {
      const result = execFileSync("cmd.exe", ["/c", command], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
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
  ipcMain.handle("config:syncBlock", async (_event, sourceName: string, blockKey: string, targetNames: string[]) => {
    return configManager.syncBlockToInstances(sourceName, blockKey, targetNames);
  });
  ipcMain.handle("config:listTemplates", () => configManager.listTemplates());
  ipcMain.handle("config:createTemplate", (_event, input: { name: string; description?: string; blockKey: string; content: unknown }) =>
    configManager.createTemplate(input),
  );
  ipcMain.handle("config:updateTemplate", (_event, id: string, patch: { name?: string; description?: string; blockKey?: string; content?: unknown }) =>
    configManager.updateTemplate(id, patch),
  );
  ipcMain.handle("config:deleteTemplate", (_event, id: string) => configManager.deleteTemplate(id));
  ipcMain.handle("config:applyTemplate", async (_event, templateId: string, targets: string[]) => {
    return configManager.applyTemplate(templateId, targets);
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
