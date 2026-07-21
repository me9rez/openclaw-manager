import { execFile, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import https from "https";
import { fileURLToPath } from "url";
import { getVersionDir, addVersion, removeVersion, getVersions } from "./store";
import { splitSemver } from "./semver";
// Production sorting uses `publishedAt` (see parseVersions below) because
// OpenClaw publishes re-release hotfixes with suffixes like `v2026.7.1-2`
// AFTER the original `v2026.7.1` shipped — those are semver-pre-release
// under §11 and would otherwise sort BELOW `v2026.7.1`, which is wrong for
// an "is there a newer build?" list.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AvailableVersion {
  version: string;
  publishedAt: string;
}

const CACHE_TTL_MS = 300_000; // 5 minutes
let cachedVersions: AvailableVersion[] | null = null;
let cacheTimestamp = 0;

const HTTP_TIMEOUT_MS = 8_000;

function httpsGet(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`)));
      try { req.destroy(); } catch { /* ignore */ }
    }, timeoutMs);

    const req = https.get(url, { headers: { "Accept": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          finish(() => resolve(data));
        } else {
          finish(() => reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)));
        }
      });
    });
    req.on("error", (err) => finish(() => reject(err)));
  });
}

// Strip a leading "v" and split off an optional pre-release / build suffix.
//   "v2026.7.1-beta.6" -> { core: [2026, 7, 1], pre: "beta.6", build: undefined }
//   "2026.7.1"         -> { core: [2026, 7, 1], pre: undefined,    build: undefined }
// The actual implementation lives in `./semver.ts` so it can be unit-tested
// without pulling in `electron` / `https` / `child_process` side-effects.

function parseVersions(raw: string): AvailableVersion[] {
  const pkg = JSON.parse(raw);
  const timeMap: Record<string, string> = pkg.time || {};
  return Object.entries(timeMap)
    .filter(([v]) => v !== "created" && v !== "modified")
    .sort(([a, ta], [b, tb]) => {
      // Primary: publish time, ascending. Real npm `time` values are
      // millisecond-precision ISO strings, so lexicographic compare is
      // equivalent to chronological compare.
      const byTime = ta.localeCompare(tb);
      if (byTime !== 0) return byTime;
      // Secondary: numeric core, ascending — gives a stable order for
      // versions published in the same millisecond (rare but possible).
      const { core: ca } = splitSemver(a);
      const { core: cb } = splitSemver(b);
      const len = Math.max(ca.length, cb.length);
      for (let i = 0; i < len; i++) {
        const diff = (ca[i] ?? 0) - (cb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .reverse() // newest first
    .map(([version, publishedAt]) => ({
      version: version.startsWith("v") ? version : `v${version}`,
      publishedAt,
    }));
}

/**
 * Parse the `npm.antfu.dev/versions/<pkg>?metadata=true` response.
 *
 * Shape:
 *   {
 *     "name": "openclaw",
 *     "versionsMeta": {
 *       "0.0.1":         { "time": "2026-...", "integrity": "..." },
 *       "2026.7.1-2":    { "time": "2026-...", "integrity": "..." },
 *       ...
 *     }
 *   }
 *
 * Compared to the npm registry's full package document, this endpoint
 * returns a much smaller payload (a few dozen KB vs. 30+ MB for popular
 * packages) and is the reason we hit it first.
 *
 * Versions without a `time` field are skipped — without a timestamp we
 * can't sort them, and the manager only renders versions with a publish
 * date.
 */
function parseAntfuVersions(raw: string): AvailableVersion[] {
  const pkg = JSON.parse(raw);
  const meta = pkg.versionsMeta;
  if (!meta || typeof meta !== "object") return [];
  return Object.entries(meta)
    .filter((entry): entry is [string, { time?: string }] => {
      const [, value] = entry;
      return !!value && typeof (value as { time?: unknown }).time === "string";
    })
    .map(([version, value]) => ({
      version: version.startsWith("v") ? version : `v${version}`,
      publishedAt: (value as { time: string }).time,
    }))
    .sort((a, b) => {
      const byTime = a.publishedAt.localeCompare(b.publishedAt);
      if (byTime !== 0) return byTime;
      const { core: ca } = splitSemver(a.version);
      const { core: cb } = splitSemver(b.version);
      const len = Math.max(ca.length, cb.length);
      for (let i = 0; i < len; i++) {
        const diff = (ca[i] ?? 0) - (cb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })
    .reverse(); // newest first
}

export async function listAvailableVersions(force = false): Promise<AvailableVersion[]> {
  const now = Date.now();
  if (!force && cachedVersions && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVersions;
  }
  // Try the antfu.dev metadata endpoint first — it's a small (~50KB)
  // response vs. the npm registry's multi-megabyte package document.
  // Fall back to the npm registry on any failure (timeout, non-2xx, bad
  // JSON, missing `versionsMeta`, …) so the manager stays usable.
  const antfuUrl = "https://npm.antfu.dev/versions/openclaw?metadata=true";
  const npmUrl = "https://registry.npmjs.org/openclaw";
  let versions: AvailableVersion[] = [];
  let source: "antfu" | "npm" = "npm";
  try {
    const raw = await httpsGet(antfuUrl);
    versions = parseAntfuVersions(raw);
    if (versions.length === 0) {
      throw new Error("antfu returned no versions");
    }
    source = "antfu";
  } catch (err) {
    console.warn(`[versions] antfu.dev fetch failed (${(err as Error).message}), falling back to npm registry`);
    const raw = await httpsGet(npmUrl);
    versions = parseVersions(raw);
  }
  cachedVersions = versions;
  cacheTimestamp = now;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[versions] loaded ${versions.length} versions from ${source}`);
  }
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
      ? [path.join(dir, "npm.cmd"), path.join(dir, "npm.exe"), path.join(dir, "npm")]
      : [path.join(dir, "npm"), path.join(dir, "npm.cmd")];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`npm not found next to node binary at ${nodeExe}`);
}

