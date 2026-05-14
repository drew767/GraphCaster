// Copyright GraphCaster. All Rights Reserved.

/**
 * Static node catalog for the search palette (Ctrl+K / period).
 * If a backend endpoint `GET /api/v1/nodes/catalog` exists, it would be
 * fetched here; for now the catalog is assembled from the schema enum.
 */

export type NodeCatalogEntry = {
  type: string;
  displayName: string;
  category: string;
  description: string;
};

export const NODE_CATALOG: readonly NodeCatalogEntry[] = [
  { type: "start", displayName: "Start", category: "flow", description: "Entry point: execution begins here." },
  { type: "exit", displayName: "Exit", category: "flow", description: "Graceful end node." },
  { type: "task", displayName: "Task", category: "steps", description: "Runs a shell command or script." },
  { type: "fork", displayName: "Fork", category: "flow", description: "Fans out to multiple unconditional branches." },
  { type: "merge", displayName: "Merge", category: "flow", description: "Joins branches (passthrough or barrier)." },
  { type: "iteration", displayName: "Iteration", category: "steps", description: "Iterates over a list of items." },
  { type: "loop", displayName: "Loop", category: "steps", description: "Loops while a condition holds." },
  { type: "llm_agent", displayName: "LLM Agent", category: "steps", description: "Runs a subprocess LLM agent." },
  { type: "agent", displayName: "Agent (in-process)", category: "steps", description: "In-process LLM tool loop." },
  { type: "ai_route", displayName: "AI Route", category: "steps", description: "Branches based on an LLM choice." },
  { type: "mcp_tool", displayName: "MCP Tool", category: "steps", description: "Calls a Model Context Protocol server tool." },
  { type: "composio_action", displayName: "Composio Action", category: "steps", description: "Runs a Composio action." },
  { type: "builtin_tool", displayName: "Builtin Tool", category: "steps", description: "Executes a built-in tool." },
  { type: "openapi_tool", displayName: "OpenAPI Tool", category: "steps", description: "Calls an OpenAPI-described endpoint." },
  { type: "prompt_concat", displayName: "Prompt Concat", category: "steps", description: "Concatenates prompt parts." },
  { type: "api_call", displayName: "API Call", category: "steps", description: "Generic HTTP API call." },
  { type: "trigger_webhook", displayName: "Webhook Trigger", category: "flow", description: "HTTP-in entry point." },
  { type: "trigger_schedule", displayName: "Schedule Trigger", category: "flow", description: "Cron-style entry point." },
  { type: "trigger_filesystem", displayName: "Filesystem Trigger", category: "flow", description: "Reacts to filesystem changes." },
  { type: "trigger_poll", displayName: "Poll Trigger", category: "flow", description: "Polls an endpoint on an interval." },
  { type: "reroute", displayName: "Reroute", category: "flow", description: "Passes connections cleanly (wire junction)." },
  { type: "comment", displayName: "Comment Frame", category: "notes", description: "Editor-only sticky note frame." },
  { type: "group", displayName: "Group Frame", category: "notes", description: "Editor-only group frame for organizing nodes." },
  { type: "http_request", displayName: "HTTP Request", category: "steps", description: "Performs an HTTP request in-process." },
  { type: "rag_query", displayName: "RAG Query", category: "steps", description: "Calls an external vector or RAG HTTP API." },
  { type: "rag_index", displayName: "RAG Index", category: "steps", description: "Indexes text chunks into an in-memory collection." },
  { type: "delay", displayName: "Delay", category: "steps", description: "Pauses the run for a fixed duration." },
  { type: "debounce", displayName: "Debounce", category: "steps", description: "Same as delay with distinct wait kind." },
  { type: "wait_for", displayName: "Wait For", category: "steps", description: "Waits until a file exists or timeout." },
  { type: "set_variable", displayName: "Set Variable", category: "steps", description: "Updates the run variable pool." },
  { type: "python_code", displayName: "Python Code", category: "steps", description: "Runs Python in an isolated child process." },
  { type: "graph_ref", displayName: "Nested Graph", category: "nested", description: "Runs another graph file as a nested workflow." },
];

/** Score a catalog entry against a query string. Returns 0 if no match. */
export function scoreCatalogEntry(entry: NodeCatalogEntry, query: string): number {
  if (query === "") {
    return 1;
  }
  const q = query.toLowerCase();
  const typeStr = entry.type.toLowerCase();
  const nameStr = entry.displayName.toLowerCase();
  const descStr = entry.description.toLowerCase();
  const catStr = entry.category.toLowerCase();

  if (typeStr === q || nameStr === q) {
    return 100;
  }
  if (typeStr.startsWith(q) || nameStr.startsWith(q)) {
    return 80;
  }
  if (typeStr.includes(q) || nameStr.includes(q)) {
    return 60;
  }
  if (descStr.includes(q) || catStr.includes(q)) {
    return 30;
  }
  const words = q.split(/\s+/);
  if (words.length > 1) {
    const combined = `${typeStr} ${nameStr} ${descStr}`;
    if (words.every((w) => combined.includes(w))) {
      return 20;
    }
  }
  return 0;
}

export function filterCatalog(catalog: readonly NodeCatalogEntry[], query: string): NodeCatalogEntry[] {
  const q = query.trim();
  if (q === "") {
    return [...catalog];
  }
  return catalog
    .map((entry) => ({ entry, score: scoreCatalogEntry(entry, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
