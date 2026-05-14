// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";

import {
  ActivityFeedClient,
  type ActivityEvent,
} from "../../services/activityFeed";
import {
  useRunStore,
  type NodeRunStatus,
} from "../../stores/runStore";

export interface ActivityFeedBridgeProps {
  /** WebSocket URL for the live event stream. Defaults to relative `/api/v1/events/stream`. */
  wsUrl?: string;
  /** Optional injection point used in tests. */
  client?: { on: (handler: (e: ActivityEvent) => void) => () => void };
}

function defaultWsUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/events/stream";
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/events/stream`;
}

function pickNodeId(payload: Record<string, unknown> | undefined): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)["nodeId"];
  if (typeof v === "string" && v.length > 0) return v;
  const alt = (payload as Record<string, unknown>)["node_id"];
  if (typeof alt === "string" && alt.length > 0) return alt;
  return null;
}

function pickFinishedStatus(
  payload: Record<string, unknown> | undefined,
): NodeRunStatus | null {
  if (!payload) return null;
  const s = (payload as Record<string, unknown>)["status"];
  if (s === "success" || s === "error") return s;
  return null;
}

export function handleActivityEvent(event: ActivityEvent): void {
  const setNodeStatus = useRunStore.getState().setNodeStatus;
  if (event.type === "run.node.started") {
    const nodeId = pickNodeId(event.payload as Record<string, unknown>);
    if (nodeId) setNodeStatus(nodeId, "running");
    return;
  }
  if (event.type === "run.node.finished") {
    const nodeId = pickNodeId(event.payload as Record<string, unknown>);
    const status = pickFinishedStatus(event.payload as Record<string, unknown>);
    if (nodeId && status) setNodeStatus(nodeId, status);
    return;
  }
}

/**
 * Headless component: subscribes to the activity-feed WS stream and pushes
 * per-node `run.node.started` / `run.node.finished` events into the run store
 * so the canvas reflects live node status in real time.
 *
 * Renders nothing; mount once near the app root.
 */
export function ActivityFeedBridge(props: ActivityFeedBridgeProps): null {
  useEffect(() => {
    if (props.client) {
      return props.client.on(handleActivityEvent);
    }
    const url = props.wsUrl ?? defaultWsUrl();
    const c = new ActivityFeedClient(url);
    const off = c.on(handleActivityEvent);
    c.connect();
    return () => {
      off();
      c.disconnect();
    };
  }, [props.client, props.wsUrl]);

  return null;
}
