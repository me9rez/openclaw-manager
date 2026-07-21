import WebSocket from "ws";
import { randomUUID } from "crypto";
import { buildDeviceBlock, DeviceIdentity } from "./device-identity";

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
  onReconnecting?: (attempt: number, nextDelayMs: number, lastError?: string) => void;
  onMaxAttemptsReached?: (attempts: number) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

const PROBE_TIMEOUT_MS = 2_000;
const CHALLENGE_TIMEOUT_MS = 15_000;
const CONNECT_RESPONSE_TIMEOUT_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_RATIO = 0.2;
const CLIENT_ID = "gateway-client";
const CLIENT_DISPLAY_NAME = "OpenClaw Manager";
const CLIENT_VERSION = "0.1.0";
const PROTOCOL_VERSION = 4;
const TICK_TIMEOUT_CLOSE_CODE = 4000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private probeSocket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private challengeTimer: NodeJS.Timeout | null = null;
  private connectResponseTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private lastLivenessAt = 0;
  private connectNonce: string | null = null;
  private connectSent = false;
  private lastError: string | null = null;
  private tickIntervalMs: number = HEARTBEAT_INTERVAL_MS;
  private tickTimeoutMs: number = HEARTBEAT_TIMEOUT_MS;
  private maxPayloadBytes: number = 25 * 1024 * 1024;

  constructor(
    private url: string,
    private token: string,
    private deviceIdentity: DeviceIdentity | null,
    private callbacks: GatewayClientCallbacks,
  ) {}

  connect(): void {
    if (this.closed) return;
    void this.attemptConnect();
  }

  forceReconnect(): void {
    if (this.closed) return;
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.cancelReconnectTimer();
    this.terminateCurrentSocket();
    void this.attemptConnect();
  }

  disconnect(): void {
    this.closed = true;
    this.cancelReconnectTimer();
    this.cleanupTimers();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      // 使用 safelyDestroySocket 而非 close():对处于 CONNECTING 状态的
      // socket,close() 仍会在下一个 tick 异步抛出 "closed before the
      // connection was established",同样需要兜底。
      this.safelyDestroySocket(socket);
    }
    this.terminateProbeSocket();
    this.rejectAllPending("Gateway disconnected");
  }

  simulateDisconnect(): void {
    // 测试/诊断用:模拟一次"网线被拔"的效果——拆掉当前 socket,
    // 但**不**置 closed,让重连逻辑接管。
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        /* 吞掉 — safelyDestroySocket 内部已经处理过 */
      }
      this.ws = null;
    }
    this.cleanupTimers();
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.connectResponseTimer) {
      clearTimeout(this.connectResponseTimer);
      this.connectResponseTimer = null;
    }
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private terminateProbeSocket(): void {
    if (this.probeSocket) {
      const socket = this.probeSocket;
      this.probeSocket = null;
      this.safelyDestroySocket(socket);
    }
  }

  /**
   * 强制销毁一个 WebSocket,不让它的 "closed before the connection was
   * established" 错误冒到 Node 的 `uncaughtException`。
   *
   * 为什么需要这样:
   *   - 对还处于 `CONNECTING` 状态的 socket 调 `WebSocket.terminate()`,
   *     ws 库会在下一个 event-loop tick 异步抛出一个 `Error`(它用
   *     `process.nextTick` 在强制 close 之后 emit 出来)。如果没有
   *     `'error'` 监听器在接,这个 error 就会逃逸到 `process`,触发
   *     Electron 的 "A JavaScript error occurred in the main process" 对话框。
   *   - 对 `CONNECTING` 状态的 socket 调 `WebSocket.close()`(优雅关闭)
   *     也有同样的问题。
   *   - 如果在 terminate 之前先 `removeAllListeners()`,那连让一个
   *     `error` 监听器去接住 throw 的机会都没了。
   *
   * 所以正确顺序是:先 attach 一个 no-op `error` 监听器 → 再
   * `removeAllListeners()` → 再 `terminate()`。这样 throw 就被
   * 我们的 no-op 监听器接住并丢弃。
   */
  private safelyDestroySocket(socket: WebSocket): void {
    try {
      socket.on("error", () => {
        // 故意留空:用来吞掉 ws 库在强制 terminate 一个 CONNECTING 中的
        // socket 时抛出的 "WebSocket was closed before the connection
        // was established"。
      });
      socket.removeAllListeners();
      socket.terminate();
    } catch {
      // 同步 throw(例如对已经销毁的 socket 调 .terminate())也安全忽略。
    }
  }

  private terminateCurrentSocket(): void {
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.safelyDestroySocket(socket);
    }
    this.terminateProbeSocket();
  }

  private rejectAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private async attemptConnect(): Promise<void> {
    if (this.closed) return;

    this.terminateCurrentSocket();
    this.cleanupTimers();

    const probeOk = await this.probeReady();
    if (this.closed) return;
    if (!probeOk) {
      this.lastError = "网关未就绪(probe 超时)";
      this.scheduleReconnect();
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.lastError = `WS 创建失败: ${err instanceof Error ? err.message : String(err)}`;
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    this.connectSent = false;
    this.connectNonce = null;
    this.lastLivenessAt = Date.now();

    this.challengeTimer = setTimeout(() => {
      if (!this.connectSent) {
        this.lastError = "等待 connect.challenge 超时";
        this.scheduleReconnect();
      }
    }, CHALLENGE_TIMEOUT_MS);

    socket.on("open", () => {
      this.lastLivenessAt = Date.now();
    });

    socket.on("message", (data) => {
      this.lastLivenessAt = Date.now();
      this.handleMessage(data.toString());
    });

    socket.on("pong", () => {
      this.lastLivenessAt = Date.now();
    });

    socket.on("close", (code, reason) => {
      this.cleanupTimers();
      this.connected = false;
      this.rejectAllPending("Gateway disconnected");

      if (this.closed) return;
      if (this.isFatalCloseCode(code)) {
        this.lastError = `网关拒绝连接 (code=${code}, reason=${reason.toString() || "none"})`;
        this.callbacks.onError?.(new Error(this.lastError));
        this.closed = true;
        return;
      }
      this.lastError = `连接断开 (code=${code}, reason=${reason.toString() || "none"})`;
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.lastError = err.message;
      // 'error' 后面会跟一个 'close' 事件,真正的重连逻辑在那边处理。
    });
  }

  private probeReady(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(false);
        return;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        resolve(false);
        return;
      }

      let settled = false;
      const cleanup = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (this.probeTimer) {
          clearTimeout(this.probeTimer);
          this.probeTimer = null;
        }
        // 必须在 removeAllListeners 之前先 attach 一个 no-op 'error' 监听器,
        // 这样 terminate() 触发的 "closed before the connection was
        // established" 异步 throw 才有地方落地。否则它会逃逸到 process,
        // 触发 Electron 的 uncaught exception dialog。
        try {
          socket.on("error", () => { /* 吞掉 */ });
          socket.removeAllListeners("error");
          socket.removeAllListeners();
          socket.terminate();
        } catch {
          /* 吞掉 */
        }
        if (this.probeSocket === socket) this.probeSocket = null;
        resolve(result);
      };

      this.probeSocket = socket;
      this.probeTimer = setTimeout(() => cleanup(false), PROBE_TIMEOUT_MS);

      socket.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg?.type === "event" && msg.event === "connect.challenge") {
            cleanup(true);
          }
        } catch {
          // 忽略非 JSON 的帧
        }
      });

      socket.on("error", () => cleanup(false));
      socket.on("close", () => cleanup(false));
    });
  }

  private isFatalCloseCode(code: number): boolean {
    // 4xxx: 协议层拒绝,重试没用。
    // 例外:4000 是 gateway 心跳超时 close code(瞬时 liveness 失败)。
    if (code === TICK_TIMEOUT_CLOSE_CODE) return false;
    return code >= 4000 && code < 5000;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    this.reconnectAttempts++;
    const attempts = this.reconnectAttempts;

    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      this.callbacks.onMaxAttemptsReached?.(attempts - 1);
      this.closed = true;
      return;
    }

    const base = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
    const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.floor(base + jitter));

    this.cancelReconnectTimer();
    this.callbacks.onReconnecting?.(attempts, delay, this.lastError ?? undefined);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptConnect();
    }, delay);
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
          this.sendConnect(nonce);
        }
        return;
      }
      if (evt.event === "tick") {
        this.lastLivenessAt = Date.now();
        return;
      }
      if (evt.event === "payload.large") {
        const payload = evt.payload as { limit?: number; size?: number; surface?: string } | undefined;
        console.warn(
          `[gateway-client] payload.large size=${payload?.size ?? "?"} limit=${payload?.limit ?? "?"} surface=${payload?.surface ?? "?"}`,
        );
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

  private sendConnect(nonce: string): void {
    if (this.connectSent || !this.ws) return;
    this.connectSent = true;

    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }

    const connectId = `connect-${Date.now()}-${randomUUID()}`;
    const clientMode = "backend";
    const role = "operator";
    const scopes: readonly string[] = ["operator.admin"];
    const signedAtMs = Date.now();

    const device =
      this.deviceIdentity
        ? buildDeviceBlock(this.deviceIdentity, {
            deviceId: this.deviceIdentity.deviceId,
            clientId: CLIENT_ID,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: this.token,
            nonce,
          })
        : undefined;

    const frame = {
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: CLIENT_ID,
          displayName: CLIENT_DISPLAY_NAME,
          version: CLIENT_VERSION,
          platform: process.platform,
          mode: clientMode,
        },
        auth: { token: this.token },
        caps: [],
        role,
        scopes,
        device,
      },
    };

    const responseTimer = setTimeout(() => {
      if (this.pending.has(connectId)) {
        this.pending.delete(connectId);
        this.lastError = "等待 connect 响应超时";
        this.scheduleReconnect();
      }
    }, CONNECT_RESPONSE_TIMEOUT_MS);
    this.connectResponseTimer = responseTimer;

    this.pending.set(connectId, {
      resolve: (payload) => {
        clearTimeout(responseTimer);
        if (this.connectResponseTimer === responseTimer) this.connectResponseTimer = null;
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastError = null;
        this.applyServerPolicy(payload);
        this.startHeartbeat();
        this.callbacks.onConnected?.();
      },
      reject: (err) => {
        clearTimeout(responseTimer);
        if (this.connectResponseTimer === responseTimer) this.connectResponseTimer = null;
        this.lastError = `握手被拒: ${err.message}`;
        this.scheduleReconnect();
      },
      timer: responseTimer,
    });

    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      this.pending.delete(connectId);
      clearTimeout(responseTimer);
      if (this.connectResponseTimer === responseTimer) this.connectResponseTimer = null;
      this.lastError = `发送 connect 失败: ${err instanceof Error ? err.message : String(err)}`;
      this.scheduleReconnect();
    }
  }

  private applyServerPolicy(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const p = payload as { policy?: { tickIntervalMs?: number; maxPayload?: number; maxBufferedBytes?: number } };
    const policy = p.policy;
    if (!policy) return;
    if (typeof policy.tickIntervalMs === "number" && policy.tickIntervalMs > 0) {
      this.tickIntervalMs = policy.tickIntervalMs;
      this.tickTimeoutMs = policy.tickIntervalMs * 2;
    }
    if (typeof policy.maxPayload === "number" && policy.maxPayload > 0) {
      this.maxPayloadBytes = policy.maxPayload;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.ping();
      } catch {
        /* 吞掉 — ping 在 socket 已断开时可能同步抛 */
      }
      const now = Date.now();
      if (now - this.lastLivenessAt > this.tickTimeoutMs) {
        this.lastError = `心跳超时 (${Math.floor((now - this.lastLivenessAt) / 1000)}s 未响应)`;
        // 用 helper:在我们请求 terminate 时,这个 socket 可能已经不在
        // OPEN 状态,ws 库会异步抛 "closed before established" 同样需要兜底。
        this.safelyDestroySocket(this.ws);
      }
    }, this.tickIntervalMs);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Gateway not connected"));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws.send(JSON.stringify({ type: "req", id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}