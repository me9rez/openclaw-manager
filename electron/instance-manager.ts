import { ChildProcess, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { StringDecoder } from "string_decoder";
import { randomUUID } from "crypto";
import {
  addInstance as storeAddInstance,
  getInstance as storeGetInstance,
  getInstanceDir,
  getInstances as storeGetInstances,
  removeInstance as storeRemoveInstance,
  getNextPort,
  updateInstance as storeUpdateInstance,
  getManagerDir,
} from "./store";
import { getOpenClawEntry, resolveNodeBinary, installVersion } from "./version-manager";
import { GatewayClient } from "./gateway-client";
import { findAvailablePort, isPortAvailable } from "./port-utils";
import { loadOrCreateDeviceIdentity } from "./device-identity";
import { EventEmitter } from "events";

type InstanceStatus =
  | "installed"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "reconnecting"
  | "error"
  | "crashed";

interface ManagedInstance {
  name: string;
  version: string;
  port: number;
  token: string;
  process: ChildProcess | null;
  gateway: GatewayClient | null;
  status: InstanceStatus;
  statusMessage?: string;
  logs: string[];
  restartCount: number;
  restartTimer: NodeJS.Timeout | null;
  restartWindowStart: number;
  startedAt?: number;
  reconnectAttempts: number;
  lastReconnectError?: string;
  health?: { version?: string; uptime?: number };
}

const instances = new Map<string, ManagedInstance>();
const emitter = new EventEmitter();
const MAX_RESTARTS_PER_MINUTE = 3;
const LOG_BUFFER_SIZE = 200;

function emitStatus(name: string, status: InstanceStatus, message?: string): void {
  emitter.emit("status", { name, status, message });
}

function emitLog(name: string, line: string): void {
  emitter.emit("log", { name, line });
}

function initStateDir(instanceDir: string, token: string): void {
  fs.mkdirSync(instanceDir, { recursive: true });
  const configPath = path.join(instanceDir, "openclaw.json");

  let config: Record<string, unknown>;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
  } else {
    config = {};
  }

  // Ensure gateway section exists with mode and auth
  if (!config.gateway || typeof config.gateway !== "object") {
    config.gateway = {};
  }
  const gw = config.gateway as Record<string, unknown>;
  if (!gw.mode) gw.mode = "local";
  if (!gw.auth || typeof gw.auth !== "object") {
    gw.auth = { token };
  }
  const auth = gw.auth as Record<string, unknown>;
  if (!auth.token) auth.token = token;

  if (!config.agents || typeof config.agents !== "object") {
    config.agents = {};
  }
  const agents = config.agents as Record<string, unknown>;
  if (!agents.defaults || typeof agents.defaults !== "object") {
    agents.defaults = { workspace: "default" };
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

async function startGatewayClient(inst: ManagedInstance): Promise<void> {
  const identity = await loadOrCreateDeviceIdentity(getInstanceDir(inst.name));
  const client = new GatewayClient(
    `ws://127.0.0.1:${inst.port}/ws`,
    inst.token,
    identity,
    {
      onConnected: () => {
        inst.status = "running";
        inst.statusMessage = undefined;
        inst.reconnectAttempts = 0;
        inst.lastReconnectError = undefined;
        inst.startedAt = inst.startedAt ?? Date.now();
        emitStatus(inst.name, "running");
      },
      onHealth: (health) => {
        inst.health = health as { version?: string; uptime?: number };
      },
      onReconnecting: (attempt, _delay, lastError) => {
        if (inst.status === "stopping") return;
        inst.status = "reconnecting";
        inst.reconnectAttempts = attempt;
        if (lastError) inst.lastReconnectError = lastError;
        const tail = lastError ? ` (上次错误: ${lastError})` : "";
        inst.statusMessage = `重新连接中 (第 ${attempt}/10 次)${tail}`;
        emitStatus(inst.name, "reconnecting", inst.statusMessage);
      },
      onMaxAttemptsReached: (attempts) => {
        inst.status = "crashed";
        inst.reconnectAttempts = attempts;
        inst.statusMessage = `重连 ${attempts} 次均失败`;
        emitStatus(inst.name, "crashed", inst.statusMessage);
      },
      onError: (err) => {
        // Fatal (4xxx) errors land here after GatewayClient gives up.
        // Don't override reconnecting/crashed states set by onReconnecting/onMaxAttemptsReached.
        if (inst.status === "starting" || inst.status === "installed") {
          inst.status = "error";
          inst.statusMessage = err.message;
          emitStatus(inst.name, "error", err.message);
        } else if (inst.status === "running") {
          // running 时收到 error 一般是 ws on('error') 噪音,真正处理在 on('close')
        }
      },
      onDisconnected: () => {
        // close 事件已被 GatewayClient 内部用 onReconnecting 处理,这里不再翻 error
      },
    },
  );

  inst.gateway = client;
  client.connect();
}

const INSTANCE_NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_\-]*$/;

export async function createInstance(name: string, version: string, port?: number): Promise<void> {
  if (!INSTANCE_NAME_RE.test(name)) {
    throw new Error(
      `实例名 "${name}" 不合法：仅允许字母、数字、下划线、连字符，且不能以连字符开头`
    );
  }
  if (instances.has(name)) {
    throw new Error(`Instance "${name}" already exists`);
  }
  if (storeGetInstance(name)) {
    throw new Error(`Instance "${name}" already exists in store`);
  }

  const entry = getOpenClawEntry(version);
  if (!entry) {
    throw new Error(`Version ${version} is not installed`);
  }

  const token = randomUUID().replace(/-/g, "");
  const reservedPorts = new Set(storeGetInstances().map((i) => i.port));
  const startPort = port ?? getNextPort(reservedPorts);
  const { port: instancePort, skipped } = await findAvailablePort(startPort, { reservedPorts });
  const instanceDir = getInstanceDir(name);

  if (skipped.length > 0) {
    const note = port !== undefined && skipped.length > 0
      ? `[manager] requested port ${port} unavailable, using ${instancePort} (skipped: ${skipped.join(", ")})`
      : `[manager] allocated port ${instancePort} (skipped: ${skipped.join(", ")})`;
    console.warn(note);
  }

  initStateDir(instanceDir, token);

  storeAddInstance({ name, version, port: instancePort, token });

  const inst: ManagedInstance = {
    name,
    version,
    port: instancePort,
    token,
    process: null,
    gateway: null,
    status: "installed",
    logs: [],
    restartCount: 0,
    restartTimer: null,
    restartWindowStart: Date.now(),
    reconnectAttempts: 0,
  };

  instances.set(name, inst);
}

export async function startInstance(name: string): Promise<void> {
  const inst = instances.get(name);
  if (!inst) {
    const record = storeGetInstance(name);
    if (!record) throw new Error(`Instance "${name}" not found`);
    const entry = getOpenClawEntry(record.version);
    if (!entry) throw new Error(`Version ${record.version} not installed`);

    const newInst: ManagedInstance = {
      name: record.name,
      version: record.version,
      port: record.port,
      token: record.token,
      process: null,
      gateway: null,
      status: "installed",
      logs: [],
      restartCount: 0,
      restartTimer: null,
      restartWindowStart: Date.now(),
      reconnectAttempts: 0,
    };
    instances.set(name, newInst);
    return startInstance(name);
  }

  if (inst.status === "running") return;

  const entry = getOpenClawEntry(inst.version);
  if (!entry) throw new Error(`Version ${inst.version} entry not found`);

  const portFree = await isPortAvailable(inst.port);
  if (!portFree) {
    inst.status = "error";
    inst.statusMessage = `端口 ${inst.port} 已被占用,请删除实例重建`;
    emitLog(name, `[manager] port ${inst.port} is in use, refusing to start`);
    emitStatus(name, "error", inst.statusMessage);
    return;
  }

  const nodeExe = resolveNodeBinary();
  const instanceDir = getInstanceDir(name);

  inst.status = "starting";
  inst.statusMessage = `node=${nodeExe} port=${inst.port}`;
  emitLog(name, `[manager] starting: ${nodeExe} ${entry} gateway run --port ${inst.port}`);
  emitStatus(name, "starting");

  // Debug: write diag file
  const diagFile = path.join(instanceDir, "spawn-diag.json");
  try { fs.writeFileSync(diagFile, JSON.stringify({ nodeExe, entry, port: inst.port, cwd: instanceDir, env: process.env.NODE_NO_WARNINGS }, null, 2), "utf-8"); } catch {}

  const configPath = path.join(instanceDir, "openclaw.json");
  const child = spawn(nodeExe, [entry, "gateway", "run", "--port", String(inst.port), "--auth", "token"], {
    cwd: instanceDir,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: instanceDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_TOKEN: inst.token,
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  inst.process = child;

  const stdoutDecoder = new StringDecoder("utf-8");
  const stderrDecoder = new StringDecoder("utf-8");
  let stdoutTail = "";
  let stderrTail = "";

  const flushLines = (text: string, isTail: string): { lines: string[]; tail: string } => {
    const combined = text + isTail;
    const parts = combined.split("\n");
    const tail = parts.pop() ?? "";
    return { lines: parts, tail };
  };

  const pushLines = (lines: string[]) => {
    for (const line of lines) {
      inst.logs.push(line);
      if (inst.logs.length > LOG_BUFFER_SIZE) inst.logs.shift();
      emitLog(name, line);
    }
  };

  child.stdout?.on("data", (data: Buffer) => {
    const text = stdoutDecoder.write(data);
    const { lines, tail } = flushLines(text, stdoutTail);
    stdoutTail = tail;
    pushLines(lines);
  });
  child.stdout?.on("end", () => {
    const rest = stdoutDecoder.end();
    if (rest) {
      const { lines, tail } = flushLines(rest, stdoutTail);
      stdoutTail = tail;
      pushLines(lines);
    }
    if (stdoutTail.length > 0) {
      pushLines([stdoutTail]);
      stdoutTail = "";
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = stderrDecoder.write(data);
    const { lines, tail } = flushLines(text, stderrTail);
    stderrTail = tail;
    pushLines(lines);
  });
  child.stderr?.on("end", () => {
    const rest = stderrDecoder.end();
    if (rest) {
      const { lines, tail } = flushLines(rest, stderrTail);
      stderrTail = tail;
      pushLines(lines);
    }
    if (stderrTail.length > 0) {
      pushLines([stderrTail]);
      stderrTail = "";
    }
  });

  child.on("exit", (code, signal) => {
    inst.process = null;
    inst.gateway?.disconnect();
    inst.gateway = null;

    if (inst.status === "stopping") {
      inst.status = "stopped";
      inst.statusMessage = code === 0 ? undefined : `Exited with code ${code}`;
      emitStatus(name, "stopped", inst.statusMessage);
      return;
    }

    if (inst.status === "starting" || inst.status === "running" || inst.status === "reconnecting") {
      emitLog(name, `[manager] process exited code=${code} signal=${signal}`);
      try { fs.writeFileSync(path.join(getInstanceDir(name), "exit-diag.json"), JSON.stringify({ code, signal, status: inst.status }, null, 2), "utf-8"); } catch {}
      const now = Date.now();
      if (now - inst.restartWindowStart > 60_000) {
        inst.restartCount = 0;
        inst.restartWindowStart = now;
      }
      inst.restartCount++;

      if (inst.restartCount <= MAX_RESTARTS_PER_MINUTE) {
        inst.statusMessage = `Restarting (attempt ${inst.restartCount}/${MAX_RESTARTS_PER_MINUTE})...`;
        emitStatus(name, "starting", inst.statusMessage);
        inst.restartTimer = setTimeout(() => {
          startInstance(name);
        }, 2_000);
      } else {
        inst.status = "crashed";
        inst.statusMessage = `Crashed ${inst.restartCount} times in 60s`;
        emitStatus(name, "crashed", inst.statusMessage);
      }
    }
  });

  child.on("error", (err) => {
    if (inst.status === "stopping") return;
    inst.status = "error";
    inst.statusMessage = err.message;
    emitStatus(name, "error", err.message);
  });

  void startGatewayClient(inst);
}

export async function stopInstance(name: string): Promise<void> {
  const inst = instances.get(name);
  if (!inst) throw new Error(`Instance "${name}" not found`);
  if (!inst.process) {
    inst.status = "stopped";
    emitStatus(name, "stopped");
    return;
  }

  inst.status = "stopping";
  emitStatus(name, "stopping");

  if (inst.restartTimer) {
    clearTimeout(inst.restartTimer);
    inst.restartTimer = null;
  }

  inst.gateway?.disconnect();
  inst.gateway = null;

  const pid = inst.process.pid;
  if (pid) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(pid), "/F", "/T"], { windowsHide: true });
      } else {
        inst.process.kill("SIGTERM");
        setTimeout(() => {
          try { inst.process?.kill("SIGKILL"); } catch {}
        }, 5_000);
      }
    } catch {}
  }
}

