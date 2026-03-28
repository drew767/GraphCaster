// Copyright GraphCaster. All Rights Reserved.

import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";

export function newGraphNodeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `n-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `n-${Date.now()}`;
}

export function newGraphEdgeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `e-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `e-${Date.now()}`;
}

/** Preset task.data for Cursor Agent CLI (`gcCursorAgent`); see python/graph_caster/cursor_agent_argv.py */
export function defaultCursorAgentTaskData(): Record<string, unknown> {
  return {
    title: "Cursor Agent",
    gcCursorAgent: {
      presetVersion: 1,
      prompt: "",
      cwdBase: "workspace_root",
      printMode: true,
      applyFileChanges: false,
    },
    timeoutSec: 600,
    successMode: "exit_code",
  };
}

export function defaultDataForNodeType(type: string): Record<string, unknown> {
  switch (type) {
    case GRAPH_NODE_TYPE_GRAPH_REF:
      return { targetGraphId: "" };
    case GRAPH_NODE_TYPE_TASK:
      return { title: "Task" };
    case GRAPH_NODE_TYPE_EXIT:
      return { title: "Exit" };
    case GRAPH_NODE_TYPE_COMMENT:
      return { title: "Section", width: 360, height: 220 };
    case GRAPH_NODE_TYPE_MERGE:
      return { title: "Merge" };
    case GRAPH_NODE_TYPE_FORK:
      return { title: "Fork" };
    case GRAPH_NODE_TYPE_AI_ROUTE:
      return {
        title: "AI route",
        providerKind: "http_json",
        endpointUrl: "",
        envVarApiKey: "",
        timeoutSec: 30,
        maxRetries: 0,
        retryBackoffSec: 1,
        maxRequestJsonBytes: 65536,
        authorHint: "",
        onFailure: "stop_run",
        fallbackChoiceIndex: 1,
      };
    case GRAPH_NODE_TYPE_MCP_TOOL:
      return {
        title: "MCP tool",
        transport: "stdio",
        toolName: "echo",
        arguments: {},
        timeoutSec: 60,
        argv: [],
        serverUrl: "",
        allowInsecureLocalhost: false,
        bearerEnvKey: "",
        envKeys: [],
      };
    default:
      return {};
  }
}
