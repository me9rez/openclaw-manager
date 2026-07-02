import { execFile, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import https from "https";
import { fileURLToPath } from "url";
import { getVersionDir, addVersion, removeVersion, getVersions } from "./store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AvailableVersion {
  version: string;
  publishedAt: string;
}

const CACHE_TTL_MS = 300_000; // 5 minutes
let cachedVersions: AvailableVersion[] | null = null;
let cacheTimestamp = 0;

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "Accept": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    }).on("error", reject);
  });
}

function parseVersions(raw: string): AvailableVersion[] {
  const pkg = JSON.parse(raw);
  const timeMap: Record<string, string> = pkg.time || {};
  return Object.entries(timeMap)
    .filter(([v]) => v !== "created" && v !== "modified")
    .sort(([a], [b]) => {
      const partsA = a.replace(/^v/, "").split(".").map(Number);
      const partsB = b.replace(/^v/, "").split(".").map(Number);
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const diff = (partsB[i] || 0) - (partsA[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .map(([version, publishedAt]) => ({
      version: version.startsWith("v") ? version : `v${version}`,
      publishedAt,
    }));
}

export async function listAvailableVersions(force = false): Promise<AvailableVersion[]> {
  const now = Date.now();
  if (!force && cachedVersions && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVersions;
  }
  const raw = await httpsGet("https://registry.npmjs.org/openclaw");
  cachedVersions = parseVersions(raw);
  cacheTimestamp = now;
  return cachedVersions;
}

export function installVersion(version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const versionDir = getVersionDir(version);
    if (fs.existsSync(versionDir) && getOpenClawEntry(version)) {
      addVersion(version);
      resolve();
      return;
    }

    fs.mkdirSync(versionDir, { recursive: true });
    const npmTag = version.startsWith("v") ? version.slice(1) : version;

    const npmExe = resolveNpmBinary();
    const npmDir = path.dirname(npmExe);

    const sep = process.platform === "win32" ? ";" : ":";
    const env = {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      PATH: `${npmDir}${sep}${process.env.PATH || ""}`,
    };

    execFile(
      npmExe,
      ["install", `openclaw@${npmTag}`, "--prefix", versionDir, "--no-save"],
      {
        cwd: versionDir,
        env,
        timeout: 120_000,
        windowsHide: true,
        shell: process.platform === "win32",
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`Install failed: ${error.message}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        addVersion(version);
        resolve();
      },
    );
  });
}

export function resolveNpmBinary(): string {
  const nodeExe = resolveNodeBinary();
  const dir = path.dirname(nodeExe);
  const candidates =
    process.platform === "win32"
      ? [path.join(dir, "npm.cmd"), path.join(dir, "npm")]
      : [path.join(dir, "npm"), path.join(dir, "npm.cmd")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`npm not found next to node binary at ${nodeExe}`);
}

export function uninstallVersion(version: string): void {
  const versionDir = getVersionDir(version);
  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
  removeVersion(version);
}

export function getInstalledVersions(): string[] {
  return getVersions().filter((v) => {
    const dir = getVersionDir(v);
    return fs.existsSync(dir) && fs.existsSync(path.join(dir, "node_modules", "openclaw", "openclaw.mjs"));
  });
}

export function getOpenClawEntry(version: string): string | null {
  const candidate = path.join(getVersionDir(version), "node_modules", "openclaw", "openclaw.mjs");
  return fs.existsSync(candidate) ? candidate : null;
}

function testNodeBinary(nodePath: string): boolean {
  try {
    const result = execFileSync(nodePath, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return result.trim().startsWith("v");
  } catch {
    return false;
  }
}

export function resolveNodeBinary(): string {
  const candidates: string[] = [];

  // 0. PATH first (system node is preferred over bundled)
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  for (const dir of pathDirs) {
    const p = path.join(dir, "node.exe");
    if (!candidates.includes(p)) candidates.push(p);
    const p2 = path.join(dir, "node");
    if (!candidates.includes(p2)) candidates.push(p2);
  }

  // 1. Common install paths
  candidates.push(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files\\nodejs\\node64.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe"),
    path.join(process.env.LOCALAPPDATA || "", "mise", "shims", "node.exe"),
    path.join(process.env.USERPROFILE || "", "AppData", "Local", "mise", "shims", "node.exe"),
  );

  // 2. Bundled Node.js (production build)
  candidates.push(
    path.join(process.resourcesPath, "resources", "node", process.platform === "win32" ? "node.exe" : "node"),
  );

  // 3. Bundled Node.js (dev mode)
  candidates.push(
    path.join(__dirname, "..", "resources", "node", process.platform === "win32" ? "node.exe" : "node"),
  );

  // Test each candidate and return the first one that works
  for (const p of candidates) {
    if (p && fs.existsSync(p) && testNodeBinary(p)) return p;
  }

  throw new Error("No working node binary found in PATH, common install paths, or resources/node/");
}
