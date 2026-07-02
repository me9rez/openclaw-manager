import { app } from "electron";
import fs from "fs";
import path from "path";

export interface InstanceRecord {
  name: string;
  version: string;
  port: number;
  token: string;
}

export interface ConfigTemplate {
  id: string;
  name: string;
  description?: string;
  blockKey: string;
  content: unknown;
  createdAt: number;
  updatedAt: number;
}

interface StoreData {
  instances: InstanceRecord[];
  versions: string[];
  nextPort: number;
  managerDir: string;
  configTemplates: ConfigTemplate[];
  backupRetention: number | null;
  autoStart: boolean;
  autoStartInstances: boolean;
  autoStartInstanceList: string[];
}

const storePath = path.join(app.getPath("userData"), "manager-config.json");

function ensureDir(): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function read(): StoreData {
  try {
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        instances: parsed.instances ?? [],
        versions: parsed.versions ?? [],
        nextPort: parsed.nextPort ?? 18789,
        managerDir: parsed.managerDir ?? path.join(app.getPath("home"), ".openclaw-manager"),
        configTemplates: parsed.configTemplates ?? [],
        backupRetention: parsed.backupRetention ?? 20,
        autoStart: parsed.autoStart ?? false,
        autoStartInstances: parsed.autoStartInstances ?? false,
        autoStartInstanceList: parsed.autoStartInstanceList ?? [],
      };
    }
  } catch {
    // fall through to defaults
  }
  return {
    instances: [],
    versions: [],
    nextPort: 18789,
    managerDir: path.join(app.getPath("home"), ".openclaw-manager"),
    configTemplates: [],
    backupRetention: 20,
    autoStart: false,
    autoStartInstances: false,
    autoStartInstanceList: [],
  };
}

function write(data: StoreData): void {
  ensureDir();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getInstances(): InstanceRecord[] {
  return read().instances;
}

export function setInstances(instances: InstanceRecord[]): void {
  const data = read();
  data.instances = instances;
  write(data);
}

export function getInstance(name: string): InstanceRecord | undefined {
  return getInstances().find((i) => i.name === name);
}

export function addInstance(record: InstanceRecord): void {
  const list = getInstances();
  list.push(record);
  setInstances(list);
}

export function removeInstance(name: string): void {
  setInstances(getInstances().filter((i) => i.name !== name));
}

export function updateInstance(name: string, update: Partial<InstanceRecord>): void {
  const list = getInstances();
  const idx = list.findIndex((i) => i.name === name);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...update };
    setInstances(list);
  }
}

export function getVersions(): string[] {
  return read().versions;
}

export function addVersion(version: string): void {
  const data = read();
  if (!data.versions.includes(version)) {
    data.versions.push(version);
    write(data);
  }
}

export function removeVersion(version: string): void {
  const data = read();
  data.versions = data.versions.filter((v) => v !== version);
  write(data);
}

export function getNextPort(reservedPorts?: Set<number>): number {
  const data = read();
  const reserved = reservedPorts ?? new Set<number>();
  let port = data.nextPort;
  for (let i = 0; i < 1000; i++) {
    if (!reserved.has(port)) {
      data.nextPort = port + 1;
      write(data);
      return port;
    }
    port++;
  }
  data.nextPort = port + 1;
  write(data);
  return port;
}

export function getManagerDir(): string {
  return read().managerDir;
}

export function getInstanceDir(name: string): string {
  return path.join(getManagerDir(), "instances", name);
}

export function getVersionDir(version: string): string {
  return path.join(getManagerDir(), "versions", version);
}

export function listTemplates(): ConfigTemplate[] {
  return read().configTemplates;
}

export function getTemplate(id: string): ConfigTemplate | undefined {
  return read().configTemplates.find((t) => t.id === id);
}

export function addTemplate(template: ConfigTemplate): void {
  const data = read();
  data.configTemplates.push(template);
  write(data);
}

export function updateTemplate(id: string, patch: Partial<ConfigTemplate>): ConfigTemplate | undefined {
  const data = read();
  const idx = data.configTemplates.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  data.configTemplates[idx] = { ...data.configTemplates[idx], ...patch, id, updatedAt: Date.now() };
  write(data);
  return data.configTemplates[idx];
}

export function removeTemplate(id: string): void {
  const data = read();
  data.configTemplates = data.configTemplates.filter((t) => t.id !== id);
  write(data);
}

export function getBackupRetention(): number | null {
  return read().backupRetention;
}

export function setBackupRetention(count: number | null): void {
  const data = read();
  data.backupRetention = count;
  write(data);
}

export function getSettings(): { autoStart: boolean; autoStartInstances: boolean; autoStartInstanceList: string[] } {
  const data = read();
  return {
    autoStart: data.autoStart,
    autoStartInstances: data.autoStartInstances,
    autoStartInstanceList: data.autoStartInstanceList,
  };
}

export function updateSettings(patch: { autoStart?: boolean; autoStartInstances?: boolean; autoStartInstanceList?: string[] }): void {
  const data = read();
  if (patch.autoStart !== undefined) data.autoStart = patch.autoStart;
  if (patch.autoStartInstances !== undefined) data.autoStartInstances = patch.autoStartInstances;
  if (patch.autoStartInstanceList !== undefined) data.autoStartInstanceList = patch.autoStartInstanceList;
  write(data);
}
