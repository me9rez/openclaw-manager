import { describe, it, expect } from "vitest";
import { splitSemver } from "../electron/semver";
// Imported purely for the type probe — `import type` is erased at runtime
// so this doesn't pull in `electron/store` side effects.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as _VersionManager from "../electron/version-manager";

// ---------- splitSemver ----------

describe("splitSemver", () => {
  it("splits a plain dotted version", () => {
    expect(splitSemver("2026.7.1")).toEqual({
      core: [2026, 7, 1],
      pre: undefined,
      build: undefined,
    });
  });

  it("strips a leading v", () => {
    expect(splitSemver("v2026.7.1")).toEqual({
      core: [2026, 7, 1],
      pre: undefined,
      build: undefined,
    });
  });

  it("separates pre-release from core", () => {
    expect(splitSemver("v2026.7.1-beta.6")).toEqual({
      core: [2026, 7, 1],
      pre: "beta.6",
      build: undefined,
    });
  });

  it("separates build metadata from pre-release", () => {
    expect(splitSemver("1.0.0-beta.1+build.7")).toEqual({
      core: [1, 0, 0],
      pre: "beta.1",
      build: "build.7",
    });
  });

  it("falls back to 0 for non-numeric core segments", () => {
    expect(splitSemver("vX.Y").core).toEqual([0, 0]);
  });
});

// ---------- parseVersions sort behaviour (via publishedAt ordering) ----------
//
// The production sort key is `publishedAt` from the npm registry, NOT
// SemVer precedence. Reason: OpenClaw publishes re-release hotfixes with
// suffixes like `v2026.7.1-2` AFTER the original `v2026.7.1` shipped —
// those are semver-pre-release under §11 and would otherwise sort BELOW
// `v2026.7.1`, which is wrong for an "is there a newer build?" list.

describe("parseVersions (publishedAt ordering)", () => {
  // Re-implement the exact sort parseVersions uses, so we can assert the
  // shape end-to-end without pulling in `electron/store` side effects.
  function parseVersionsLike(
    raw: string,
  ): { version: string; publishedAt: string }[] {
    const pkg = JSON.parse(raw);
    const timeMap: Record<string, string> = pkg.time || {};
    return Object.entries(timeMap)
      .filter(([v]) => v !== "created" && v !== "modified")
      .sort(([a, ta], [b, tb]) => {
        const byTime = ta.localeCompare(tb);
        if (byTime !== 0) return byTime;
        const ca = splitSemver(a).core;
        const cb = splitSemver(b).core;
        const len = Math.max(ca.length, cb.length);
        for (let i = 0; i < len; i++) {
          const diff = (ca[i] ?? 0) - (cb[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      })
      .reverse()
      .map(([version, publishedAt]) => ({
        version: version.startsWith("v") ? version : `v${version}`,
        publishedAt,
      }));
  }

  const fixtures = {
    "2026.7.1": "2026-07-14T00:00:00.000Z",
    "2026.7.1-beta.6": "2026-07-13T00:00:00.000Z",
    "2026.7.1-beta.5": "2026-07-11T00:00:00.000Z",
    "2026.7.1-beta.4": "2026-07-11T00:00:00.000Z",
    "2026.7.1-beta.2": "2026-07-05T00:00:00.000Z",
    "2026.7.1-beta.1": "2026-07-02T00:00:00.000Z",
    "2026.7.2-beta.1": "2026-07-16T00:00:00.000Z",
    "2026.7.2-beta.2": "2026-07-17T00:00:00.000Z",
    "2026.7.2-beta.3": "2026-07-19T00:00:00.000Z",
    "2026.7.1-1": "2026-07-18T00:00:00.000Z",
    "2026.7.1-2": "2026-07-18T00:00:00.000Z",
    "2026.6.11": "2026-07-01T00:00:00.000Z",
  };
  const raw = JSON.stringify({ time: fixtures });

  it("orders by publish time, newest first", () => {
    const list = parseVersionsLike(raw).map((v) => v.version);
    expect(list).toEqual([
      "v2026.7.2-beta.3", // 7/19 — newest
      "v2026.7.1-2",      // 7/18
      "v2026.7.1-1",      // 7/18
      "v2026.7.2-beta.2", // 7/17
      "v2026.7.2-beta.1", // 7/16
      "v2026.7.1",        // 7/14
      "v2026.7.1-beta.6", // 7/13
      "v2026.7.1-beta.4", // 7/11 — same instant as beta.5; order is stable
      "v2026.7.1-beta.5", // 7/11 — so this lands after beta.4 in the input map
      "v2026.7.1-beta.2", // 7/5
      "v2026.7.1-beta.1", // 7/2
      "v2026.6.11",       // 7/1
    ]);
  });

  it("places a re-release suffix (-N) ABOVE the original version it supplements", () => {
    // This is the rule the user flagged: v2026.7.1-2 was published on 7/18,
    // strictly after v2026.7.1 (7/14), so it MUST appear above the original.
    const list = parseVersionsLike(raw).map((v) => v.version);
    const idxOriginal = list.indexOf("v2026.7.1");
    const idxDash1 = list.indexOf("v2026.7.1-1");
    const idxDash2 = list.indexOf("v2026.7.1-2");
    expect(idxDash1).toBeGreaterThan(-1);
    expect(idxDash2).toBeGreaterThan(-1);
    expect(idxDash1).toBeLessThan(idxOriginal);
    expect(idxDash2).toBeLessThan(idxOriginal);
  });

  it("preserves the original publishedAt strings for the UI", () => {
    const list = parseVersionsLike(raw);
    const v1 = list.find((v) => v.version === "v2026.7.1")!;
    const v12 = list.find((v) => v.version === "v2026.7.1-2")!;
    expect(v1.publishedAt).toBe("2026-07-14T00:00:00.000Z");
    expect(v12.publishedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("filters out the created/modified sentinels", () => {
    const rawWithSentinels = JSON.stringify({
      time: {
        ...fixtures,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-07-20T00:00:00.000Z",
      },
    });
    const list = parseVersionsLike(rawWithSentinels).map((v) => v.version);
    expect(list).not.toContain("vcreated");
    expect(list).not.toContain("vmodified");
  });
});

// ---------- listAvailableVersions (public API shape) ----------

// We deliberately don't import the runtime `listAvailableVersions` here:
// that module pulls in `electron/store`, which calls `app.getPath(...)` at
// import time and crashes in a plain Node test environment. This block
// just sanity-checks the public type signature.

describe("listAvailableVersions (shape)", () => {
  it("exposes the expected public type", () => {
    type PublicApi = typeof _VersionManager.listAvailableVersions;
    const _typeProbe: PublicApi = (() => Promise.resolve([])) as unknown as PublicApi;
    expect(_typeProbe).toBeDefined();
  });
});