/**
 * Asynchronously remove a version's install directory and drop it from
 * the manager store. The previous implementation used `fs.rmSync` which
 * blocks the Electron main process for tens of seconds on Windows
 * (a full `node_modules` is ~30k files; AV scanning + NTFS metadata
 * make it much slower than the same op on macOS/Linux). While the main
 * thread is blocked, every IPC handler — including status updates,
 * log forwarding, even "cancel" — is frozen, and the renderer stops
 * responding to user input.
 *
 * `fs.promises.rm` releases the thread between syscalls, and `maxRetries`
 * helps survive Windows' "file in use" races with whatever else is
 * touching the directory (open PowerShell tabs, recent `npm` cache GC,
 * the OpenClaw wizard still holding a config file, etc.).
 *
 * Returns when the directory is gone AND the store entry has been
 * dropped. Throws if the directory cannot be removed after retries.
 */
export async function uninstallVersion(version: string): Promise<void> {
  const versionDir = getVersionDir(version);

  if (fs.existsSync(versionDir)) {
    try {
      await fs.promises.rm(versionDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (err) {
      throw new Error(
        `删除版本目录 ${versionDir} 失败: ${(err as Error).message}`,
      );
    }
  }

  removeVersion(version);
}

/**
 * Refuse to uninstall a version that's still referenced by an instance.
 * Returns the list of instance names using this version; empty means safe
 * to uninstall. The check is performed against the caller-supplied
 * `getInstances` callback so this function stays pure and unit-testable
 * (avoids a circular import on `./store`).
 */
export function findInstancesUsingVersion(
  version: string,
  getInstances: () => { name: string; version: string }[],
): string[] {
  return getInstances()
    .filter((i) => i.version === version)
    .map((i) => i.name);
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
