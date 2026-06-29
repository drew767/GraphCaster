// Copyright GraphCaster. All Rights Reserved.

import type { ComponentType } from "react";

import { HttpRequestInspector } from "../components/inspector/nodes/HttpRequestInspector";
import { McpToolInspector } from "../components/inspector/nodes/McpToolInspector";
import { PythonCodeInspector } from "../components/inspector/nodes/PythonCodeInspector";
import { RagQueryInspector } from "../components/inspector/nodes/RagQueryInspector";
import { TaskInspector } from "../components/inspector/nodes/TaskInspector";
import type { GraphDocumentJson, GraphNodeJson } from "./types";
import {
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";

export type InspectorProps = {
  node: GraphNodeJson;
  graphDocument: GraphDocumentJson;
  runLocked: boolean;
  workspaceLinked: boolean;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
};

export const INSPECTOR_REGISTRY: Readonly<Record<string, ComponentType<InspectorProps>>> = {
  [GRAPH_NODE_TYPE_HTTP_REQUEST]: HttpRequestInspector,
  [GRAPH_NODE_TYPE_MCP_TOOL]: McpToolInspector,
  [GRAPH_NODE_TYPE_PYTHON_CODE]: PythonCodeInspector,
  [GRAPH_NODE_TYPE_RAG_QUERY]: RagQueryInspector,
  [GRAPH_NODE_TYPE_TASK]: TaskInspector,
};
