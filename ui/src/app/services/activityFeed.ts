// Copyright GraphCaster. All Rights Reserved.

export type ActivityEventType =
  | "run.finished"
  | "run.failed"
  | "run.node.started"
  | "run.node.finished"
  | "webhook.fired"
  | "collab.user_joined"
  | "plugin.updated"
  | "system.message";

export interface ActivityEvent {
  type: ActivityEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

type ActivityHandler = (event: ActivityEvent) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MULTIPLIER = 2;

export class ActivityFeedClient {
  private readonly wsUrl: string;
  private ws: WebSocket | null = null;
  private handlers: Set<ActivityHandler> = new Set();
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  connect(): void {
    if (this.closed) {
      this.closed = false;
    }
    this._open();
  }

  disconnect(): void {
    this.closed = true;
    this._clearReconnect();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  on(handler: ActivityHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private _open(): void {
    if (this.closed) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.warn("[ActivityFeed] WebSocket endpoint not available:", err);
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        console.warn("[ActivityFeed] Failed to parse message:", event.data);
        return;
      }

      if (!this._isActivityEvent(parsed)) {
        console.warn("[ActivityFeed] Unrecognised event shape:", parsed);
        return;
      }

      for (const h of this.handlers) {
        try {
          h(parsed);
        } catch (err) {
          console.error("[ActivityFeed] Handler threw:", err);
        }
      }
    };

    ws.onerror = () => {
      console.warn("[ActivityFeed] WebSocket error — will attempt reconnect.");
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.closed) {
        this._scheduleReconnect();
      }
    };
  }

  private _scheduleReconnect(): void {
    if (this.closed) return;
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS,
    );
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _isActivityEvent(v: unknown): v is ActivityEvent {
    if (!v || typeof v !== "object") return false;
    const obj = v as Record<string, unknown>;
    return (
      typeof obj["type"] === "string" &&
      typeof obj["timestamp"] === "string" &&
      obj["payload"] !== null &&
      typeof obj["payload"] === "object" &&
      !Array.isArray(obj["payload"])
    );
  }
}
