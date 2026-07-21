import { describe, it, expect, afterEach } from "vitest";
import net from "net";
import { isPortAvailable, findAvailablePort } from "../electron/port-utils";

// Helper: open an actual server on 127.0.0.1:0 and return the assigned port
// plus the server itself, so the caller can decide whether to keep it open
// (to occupy the port) or close it.
function listen(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("no address"));
      }
    });
  });
}

// Track every server we open so afterEach can close them all. Use a per-test
// stack so we don't get cross-test interference.
let openServers: net.Server[] = [];
afterEach(() => {
  while (openServers.length) {
    const s = openServers.pop()!;
    try { s.close(); } catch { /* ignore */ }
  }
});

function occupy(): Promise<number> {
  return listen().then(({ server, port }) => {
    openServers.push(server);
    return port;
  });
}

async function freePort(): Promise<number> {
  const { server, port } = await listen();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Give the OS a moment to release the port.
  await new Promise((r) => setTimeout(r, 50));
  return port;
}

describe("isPortAvailable", () => {
  it("returns true for a port that is currently free", async () => {
    const port = await freePort();
    const free = await isPortAvailable(port);
    expect(free).toBe(true);
  });

  it("returns false for a port that has an active listener", async () => {
    const port = await occupy();
    const free = await isPortAvailable(port);
    expect(free).toBe(false);
  });
});

describe("findAvailablePort", () => {
  it("returns the starting port when it is free", async () => {
    const port = await freePort();
    const result = await findAvailablePort(port);
    expect(result.port).toBe(port);
    expect(result.skipped).toEqual([]);
  });

  it("skips occupied ports in order and returns the next free one", async () => {
    // Pre-occupy two consecutive ports; findAvailablePort should hop over both.
    const p1 = await occupy();
    const p2 = await occupy();
    expect(p2).toBe(p1 + 1);
    const result = await findAvailablePort(p1);
    expect(result.port).toBeGreaterThan(p2);
    expect(result.skipped).toContain(p1);
    expect(result.skipped).toContain(p2);
  });

  it("treats reservedPorts as occupied even when the OS port is free", async () => {
    const port = await freePort();
    const result = await findAvailablePort(port, { reservedPorts: new Set([port]) });
    expect(result.port).toBeGreaterThan(port);
    expect(result.skipped).toContain(port);
  });

  it("throws when the range is fully exhausted", async () => {
    const port = await occupy();
    await expect(findAvailablePort(port, { maxTries: 1 })).rejects.toThrow(/No available port/);
  });
});
