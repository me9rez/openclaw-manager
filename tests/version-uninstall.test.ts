import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// We capture the in-memory "store" in closure-local arrays that the mocked
// `./store` module reads. Vitest hoists `vi.mock` calls, so the factory
// body must be self-contained (no references to outer top-level `let`s).
// We expose mutation through a singleton object that the factory returns.
const storeMock = {
  removals: [] as string[],
  adds: [] as string[],
  root: "",
};

vi.mock("../electron/store", () => ({
  getVersionDir: (v: string) => path.join(storeMock.root, v),
  addVersion: (v: string) => {
    storeMock.adds.push(v);
  },
  removeVersion: (v: string) => {
    storeMock.removals.push(v);
  },
  getVersions: () =>
    storeMock.adds.filter((v) => !storeMock.removals.includes(v)),
}));

import { findInstancesUsingVersion, uninstallVersion } from "../electron/version-manager";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-uninstall-"));
  storeMock.root = tmpDir;
  storeMock.removals = [];
  storeMock.adds = [];
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("findInstancesUsingVersion", () => {
  const INSTANCES = [
    { name: "alpha", version: "v2026.7.1" },
    { name: "beta", version: "v2026.7.1-2" },
    { name: "gamma", version: "v2026.7.2" },
  ];

  it("returns an empty list when no instance uses the version", () => {
    expect(findInstancesUsingVersion("v2026.6.11", () => INSTANCES)).toEqual([]);
  });

  it("returns one instance name when exactly one uses the version", () => {
    expect(findInstancesUsingVersion("v2026.7.1", () => INSTANCES)).toEqual(["alpha"]);
  });

  it("returns every instance name when multiple share the version", () => {
    const all = [
      { name: "x", version: "v2026.7.1" },
      { name: "y", version: "v2026.7.1" },
      { name: "z", version: "v2026.7.1" },
    ];
    expect(findInstancesUsingVersion("v2026.7.1", () => all)).toEqual(["x", "y", "z"]);
  });

  it("matches exactly — v2026.7.1 does NOT match v2026.7.1-2", () => {
    expect(findInstancesUsingVersion("v2026.7.1", () => INSTANCES)).toEqual(["alpha"]);
  });

  it("handles an empty instance list", () => {
    expect(findInstancesUsingVersion("v2026.7.1", () => [])).toEqual([]);
  });
});

describe("uninstallVersion (async)", () => {
  it("removes the version directory and the store entry", async () => {
    const dir = path.join(tmpDir, "v2026.7.1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "openclaw.mjs"), "x");

    await uninstallVersion("v2026.7.1");

    expect(fs.existsSync(dir)).toBe(false);
    expect(storeMock.removals).toContain("v2026.7.1");
  });

  it("removes a directory with many files (regression for the 30k-file freeze)", async () => {
    const dir = path.join(tmpDir, "v2026.7.1");
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    // 500 small files — enough to exercise the rm loop without slowing CI.
    for (let i = 0; i < 500; i++) {
      fs.writeFileSync(path.join(dir, "node_modules", `pkg-${i}.js`), `// ${i}`);
    }

    const t0 = Date.now();
    await uninstallVersion("v2026.7.1");
    const elapsed = Date.now() - t0;

    expect(fs.existsSync(dir)).toBe(false);
    expect(storeMock.removals).toContain("v2026.7.1");
    // Should be quick (well under 5s) — `fs.promises.rm` doesn't block the
    // event loop the way `fs.rmSync` did.
    expect(elapsed).toBeLessThan(5000);
  });

  it("is a no-op when the directory does not exist (but still drops the store entry)", async () => {
    // The directory was never created, e.g. install was interrupted. We
    // should not throw — just drop the store entry.
    await expect(uninstallVersion("v2026.6.11")).resolves.toBeUndefined();
    expect(storeMock.removals).toContain("v2026.6.11");
  });
});
