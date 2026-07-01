import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  getInstance as storeGetInstance,
  getInstanceDir,
  getInstances as storeGetInstances,
  listTemplates as storeListTemplates,
  getTemplate as storeGetTemplate,
  addTemplate as storeAddTemplate,
  updateTemplate as storeUpdateTemplate,
  removeTemplate as storeRemoveTemplate,
  getBackupRetention,
  setBackupRetention as storeSetBackupRetention,
  type ConfigTemplate,
} from "./store";
import { getOpenClawEntry, resolveNodeBinary } from "./version-manager";

export interface BlockSummary {
  key: string;
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  childCount: number;
  size: number;
}

export interface ConfigDocument {
  raw: string;
  parsed: Record<string, unknown>;
  blocks: BlockSummary[];
}

export type BackupOperation = "edit" | "sync" | "template-apply" | "delete-block" | "restore";

export interface BackupEntry {
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

export interface SetBlockResult {
  ok: boolean;
  backupId?: string;
  error?: string;
}

export interface SyncTargetResult {
  name: string;
  ok: boolean;
  error?: string;
  backupId?: string;
}

export interface SyncResult {
  ok: boolean;
  results: SyncTargetResult[];
}

const PROTECTED_PATHS: Record<string, string[]> = {
  gateway: ["auth.token"],
};

function getInstanceVersion(name: string): string | null {
  return storeGetInstance(name)?.version ?? null;
}

function getInstanceConfigPath(name: string): string {
  return path.join(getInstanceDir(name), "openclaw.json");
}

function getBackupsDir(name: string): string {
  return path.join(getInstanceDir(name), "backups");
}

function getManifestPath(name: string): string {
  return path.join(getBackupsDir(name), "backups-manifest.json");
}

function readManifest(name: string): BackupEntry[] {
  const p = getManifestPath(name);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(name: string, entries: BackupEntry[]): void {
  const p = getManifestPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), "utf-8");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeys(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return value;
}

function summarizeBlock(key: string, value: unknown): BlockSummary {
  const serialized = stableStringify(value, 0);
  let type: BlockSummary["type"] = "null";
  let childCount = 0;
  if (Array.isArray(value)) {
    type = "array";
    childCount = value.length;
  } else if (isPlainObject(value)) {
    type = "object";
    childCount = Object.keys(value).length;
  } else if (typeof value === "string") type = "string";
  else if (typeof value === "number") type = "number";
  else if (typeof value === "boolean") type = "boolean";
  return { key, type, childCount, size: Buffer.byteLength(serialized, "utf-8") };
}

export function readInstanceConfig(name: string): ConfigDocument {
  const configPath = getInstanceConfigPath(name);
  let raw = "{}";
  if (fs.existsSync(configPath)) {
    raw = fs.readFileSync(configPath, "utf-8");
  }
  let parsed: Record<string, unknown> = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) parsed = {};
    } catch {
      parsed = {};
    }
  }
  const blocks: BlockSummary[] = [];
  for (const k of Object.keys(parsed).sort()) {
    blocks.push(summarizeBlock(k, parsed[k]));
  }
  return { raw, parsed, blocks };
}

export function listInstanceBlocks(name: string): BlockSummary[] {
  return readInstanceConfig(name).blocks;
}

export function getInstanceBlock(name: string, blockKey: string): unknown {
  const doc = readInstanceConfig(name);
  return doc.parsed[blockKey];
}

function applyProtectedMerge(
  blockKey: string,
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const protectedPaths = PROTECTED_PATHS[blockKey];
  if (!protectedPaths || protectedPaths.length === 0) return incoming;
  const merged = deepClone(incoming);
  for (const path of protectedPaths) {
    const segs = path.split(".");
    let cur: Record<string, unknown> | undefined = current;
    let tgt: Record<string, unknown> | undefined = merged;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!cur || !isPlainObject(cur[seg])) break;
      if (i === segs.length - 1) {
        if (isPlainObject(tgt)) tgt[seg] = cur[seg];
      } else {
        if (isPlainObject(tgt) && isPlainObject(tgt[seg])) {
          tgt = tgt[seg] as Record<string, unknown>;
        } else {
          tgt = undefined;
          break;
        }
        cur = cur[seg] as Record<string, unknown>;
      }
    }
  }
  return merged;
}

