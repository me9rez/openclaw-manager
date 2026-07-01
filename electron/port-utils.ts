import net from "net";

const PROBE_TIMEOUT_MS = 2000;
const DEFAULT_MAX_TRIES = 1000;

export function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const server = net.createServer();
    const timer = setTimeout(() => {
      try { server.close(); } catch { /* ignore */ }
      finish(false);
    }, PROBE_TIMEOUT_MS);
    server.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    server.once("listening", () => {
      clearTimeout(timer);
      server.close(() => finish(true));
    });
    try {
      server.listen(port, host);
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

export async function findAvailablePort(
  start: number,
  options: { maxTries?: number; host?: string; reservedPorts?: Set<number> } = {},
): Promise<{ port: number; triedFrom: number; skipped: number[] }> {
  const maxTries = options.maxTries ?? DEFAULT_MAX_TRIES;
  const host = options.host ?? "127.0.0.1";
  const reserved = options.reservedPorts ?? new Set<number>();
  const skipped: number[] = [];
  let port = start;
  for (let i = 0; i < maxTries; i++) {
    if (reserved.has(port)) {
      skipped.push(port);
      port++;
      continue;
    }
    if (await isPortAvailable(port, host)) {
      return { port, triedFrom: start, skipped };
    }
    skipped.push(port);
    port++;
  }
  throw new Error(`No available port found in range [${start}, ${port})`);
}
