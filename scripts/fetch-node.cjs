#!/usr/bin/env node
/**
 * 从 nodejs.org 下载便携版 Node.js,解压到 ./resources/node(默认)。
 *
 * 写本脚本时已查询过 https://nodejs.org/dist/index.json,锁定最新 LTS。
 * 上游发布新 LTS 后,更新 DEFAULT_VERSION 即可。
 *
 * 用法:
 *   node scripts/fetch-node.cjs
 *   node scripts/fetch-node.cjs --version v24.18.0
 *   node scripts/fetch-node.cjs --force
 *   node scripts/fetch-node.cjs --platform linux --arch arm64
 *   node scripts/fetch-node.cjs --target-dir /opt/node
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const DEFAULT_VERSION = "v24.18.0";
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";

function parseArgs(argv) {
  const args = {
    version: DEFAULT_VERSION,
    platform: process.platform,
    arch: process.arch,
    force: false,
    targetDir: path.join(__dirname, "..", "resources", "node"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") args.version = argv[++i];
    else if (a === "--platform") args.platform = argv[++i];
    else if (a === "--arch") args.arch = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--target-dir") args.targetDir = path.resolve(argv[++i]);
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!/^v\d+\.\d+\.\d+/.test(args.version)) {
    throw new Error(`Invalid version: ${args.version} (expected vX.Y.Z)`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/fetch-node.cjs [options]

Options:
  --version <vX.Y.Z>   Node.js version (default: ${DEFAULT_VERSION})
  --platform <p>       win32 | linux | darwin (default: current)
  --arch <a>           x64 | arm64 (default: current)
  --force              Re-download even if local copy matches
  --target-dir <path>  Output directory (default: ./resources/node)
  -h, --help           Show this help`);
}

function exeName(platform) {
  return platform === "win32" ? "node.exe" : "node";
}

function downloadUrl(version, platform, arch) {
  const ver = version.startsWith("v") ? version : `v${version}`;
  const plat =
    platform === "win32" ? "win" :
    platform === "darwin" ? "darwin" :
    platform === "linux" ? "linux" :
    (() => { throw new Error(`Unsupported platform: ${platform}`); })();
  const filenameExt = platform === "win32" ? "zip" : "tar.gz";
  return `https://nodejs.org/dist/${ver}/node-${ver}-${plat}-${arch}.${filenameExt}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let resolved = false;
    const finish = (err) => {
      if (resolved) return;
      resolved = true;
      file.close();
      if (err) {
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        reject(err);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(() => finish(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`)), DOWNLOAD_TIMEOUT_MS);

    const request = (u) => {
      https.get(u, (res) => {
        if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          clearTimeout(timer);
          finish(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        let lastLogged = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct - lastLogged >= 10) {
              lastLogged = pct;
              process.stdout.write(`  ${pct}% (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)\r`);
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          clearTimeout(timer);
          if (total > 0) process.stdout.write("\n");
          finish();
        });
      }).on("error", (err) => {
        clearTimeout(timer);
        finish(err);
      });
    };
    request(url);
  });
}

function extract(archivePath, stageDir) {
  return new Promise((resolve, reject) => {
    const isZip = archivePath.endsWith(".zip");
    const args = isZip
      ? ["-xf", archivePath, "-C", stageDir]
      : ["-xzf", archivePath, "-C", stageDir];
    const tar = spawn("tar", args, { windowsHide: true });
    let stderr = "";
    tar.stderr?.on("data", (d) => (stderr += d.toString()));
    tar.on("error", reject);
    tar.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exit ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
}

async function moveContents(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    fs.renameSync(s, d);
  }
}

function getExistingVersion(exePath) {
  return new Promise((resolve) => {
    const child = spawn(exePath, ["--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const m = (stdout + stderr).match(/v?(\d+\.\d+\.\d+)/);
      resolve(m ? `v${m[1]}` : null);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const { version, platform, arch, force, targetDir } = args;
  const exe = exeName(platform);
  const exePath = path.join(targetDir, exe);

  console.log(`[fetch-node] target: ${targetDir}`);
  console.log(`[fetch-node] version: ${version}  platform: ${platform}  arch: ${arch}`);

  if (!force && fs.existsSync(exePath)) {
    const existing = await getExistingVersion(exePath);
    if (existing === version) {
      console.log(`[fetch-node] ${version} already installed at ${targetDir}, skipping (use --force to redownload)`);
      return;
    }
    console.log(`[fetch-node] existing ${existing ?? "(unknown)"} differs from requested ${version}, replacing...`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  } else if (force && fs.existsSync(targetDir)) {
    console.log(`[fetch-node] --force: removing existing ${targetDir}`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const tmpDir = path.join(targetDir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "node-fetch-stage-"));

  try {
    const url = downloadUrl(version, platform, arch);
    const archive = path.join(tmpDir, path.basename(url));
    console.log(`[fetch-node] downloading ${url}`);
    await download(url, archive);
    console.log(`[fetch-node] extracting`);
    await extract(archive, stageDir);
    const extractedRoot = fs.readdirSync(stageDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(stageDir, e.name))
      .find((p) => path.basename(p).startsWith("node-"));
    if (!extractedRoot) {
      throw new Error("extracted archive does not contain a node-* directory");
    }
    await moveContents(extractedRoot, targetDir);

    if (!fs.existsSync(exePath)) {
      throw new Error(`expected ${exe} at ${exePath} after extraction`);
    }
    const installed = await getExistingVersion(exePath);
    if (installed !== version) {
      throw new Error(`verification failed: requested ${version}, got ${installed ?? "(none)"}`);
    }
    console.log(`[fetch-node] OK: ${exe} at ${exePath} reports ${installed}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(`[fetch-node] FAILED: ${err.message}`);
  process.exit(1);
});