function atomicWriteJson(filePath: string, content: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(content, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function looksLikeUnsupportedCommand(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  return text.includes("unknown command") || text.includes("unrecognized") || text.includes("invalid command") || text.includes("'backup'");
}

async function createBackup(
  name: string,
  operation: BackupOperation,
  meta: { source?: string; templateId?: string; templateName?: string; blockKey: string },
): Promise<BackupEntry> {
  const instanceDir = getInstanceDir(name);
  const configPath = getInstanceConfigPath(name);
  const backupsDir = getBackupsDir(name);
  fs.mkdirSync(backupsDir, { recursive: true });

  if (!fs.existsSync(configPath)) {
    throw new Error(`openclaw.json not found for instance "${name}"`);
  }

  const version = getInstanceVersion(name);
  if (!version) {
    throw new Error(`Instance "${name}" not found in store`);
  }
  const entry = getOpenClawEntry(version);
  const nodeExe = resolveNodeBinary();

  const args: string[] = [];
  if (entry) {
    args.push(entry, "backup", "create", "--only-config", "--output", backupsDir);
  }

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  const runResult = await new Promise<{ code: number | null; stdout: string; stderr: string; unsupported: boolean }>((resolve, reject) => {
    if (!entry) {
      resolve({ code: 0, stdout: "", stderr: "", unsupported: true });
      return;
    }
    const child = spawn(nodeExe, args, {
      cwd: instanceDir,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: instanceDir,
        OPENCLAW_CONFIG_PATH: configPath,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      const unsupported = looksLikeUnsupportedCommand(stderr, stdout);
      resolve({ code, stdout, stderr, unsupported });
    });
  });

  exitCode = runResult.code;

  if (runResult.unsupported) {
    return fallbackFileCopyBackup(name, operation, meta, configPath, backupsDir);
  }

  if (exitCode !== 0) {
    throw new Error(`openclaw backup failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`);
  }

  const archive = findNewestArchive(backupsDir, Date.now() - 60_000);
  if (!archive) {
    return fallbackFileCopyBackup(name, operation, meta, configPath, backupsDir);
  }

  const id = path.basename(archive, ".tar.gz");
  const stat = fs.statSync(archive);
  const entry2: BackupEntry = {
    id,
    file: path.basename(archive),
    instanceName: name,
    operation,
    source: meta.source,
    templateId: meta.templateId,
    templateName: meta.templateName,
    blockKey: meta.blockKey,
    createdAt: stat.mtimeMs,
    sizeBytes: stat.size,
    format: "tar.gz",
  };
  appendManifest(name, entry2);
  applyRetention(name);
  return entry2;
}

function findNewestArchive(dir: string, notBeforeMs: number): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith("-openclaw-backup.tar.gz"))
    .map((f) => path.join(dir, f));
  let newest: { p: string; mtime: number } | null = null;
  for (const f of files) {
    try {
      const mtime = fs.statSync(f).mtimeMs;
      if (mtime >= notBeforeMs - 2000 && (!newest || mtime > newest.mtime)) {
        newest = { p: f, mtime };
      }
    } catch {
      continue;
    }
  }
  return newest?.p ?? null;
}

