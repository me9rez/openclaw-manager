import WebSocket from "ws";
import { randomUUID } from "crypto";

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

export type GatewayClientCallbacks = {
  onHealth?: (health: unknown) => void;
  onConnected?: () => void;
  onDisconnected?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTick: number = 0;
  private connectNonce: string | null = null;
  private connectSent = false;

  constructor(
    private url: string,
    private token: string,
    private callbacks: GatewayClientCallbacks,
  ) {}

  connect(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    this.connectSent = false;
    this.connectNonce = null;

    this.ws.on("open", () => {
      this.lastTick = Date.now();
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      this.cleanup();
      this.callbacks.onDisconnected?.(code, reason.toString());
    });

    this.ws.on("error", (err) => {
      this.callbacks.onError?.(err);
    });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: string };

    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: string } | undefined;
        const nonce = payload?.nonce || null;
        if (nonce) {
          this.connectNonce = nonce;
          this.sendConnect();
        }
        return;
      }
      if (evt.event === "tick") {
        this.lastTick = Date.now();
        return;
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      clearTimeout(p.timer);
      if (res.ok) {
        p.resolve(res.payload);
      } else {
        p.reject(new Error(res.error?.message || "request failed"));
      }
    }
  }

  private sendConnect(): void {
    if (this.connectSent || !this.ws) return;
    this.connectSent = true;
    this.request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        version: "0.1.0",
        platform: process.platform,
        mode: "backend",
      },
      role: "operator",
      scopes: ["operator.read"],
      caps: [],
      auth: { token: this.token },
      userAgent: "openclaw-manager/0.1.0",
      locale: "en-US",
    })
      .then(() => {
        this.callbacks.onConnected?.();
        this.startPolling();
      })
      .catch((err: unknown) => {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
  }

  private startPolling(): void {
    this.pollHealth();
    this.healthTimer = setInterval(() => this.pollHealth(), 30_000);
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastTick > 90_000) {
        this.callbacks.onError?.(new Error("Gateway tick timeout"));
        this.disconnect();
      }
    }, 30_000);
  }

  private async pollHealth(): Promise<void> {
    try {
      const health = await this.request("health");
      this.callbacks.onHealth?.(health);
    } catch {
      // health poll failed silently
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Gateway not connected"));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 15_000);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  disconnect(): void {
    this.closed = true;
    this.cleanup();
    this.ws?.close();
    this.ws = null;
  }

  private cleanup(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Gateway disconnected"));
    }
    this.pending.clear();
  }
}