export function removeInstance(name: string): void {
  const inst = instances.get(name);
  if (inst) {
    if (inst.process) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(inst.process.pid), "/F", "/T"], { windowsHide: true });
        } else {
          inst.process.kill("SIGKILL");
        }
      } catch {}
    }
    inst.gateway?.disconnect();
    if (inst.restartTimer) clearTimeout(inst.restartTimer);
    instances.delete(name);
  }

  const instanceDir = getInstanceDir(name);
  if (fs.existsSync(instanceDir)) {
    fs.rmSync(instanceDir, { recursive: true, force: true });
  }
  storeRemoveInstance(name);
}

export function forceReconnectInstance(name: string): void {
  const inst = instances.get(name);
  if (!inst) throw new Error(`Instance "${name}" not found`);
  if (inst.status === "starting" || inst.status === "stopping" || inst.status === "installed") {
    throw new Error(`Instance "${name}" is in state "${inst.status}" and cannot be force-reconnected`);
  }
  inst.reconnectAttempts = 0;
  inst.lastReconnectError = undefined;
  if (inst.process) {
    inst.gateway?.forceReconnect();
    inst.status = "reconnecting";
    inst.statusMessage = "手动重新连接中...";
    emitStatus(name, "reconnecting", inst.statusMessage);
  } else {
    throw new Error(`Instance "${name}" has no running process; please start it first`);
  }
}