function fallbackFileCopyBackup(
  name: string,
  operation: BackupOperation,
  meta: { source?: string; templateId?: string; templateName?: string; blockKey: string },
  sourcePath: string,
  backupsDir: string,
): BackupEntry {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${ts}-openclaw-backup.json`;
  const target = path.join(backupsDir, fileName);
  fs.copyFileSync(sourcePath, target);
  const stat = fs.statSync(target);
  const entry: BackupEntry = {
    id: ts.replace(/-\d{3}Z$/, "Z"),
    file: fileName,
    instanceName: name,
    operation,
    source: meta.source,
    templateId: meta.templateId,
    templateName: meta.templateName,
    blockKey: meta.blockKey,
    createdAt: stat.mtimeMs,
    sizeBytes: stat.size,
    format: "file-copy",
  };
  appendManifest(name, entry);
  applyRetention(name);
  return entry;
}

function appendManifest(name: string, entry: BackupEntry): void {
  const list = readManifest(name);
  list.push(entry);
  writeManifest(name, list);
}

function applyRetention(name: string): void {
  const limit = getBackupRetention();
  if (limit === null || limit === undefined) return;
  const list = readManifest(name);
  if (list.length <= limit) return;
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
  const toRemove = sorted.slice(0, list.length - limit);
  const removeIds = new Set(toRemove.map((e) => e.id));
  const backupsDir = getBackupsDir(name);
  for (const e of toRemove) {
    const p = path.join(backupsDir, e.file);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
  writeManifest(name, list.filter((e) => !removeIds.has(e.id)));
}

function findEntry(name: string, backupId: string): BackupEntry | null {
  return readManifest(name).find((e) => e.id === backupId) ?? null;
}

function diffLines(a: string[], b: string[]): { kind: "-" | "+" | " "; text: string }[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const result: { kind: "-" | "+" | " "; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: " ", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: "-", text: a[i] });
      i++;
    } else {
      result.push({ kind: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) { result.push({ kind: "-", text: a[i++] }); }
  while (j < m) { result.push({ kind: "+", text: b[j++] }); }
  return result;
}

export function diffBlock(fromValue: unknown, toValue: unknown): string[] {
  const aText = stableStringify(fromValue ?? null, 2).split("\n");
  const bText = stableStringify(toValue ?? null, 2).split("\n");
  const result = diffLines(aText, bText);
  let aStart = 0;
  let bStart = 0;
  let aCount = 0;
  let bCount = 0;
  let aLine = 0;
  let bLine = 0;
  let firstChangeSeen = false;
  for (const r of result) {
    if (r.kind === " ") {
      if (!firstChangeSeen) {
        aStart = aLine;
        bStart = bLine;
      }
      aCount++;
      bCount++;
      aLine++;
      bLine++;
    } else if (r.kind === "-") {
      if (!firstChangeSeen) {
        aStart = aLine;
        bStart = bLine;
        firstChangeSeen = true;
      }
      aCount++;
      aLine++;
    } else {
      if (!firstChangeSeen) {
        aStart = aLine;
        bStart = bLine;
        firstChangeSeen = true;
      }
      bCount++;
      bLine++;
    }
  }
  const out: string[] = [];
  out.push(`--- from`);
  out.push(`+++ to`);
  out.push(`@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@`);
  for (const r of result) {
    out.push(`${r.kind}${r.text}`);
  }
  return out;
}

async function writeBlockInternal(
  name: string,
  blockKey: string,
  content: unknown,
  operation: BackupOperation,
  meta: { source?: string; templateId?: string; templateName?: string },
): Promise<SetBlockResult> {
  const configPath = getInstanceConfigPath(name);
  const doc = readInstanceConfig(name);
  const currentRoot = doc.parsed;

  let nextBlock: unknown;
  if (content === undefined) {
    nextBlock = undefined;
  } else if (isPlainObject(currentRoot[blockKey]) && isPlainObject(content)) {
    nextBlock = applyProtectedMerge(blockKey, currentRoot[blockKey] as Record<string, unknown>, content as Record<string, unknown>);
  } else {
    nextBlock = content;
  }

  const nextRoot: Record<string, unknown> = { ...currentRoot };
  if (nextBlock === undefined) {
    delete nextRoot[blockKey];
  } else {
    nextRoot[blockKey] = nextBlock;
  }

  const backup = await createBackup(name, operation, { ...meta, blockKey }).catch((err: Error) => {
    return { error: err.message } as const;
  });
  if (!("id" in backup)) {
    return { ok: false, error: backup.error };
  }

  atomicWriteJson(configPath, nextRoot);
  return { ok: true, backupId: backup.id };
}

export async function setInstanceBlock(name: string, blockKey: string, content: unknown): Promise<SetBlockResult> {
  return writeBlockInternal(name, blockKey, content, "edit", {});
}

export async function deleteInstanceBlock(name: string, blockKey: string): Promise<SetBlockResult> {
  return writeBlockInternal(name, blockKey, undefined, "delete-block", {});
}

export async function syncBlockToInstances(
  sourceName: string,
  blockKey: string,
  targetNames: string[],
): Promise<SyncResult> {
  const sourceBlock = getInstanceBlock(sourceName, blockKey);
  const results: SyncTargetResult[] = [];
  for (const target of targetNames) {
    if (target === sourceName) {
      results.push({ name: target, ok: false, error: "源实例与目标实例相同" });
      continue;
    }
    if (!storeGetInstance(target)) {
      results.push({ name: target, ok: false, error: "实例不存在" });
      continue;
    }
    const r = await writeBlockInternal(target, blockKey, sourceBlock, "sync", { source: sourceName });
    results.push({ name: target, ok: r.ok, error: r.error, backupId: r.backupId });
  }
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

export async function applyTemplate(templateId: string, targets: string[]): Promise<SyncResult> {
  const tpl = storeGetTemplate(templateId);
  if (!tpl) return { ok: false, results: targets.map((n) => ({ name: n, ok: false, error: "模板不存在" })) };
  const results: SyncTargetResult[] = [];
  for (const target of targets) {
    if (!storeGetInstance(target)) {
      results.push({ name: target, ok: false, error: "实例不存在" });
      continue;
    }
    const r = await writeBlockInternal(target, tpl.blockKey, tpl.content, "template-apply", {
      source: tpl.name,
      templateId: tpl.id,
      templateName: tpl.name,
    });
    results.push({ name: target, ok: r.ok, error: r.error, backupId: r.backupId });
  }
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

export function listBackups(instanceName: string): BackupEntry[] {
  return readManifest(instanceName).sort((a, b) => b.createdAt - a.createdAt);
}

export function listAllBackups(): BackupEntry[] {
  const all: BackupEntry[] = [];
  for (const inst of storeGetInstances()) {
    all.push(...listBackups(inst.name));
  }
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function restoreBackup(instanceName: string, backupId: string): Promise<{ ok: boolean; restoredFrom?: string; error?: string }> {
  const entry = findEntry(instanceName, backupId);
  if (!entry) return { ok: false, error: "备份不存在" };
  const backupsDir = getBackupsDir(instanceName);
  const archivePath = path.join(backupsDir, entry.file);
  if (!fs.existsSync(archivePath)) {
    return { ok: false, error: `备份文件不存在: ${entry.file}` };
  }

  const configPath = getInstanceConfigPath(instanceName);
  if (!fs.existsSync(configPath)) {
    return { ok: false, error: "当前 openclaw.json 不存在,无法备份" };
  }

  const preBackup = await createBackup(instanceName, "restore", { blockKey: "*" }).catch((err: Error) => ({ error: err.message } as const));
  if (!("id" in preBackup)) {
    return { ok: false, error: preBackup.error };
  }

  try {
    if (entry.format === "file-copy") {
      fs.copyFileSync(archivePath, configPath);
    } else {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-restore-"));
      try {
        await runTarExtract(archivePath, tempDir);
        const extracted = findConfigInDir(tempDir);
        if (!extracted) {
          return { ok: false, error: "归档中未找到 openclaw.json" };
        }
        fs.copyFileSync(extracted, configPath);
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    return { ok: false, error: `恢复失败: ${(err as Error).message}` };
  }

  return { ok: true, restoredFrom: entry.id };
}

function runTarExtract(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-xzf", archivePath, "-C", destDir], { windowsHide: true });
    let stderr = "";
    tar.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    tar.on("error", reject);
    tar.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exit ${code}: ${stderr}`));
    });
  });
}

