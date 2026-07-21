import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import https from "https";
import { EventEmitter } from "events";
import { Readable } from "stream";

// Mock the storage surface so importing version-manager doesn't blow up
// at module load (`app.getPath` is not available in vitest's node env).
vi.mock("../electron/store", () => ({
  getVersionDir: () => "",
  addVersion: () => {},
  removeVersion: () => {},
  getVersions: () => [],
}));

// We swap out `https.get` per test. Each test sets up a mock that returns
// the desired (url → body | error) behaviour, then calls the public
// `listAvailableVersions` function and asserts on the result.
type Handler = (url: string) => Promise<string>;
let handler: Handler = async () => {
  throw new Error("no handler set");
};

vi.spyOn(https, "get").mockImplementation((url: unknown, _opts: unknown, cb: unknown) => {
  const u = String(url);
  const req = new EventEmitter() as EventEmitter & { destroy: () => void };
  req.destroy = () => { /* noop for tests */ };
  Promise.resolve()
    .then(() => handler(u))
    .then(
      (body) => {
        // Cast: IncomingMessage is a Readable + has a numeric statusCode.
        // Readable alone doesn't carry that field, so we widen the type.
        const res = new Readable({ read() {} }) as unknown as {
          statusCode: number;
          on: (event: string, listener: (...args: unknown[]) => void) => void;
        };
        res.statusCode = 200;
        (res as unknown as Readable).push(body);
        (res as unknown as Readable).push(null);
        (cb as (res: unknown) => void)(res);
      },
      (err: Error) => {
        req.emit("error", err);
      },
    );
  return req as unknown as ReturnType<typeof https.get>;
});

import { listAvailableVersions } from "../electron/version-manager";

beforeEach(() => {
  handler = async () => { throw new Error("no handler set"); };
});

afterEach(() => {
  // Force the next call to refetch by waiting out the 5-minute cache
  // isn't practical. Instead, the tests that need a fresh fetch use
  // `force: true`. Tests that rely on caching just count the calls.
});

describe("parseAntfuVersions (via listAvailableVersions)", () => {
  it("uses the antfu endpoint first and returns newest-first ordering", async () => {
    handler = async (url) => {
      expect(url).toContain("npm.antfu.dev/versions/openclaw?metadata=true");
      return JSON.stringify({
        name: "openclaw",
        versionsMeta: {
          "0.0.1":         { time: "2026-01-29T11:08:12.101Z" },
          "2026.7.1-2":    { time: "2026-07-18T03:53:48.967Z" },
          "2026.7.1":      { time: "2026-07-13T17:58:18.920Z" },
          "2026.6.11":     { time: "2026-06-30T16:04:00.916Z" },
          "2026.7.2-beta.3": { time: "2026-07-18T23:15:12.160Z" },
        },
      });
    };
    const result = await listAvailableVersions(true);
    // The order should be: 2026.7.2-beta.3, 2026.7.1-2, 2026.7.1,
    // 2026.6.11, 0.0.1
    expect(result.map((v) => v.version)).toEqual([
      "v2026.7.2-beta.3",
      "v2026.7.1-2",
      "v2026.7.1",
      "v2026.6.11",
      "v0.0.1",
    ]);
    // Re-publish suffix lands above the original — that's the whole point
    // of using the time field rather than SemVer.
    const idx71 = result.findIndex((v) => v.version === "v2026.7.1");
    const idx712 = result.findIndex((v) => v.version === "v2026.7.1-2");
    expect(idx712).toBeLessThan(idx71);
  });

  it("falls back to npm registry when antfu returns malformed JSON", async () => {
    let calls = 0;
    handler = async (url) => {
      calls++;
      if (url.includes("antfu.dev")) {
        return "{ not valid json";
      }
      // npm fallback shape (subset)
      return JSON.stringify({
        time: {
          "2026.7.1-2": "2026-07-18T03:53:48.967Z",
          "2026.7.1":   "2026-07-13T17:58:18.920Z",
          "0.0.1":      "2026-01-29T11:08:12.101Z",
        },
      });
    };
    const result = await listAvailableVersions(true);
    expect(calls).toBe(2); // antfu tried, then npm
    expect(result.map((v) => v.version)).toEqual([
      "v2026.7.1-2",
      "v2026.7.1",
      "v0.0.1",
    ]);
  });

  it("falls back to npm when antfu returns a non-200 (simulated via handler throw)", async () => {
    let calls = 0;
    handler = async (url) => {
      calls++;
      if (url.includes("antfu.dev")) {
        throw new Error("HTTP 503: upstream maintenance");
      }
      return JSON.stringify({
        time: { "2026.7.1": "2026-07-13T17:58:18.920Z" },
      });
    };
    const result = await listAvailableVersions(true);
    expect(calls).toBe(2);
    expect(result.map((v) => v.version)).toEqual(["v2026.7.1"]);
  });

  it("falls back to npm when antfu returns an empty versionsMeta", async () => {
    handler = async (url) => {
      if (url.includes("antfu.dev")) {
        return JSON.stringify({ name: "openclaw", versionsMeta: {} });
      }
      return JSON.stringify({
        time: { "2026.7.1": "2026-07-13T17:58:18.920Z" },
      });
    };
    const result = await listAvailableVersions(true);
    expect(result.map((v) => v.version)).toEqual(["v2026.7.1"]);
  });

  it("skips antfu versions missing a time field (they can't be sorted)", async () => {
    handler = async (url) => {
      if (url.includes("antfu.dev")) {
        return JSON.stringify({
          versionsMeta: {
            "2026.7.1":     { time: "2026-07-13T17:58:18.920Z" },
            "2026.7.1-2":   { integrity: "sha512-..." /* no time */ },
            "2026.7.2-beta.1": { time: "2026-07-15T17:14:38.356Z" },
          },
        });
      }
      return JSON.stringify({ time: {} });
    };
    const result = await listAvailableVersions(true);
    expect(result.map((v) => v.version)).toEqual([
      "v2026.7.2-beta.1",
      "v2026.7.1",
    ]);
  });

  it("throws if both endpoints fail (does not silently return [])", async () => {
    handler = async () => {
      throw new Error("network down");
    };
    await expect(listAvailableVersions(true)).rejects.toThrow(/network down/);
  });

  it("caches successful antfu fetches within the TTL window", async () => {
    let calls = 0;
    handler = async (url) => {
      calls++;
      if (url.includes("antfu.dev")) {
        return JSON.stringify({
          versionsMeta: { "2026.7.1": { time: "2026-07-13T17:58:18.920Z" } },
        });
      }
      throw new Error("npm should not be called when antfu succeeds");
    };
    // First call hits the network.
    await listAvailableVersions(true);
    // Subsequent calls within the TTL should not.
    await listAvailableVersions(false);
    await listAvailableVersions(false);
    expect(calls).toBe(1);
  });
});
