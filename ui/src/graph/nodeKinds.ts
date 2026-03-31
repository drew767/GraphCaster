// Copyright GraphCaster. All Rights Reserved.

export const GRAPH_NODE_TYPE_START = "start" as const;
export const GRAPH_NODE_TYPE_EXIT = "exit" as const;
export const GRAPH_NODE_TYPE_TASK = "task" as const;
export const GRAPH_NODE_TYPE_GRAPH_REF = "graph_ref" as const;
export const GRAPH_NODE_TYPE_COMMENT = "comment" as const;
/** Organizational canvas frame (n8n-style); non-executable, like comment. */
export const GRAPH_NODE_TYPE_GROUP = "group" as const;
export const GRAPH_NODE_TYPE_MERGE = "merge" as const;
export const GRAPH_NODE_TYPE_FORK = "fork" as const;
export const GRAPH_NODE_TYPE_AI_ROUTE = "ai_route" as const;
export const GRAPH_NODE_TYPE_MCP_TOOL = "mcp_tool" as const;
export const GRAPH_NODE_TYPE_HTTP_REQUEST = "http_request" as const;
export const GRAPH_NODE_TYPE_RAG_QUERY = "rag_query" as const;
export const GRAPH_NODE_TYPE_DELAY = "delay" as const;
export const GRAPH_NODE_TYPE_DEBOUNCE = "debounce" as const;
export const GRAPH_NODE_TYPE_WAIT_FOR = "wait_for" as const;
export const GRAPH_NODE_TYPE_SET_VARIABLE = "set_variable" as const;
export const GRAPH_NODE_TYPE_PYTHON_CODE = "python_code" as const;
export const GRAPH_NODE_TYPE_LLM_AGENT = "llm_agent" as const;

export function isGraphDocumentFrameType(type: string): boolean {
  return type === GRAPH_NODE_TYPE_COMMENT || type === GRAPH_NODE_TYPE_GROUP;
}

/** React Flow custom types for sticky / group frames. */
export function isReactFlowFrameNodeType(type: string | undefined): boolean {
  return type === "gcComment" || type === "gcGroup";
}