function findConfigInDir(dir: string): string | null {
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name === "openclaw.json") return p;
    }
  }
  return null;
}

export async function deleteBackup(instanceName: string, backupId: string): Promise<void> {
  const entry = findEntry(instanceName, backupId);
  if (!entry) throw new Error("备份不存在");
  const archivePath = path.join(getBackupsDir(instanceName), entry.file);
  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath);
  }
  const list = readManifest(instanceName).filter((e) => e.id !== backupId);
  writeManifest(instanceName, list);
}

export function listTemplates(): ConfigTemplate[] {
  return storeListTemplates();
}

export function getTemplate(id: string): ConfigTemplate | undefined {
  return storeGetTemplate(id);
}

export function createTemplate(input: { name: string; description?: string; blockKey: string; content: unknown }): ConfigTemplate {
  const now = Date.now();
  const tpl: ConfigTemplate = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    blockKey: input.blockKey,
    content: input.content,
    createdAt: now,
    updatedAt: now,
  };
  storeAddTemplate(tpl);
  return tpl;
}

export function updateTemplate(id: string, patch: Partial<Omit<ConfigTemplate, "id" | "createdAt" | "updatedAt">>): ConfigTemplate | undefined {
  return storeUpdateTemplate(id, patch);
}

export function deleteTemplate(id: string): void {
  storeRemoveTemplate(id);
}

export function getBackupRetentionSetting(): number | null {
  return getBackupRetention();
}

export function setBackupRetentionSetting(count: number | null): void {
  storeSetBackupRetention(count);
}

export function listAllInstancesWithConfig(): { name: string; hasConfig: boolean }[] {
  return storeGetInstances().map((r) => ({
    name: r.name,
    hasConfig: fs.existsSync(getInstanceConfigPath(r.name)),
  }));
}