export function stopReconnectInstance(name: string): void {
  const inst = instances.get(name);
  if (!inst) throw new Error(`Instance "${name}" not found`);
  if (inst.status !== "reconnecting") {
    throw new Error(`Instance "${name}" is not reconnecting (state: ${inst.status})`);
  }
  inst.gateway?.disconnect();
  inst.gateway = null;
  inst.status = "error";
  inst.statusMessage = "已停止重连";
  emitStatus(name, "error", inst.statusMessage);
}

export function getInstanceStatus(name: string): ManagedInstance | undefined {
  return instances.get(name);
}

export function getAllInstanceStatuses(): ManagedInstance[] {
  return Array.from(instances.values());
}

export function getRunningCount(): number {
  let n = 0;
  for (const inst of instances.values()) {
    if (inst.status === "running" || inst.status === "starting") n++;
  }
  return n;
}

export function getInstanceSummaries(): { name: string; status: InstanceStatus }[] {
  return Array.from(instances.values())
    .map((inst) => ({ name: inst.name, status: inst.status }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function stopAllInstances(): Promise<void> {
  const targets = Array.from(instances.values()).filter((i) => i.process !== null);
  await Promise.all(
    targets.map((inst) =>
      stopInstance(inst.name).catch(() => undefined),
    ),
  );
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const stillRunning = Array.from(instances.values()).some((i) => i.process !== null);
    if (!stillRunning) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function getInstanceLogs(name: string): string[] {
  return instances.get(name)?.logs ?? [];
}

export function syncStoreToMemory(): void {
  const records = storeGetInstances();
  for (const record of records) {
    if (!instances.has(record.name)) {
      instances.set(record.name, {
        name: record.name,
        version: record.version,
        port: record.port,
        token: record.token,
        process: null,
        gateway: null,
        status: "stopped",
        logs: [],
        restartCount: 0,
        restartTimer: null,
        restartWindowStart: Date.now(),
        reconnectAttempts: 0,
      });
    }
  }
}

export function onStatus(callback: (data: { name: string; status: InstanceStatus; message?: string }) => void): () => void {
  emitter.on("status", callback);
  return () => emitter.off("status", callback);
}

export function onLog(callback: (data: { name: string; line: string }) => void): () => void {
  emitter.on("log", callback);
  return () => emitter.off("log", callback);
}
