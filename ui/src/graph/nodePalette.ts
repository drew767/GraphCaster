// Copyright GraphCaster. All Rights Reserved.

import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AGENT,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_TRIGGER_WEBHOOK,
  GRAPH_NODE_TYPE_TRIGGER_SCHEDULE,
} from "./nodeKinds";

function newShortIdSegment(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return String(Date.now());
}

export function newGraphNodeId(): string {
  return `n-${newShortIdSegment()}`;
}

/** Stable prefix `group-`; does not depend on `newGraphNodeId` string shape. */
export function newGroupFrameId(): string {
  return `group-${newShortIdSegment()}`;
}

export function newGraphEdgeId(): string {
  return `e-${newShortIdSegment()}`;
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
    case GRAPH_NODE_TYPE_GROUP:
      return { title: "Group", width: 360, height: 220 };
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
    case GRAPH_NODE_TYPE_HTTP_REQUEST:
      return {
        title: "HTTP request",
        url: "",
        method: "GET",
        headers: {},
        timeoutSec: 30,
        verifyTls: true,
        parseResponseBody: "auto",
      };
    case GRAPH_NODE_TYPE_RAG_QUERY:
      return {
        title: "RAG query",
        url: "",
        query: "",
        method: "POST",
        topK: 5,
        headers: {},
        timeoutSec: 60,
        verifyTls: true,
        parseResponseBody: "auto",
      };
    case GRAPH_NODE_TYPE_RAG_INDEX:
      return {
        title: "RAG index",
        collectionId: "",
        text: "",
        mode: "replace",
        chunkSize: 512,
        chunkOverlap: 64,
        embeddingDims: 64,
      };
    case GRAPH_NODE_TYPE_DELAY:
      return { title: "Delay", durationSec: 1 };
    case GRAPH_NODE_TYPE_DEBOUNCE:
      return { title: "Debounce", durationSec: 1 };
    case GRAPH_NODE_TYPE_WAIT_FOR:
      return {
        title: "Wait for",
        waitMode: "file",
        path: "",
        timeoutSec: 300,
        pollIntervalSec: 0.25,
      };
    case GRAPH_NODE_TYPE_SET_VARIABLE:
      return {
        title: "Set variable",
        name: "myVar",
        operation: "set",
        value: null,
      };
    case GRAPH_NODE_TYPE_PYTHON_CODE:
      return {
        title: "Python code",
        code: 'result = {"ok": True}',
        timeoutSec: 30,
      };
    case GRAPH_NODE_TYPE_LLM_AGENT:
      return {
        title: "LLM agent",
        command: "",
        cwd: "",
        timeoutSec: 600,
        maxAgentSteps: 0,
        envKeys: [],
        inputPayload: {},
      };
    case GRAPH_NODE_TYPE_AGENT:
      return {
        title: "Agent",
        inputText: "",
        maxIterations: 10,
      };
    case GRAPH_NODE_TYPE_TRIGGER_WEBHOOK:
      return {
        title: "Webhook trigger",
        path: "/hook",
        method: "POST",
        auth: "none",
        responseMode: "immediate",
      };
    case GRAPH_NODE_TYPE_TRIGGER_SCHEDULE:
      return {
        title: "Schedule trigger",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
      };
    default:
      return {};
  }
}
