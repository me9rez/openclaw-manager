import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  versions: {
    listInstalled: () => ipcRenderer.invoke("versions:list-installed"),
    listAvailable: (force?: boolean) => ipcRenderer.invoke("versions:list-available", force),
    install: (version: string) => ipcRenderer.invoke("versions:install", version),
    remove: (version: string) => ipcRenderer.invoke("versions:remove", version),
    onInstallProgress: (callback: (data: { version: string; progress: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { version: string; progress: string }) => callback(data);
      ipcRenderer.on("version:install-progress", handler);
      return () => ipcRenderer.removeListener("version:install-progress", handler);
    },
  },
  instances: {
    list: () => ipcRenderer.invoke("instances:list"),
    create: (params: { name: string; version: string; port?: number }) =>
      ipcRenderer.invoke("instances:create", params),
    start: (name: string) => ipcRenderer.invoke("instances:start", name),
    stop: (name: string) => ipcRenderer.invoke("instances:stop", name),
    restart: (name: string) => ipcRenderer.invoke("instances:restart", name),
    remove: (name: string) => ipcRenderer.invoke("instances:remove", name),
    confirmRemove: (name: string, isRunning: boolean) =>
      ipcRenderer.invoke("instances:confirm-remove", name, isRunning),
    updatePort: (name: string, port: number) => ipcRenderer.invoke("instances:update-port", name, port),
    checkConfigConsistency: (name: string) => ipcRenderer.invoke("instances:check-config-consistency", name),
    forceReconnect: (name: string) => ipcRenderer.invoke("instances:force-reconnect", name),
    stopReconnect: (name: string) => ipcRenderer.invoke("instances:stop-reconnect", name),
    debugDisconnectGateway: (name: string) => ipcRenderer.invoke("instances:debug-disconnect-gateway", name),
    getLogs: (name: string) => ipcRenderer.invoke("instances:getLogs", name),
    openWebUI: (port: number, token: string) => ipcRenderer.invoke("instances:open-webui", port, token),
    openTerminal: (instanceName: string) => ipcRenderer.invoke("instances:open-terminal", instanceName),
    openFolder: (instanceName: string) => ipcRenderer.invoke("instances:open-folder", instanceName),
    openInVSCode: (instanceName: string) => ipcRenderer.invoke("instances:open-vscode", instanceName),
    checkPort: (port: number, host?: string) => ipcRenderer.invoke("ports:check-availability", port, host),
    onStatusChanged: (callback: (data: { name: string; status: string; message?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { name: string; status: string; message?: string }) =>
        callback(data);
      ipcRenderer.on("instance:status-changed", handler);
      return () => ipcRenderer.removeListener("instance:status-changed", handler);
    },
    debug: {
      spawn: (command: string, args?: string[]) => ipcRenderer.invoke("debug:spawn", command, args),
    },
    onLog: (callback: (data: { name: string; line: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { name: string; line: string }) => callback(data);
      ipcRenderer.on("instance:log", handler);
      return () => ipcRenderer.removeListener("instance:log", handler);
    },
  },
  config: {
    read: (name: string) => ipcRenderer.invoke("config:read", name),
    listBlocks: (name: string) => ipcRenderer.invoke("config:listBlocks", name),
    getBlock: (name: string, blockKey: string) => ipcRenderer.invoke("config:getBlock", name, blockKey),
    setBlock: (name: string, blockKey: string, content: unknown) =>
      ipcRenderer.invoke("config:setBlock", name, blockKey, content),
    deleteBlock: (name: string, blockKey: string) => ipcRenderer.invoke("config:deleteBlock", name, blockKey),
    diffBlock: (from: unknown, to: unknown) => ipcRenderer.invoke("config:diffBlock", from, to),
    listInstances: () => ipcRenderer.invoke("config:listInstances"),
    syncBlock: (sourceName: string, blockKey: string, targetNames: string[], mode: "overwrite" | "merge") =>
      ipcRenderer.invoke("config:syncBlock", sourceName, blockKey, targetNames, mode),
    listTemplates: () => ipcRenderer.invoke("config:listTemplates"),
    createTemplate: (input: { name: string; description?: string; blockKey: string; content: unknown }) =>
      ipcRenderer.invoke("config:createTemplate", input),
    updateTemplate: (id: string, patch: { name?: string; description?: string; blockKey?: string; content?: unknown }) =>
      ipcRenderer.invoke("config:updateTemplate", id, patch),
    deleteTemplate: (id: string) => ipcRenderer.invoke("config:deleteTemplate", id),
    applyTemplate: (templateId: string, targets: string[], mode: "overwrite" | "merge") =>
      ipcRenderer.invoke("config:applyTemplate", templateId, targets, mode),
    importTemplates: (inputs: { name: string; description?: string; blockKey: string; content: unknown }[]) =>
      ipcRenderer.invoke("config:importTemplates", inputs),
    importOpenclawPreview: () => ipcRenderer.invoke("config:importOpenclawPreview"),
    listBackups: (instanceName: string) => ipcRenderer.invoke("config:listBackups", instanceName),
    listAllBackups: () => ipcRenderer.invoke("config:listAllBackups"),
    restoreBackup: (instanceName: string, backupId: string) =>
      ipcRenderer.invoke("config:restoreBackup", instanceName, backupId),
    deleteBackup: (instanceName: string, backupId: string) =>
      ipcRenderer.invoke("config:deleteBackup", instanceName, backupId),
    getBackupRetention: () => ipcRenderer.invoke("config:getBackupRetention"),
    setBackupRetention: (count: number | null) => ipcRenderer.invoke("config:setBackupRetention", count),
  },
  app: {
    onTrayNavigateInstance: (callback: (name: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, name: string) => callback(name);
      ipcRenderer.on("tray:navigate-instance", handler);
      return () => ipcRenderer.removeListener("tray:navigate-instance", handler);
    },
    copyText: (text: string) => ipcRenderer.invoke("app:copyText", text),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }) =>
      ipcRenderer.invoke("settings:set", patch),
  },
});
