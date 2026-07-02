/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface Window {
  api: {
    versions: {
      listInstalled: () => Promise<string[]>;
      listAvailable: (force?: boolean) => Promise<{ version: string; publishedAt: string }[]>;
      install: (version: string) => Promise<void>;
      remove: (version: string) => Promise<void>;
      onInstallProgress: (callback: (data: { version: string; progress: string }) => void) => () => void;
    };
    instances: {
      list: () => Promise<InstanceConfig[]>;
      create: (params: { name: string; version: string; port?: number }) => Promise<InstanceConfig>;
      start: (name: string) => Promise<void>;
      stop: (name: string) => Promise<void>;
      restart: (name: string) => Promise<void>;
      remove: (name: string) => Promise<void>;
      forceReconnect: (name: string) => Promise<void>;
      stopReconnect: (name: string) => Promise<void>;
      debugDisconnectGateway: (name: string) => Promise<void>;
      getLogs: (name: string) => Promise<string[]>;
      openWebUI: (port: number, token: string) => Promise<void>;
      openTerminal: (instanceName: string) => Promise<void>;
      openFolder: (instanceName: string) => Promise<void>;
      onStatusChanged: (callback: (data: { name: string; status: InstanceStatus; message?: string }) => void) => () => void;
    debug: {
      spawn: (command: string, args?: string[]) => Promise<{ ok: boolean; output?: string; error?: string; stderr?: string; code?: number }>;
    };
      onLog: (callback: (data: { name: string; line: string }) => void) => () => void;
    };
    config: {
      read: (name: string) => Promise<ConfigDocument>;
      listBlocks: (name: string) => Promise<BlockSummary[]>;
      getBlock: (name: string, blockKey: string) => Promise<unknown>;
      setBlock: (name: string, blockKey: string, content: unknown) => Promise<SetBlockResult>;
      deleteBlock: (name: string, blockKey: string) => Promise<SetBlockResult>;
      diffBlock: (from: unknown, to: unknown) => Promise<string[]>;
      listInstances: () => Promise<{ name: string; hasConfig: boolean }[]>;
      syncBlock: (sourceName: string, blockKey: string, targetNames: string[]) => Promise<SyncResult>;
      listTemplates: () => Promise<ConfigTemplate[]>;
      createTemplate: (input: { name: string; description?: string; blockKey: string; content: unknown }) => Promise<ConfigTemplate>;
      updateTemplate: (id: string, patch: { name?: string; description?: string; blockKey?: string; content?: unknown }) => Promise<ConfigTemplate | undefined>;
      deleteTemplate: (id: string) => Promise<void>;
      applyTemplate: (templateId: string, targets: string[]) => Promise<SyncResult>;
      listBackups: (instanceName: string) => Promise<BackupEntry[]>;
      listAllBackups: () => Promise<BackupEntry[]>;
      restoreBackup: (instanceName: string, backupId: string) => Promise<{ ok: boolean; restoredFrom?: string; error?: string }>;
      deleteBackup: (instanceName: string, backupId: string) => Promise<void>;
      getBackupRetention: () => Promise<number | null>;
      setBackupRetention: (count: number | null) => Promise<void>;
    };
    app: {
      onTrayNavigateInstance: (callback: (name: string) => void) => () => void;
    };
    settings: {
      get: () => Promise<AppSettings>;
      set: (patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }) => Promise<void>;
    };
  };
}

interface AppSettings {
  autoStart: boolean;
  autoStartInstances: boolean;
  autoStartInstanceList: string[];
}

type InstanceStatus = "installed" | "starting" | "running" | "stopping" | "stopped" | "reconnecting" | "error" | "crashed";

interface InstanceConfig {
  name: string;
  version: string;
  port: number;
  token: string;
  stateDir: string;
  versionDir: string;
  status: InstanceStatus;
  statusMessage?: string;
  startedAt?: number;
  health?: {
    version?: string;
    uptime?: number;
  };
}

interface BlockSummary {
  key: string;
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  childCount: number;
  size: number;
}

interface ConfigDocument {
  raw: string;
  parsed: Record<string, unknown>;
  blocks: BlockSummary[];
}

interface SetBlockResult {
  ok: boolean;
  backupId?: string;
  error?: string;
}

interface SyncResult {
  ok: boolean;
  results: { name: string; ok: boolean; error?: string; backupId?: string }[];
}

interface ConfigTemplate {
  id: string;
  name: string;
  description?: string;
  blockKey: string;
  content: unknown;
  createdAt: number;
  updatedAt: number;
}

type BackupOperation = "edit" | "sync" | "template-apply" | "delete-block" | "restore";

interface BackupEntry {
  id: string;
  file: string;
  instanceName: string;
  operation: BackupOperation;
  source?: string;
  templateId?: string;
  templateName?: string;
  blockKey: string;
  createdAt: number;
  sizeBytes: number;
  format: "tar.gz" | "file-copy";
}
