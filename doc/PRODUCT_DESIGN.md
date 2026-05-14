# GraphCaster — Product Design

**Mission:** Lightweight, embeddable workflow runtime for AI-augmented automation scenarios — desktop-first, plugin-friendly, production-grade observability from day one.

---

## 1. Product Positioning

GraphCaster sits between two established poles.

**ComfyUI** delivers a precise, caching-first DAG runtime for image generation. Its execution model is excellent, but it is single-user, has no REST API worth integrating against, and no deployment story beyond a local Python server.

**Dify** is a managed LLM Ops platform: five app modes, a plugin marketplace, RAG as a first-class primitive, draft/publish versioning, and native Langfuse observability. It is production-ready but requires Postgres, Redis, and Celery. It does not ship as an embeddable library.

GraphCaster targets the space between them: **a workflow runtime that a single developer can `pip install` and run from a terminal, an OEM can embed as a submodule inside a desktop product, and a small team can deploy without managing infrastructure beyond what they already have.** The runtime is the product; the UI is a first-class companion, not a hosted console.

Primary audiences:

- **Small teams** that need reliable automation across AI tools, scripts, and APIs without adopting a full SaaS platform.
- **OEMs and product engineers** embedding a workflow layer inside a desktop or server product (Tauri submodule, NPM embed package F51, or `pip install` as a library).
- **AI researchers and power users** who need programmatic control: headless CLI, MCP server export (F62, F65), step-caching across runs (F17, F43), and partial execution replay (F40, F48).

---

## 2. Differentiators vs. Competitors

**vs. n8n — UX parity reached (2026-05).** After the six-phase UX port (UX1–UX120), GraphCaster is visually and behaviourally indistinguishable from n8n for the core authoring workflow: the same six-zone chrome, identical token set, Node Detail View with expression editor and autocomplete, 40+ canvas hotkeys, conic-gradient running-border animation, and backward-edge bezier routing. n8n still leads on integration breadth (~300 managed nodes vs our plugin registry) and hosted cloud. GraphCaster retains durable advantages: Tauri desktop installer (n8n is web-only); JSONLogic + Mustache edge conditions (F3) vs n8n's If/Switch nodes; HMAC-SHA256 webhook auth with idempotency keys (F9); external secrets providers (Vault, AWS SM) without an Enterprise license (F8); OTel + Prometheus as a core primitive; LOD rendering for 1000+ nodes (n8n has no equivalent); schema-driven inspector (parameters generated from JSON Schema, not hardcoded); CRDT collaboration tighter than n8n's awareness-only push-connection; and `graph_ref` + nested trace hierarchy deeper than n8n's linear timeline.

**vs. Flowise** — Flowise's AgentflowV2 runtime (loop counters, conditional nodes, HITL) and 387-component LangChain catalog are ahead of our LLM coverage. GraphCaster leads on execution transparency: NDJSON event streams (F6), per-run artifact directories (F15), S3 upload (F28), and a clean schema/renderer separation. Flowise's 93 KB buildAgentflow.ts monolith and pervasive TypeScript `any` are the anti-patterns GraphCaster is designed to avoid. Post-UX-port, GraphCaster's canvas fidelity now also exceeds Flowise's React Flow UI.

**vs. Langflow** — Langflow's flow-to-MCP-tool export is the strongest in class today; any flow becomes a Claude Desktop tool via `langflow/agentic/mcp/server.py`. We have an MCP client (F12) and a stdio MCP server (F62) but not yet the exporter (F65). We beat Langflow on: native Tauri installer, a well-defined run event schema (F6), no `langflow`-vs-`lfx` split-module confusion, a single xyflow dependency versus Langflow's two parallel React Flow versions, and post-UX-port a significantly more polished canvas interaction model.

**vs. Dify** — Dify is the LLM Ops benchmark: five app runners, draft/publish versioning, Langfuse/LangSmith adapters, hybrid RAG with rerank and citation, and 5-role RBAC. GraphCaster does not compete at the enterprise tier today. We lead on runtime transparency (NDJSON, OTel spans per node, F13), secrets hygiene without tier gating (F8), and embeddability — Dify does not ship as a submodule or Python library.

**vs. ComfyUI** — ComfyUI's caching is best-in-class: input-signature hashing over ancestor outputs, HierarchicalCache for subgraphs, `IS_CHANGED` / `fingerprint_inputs` hooks, and RAM-pressure-aware eviction. Our step-cache (F17) is directionally similar but shallower; F43 will close the gap. The historical canvas UX gap has been closed by the UX port: group/bypass/mute/pin hotkeys (UX82), reroute nodes (via `RerouteNode.tsx`), and the full context menu catalog now match or exceed ComfyUI's canvas interactions. GraphCaster leads everywhere outside image generation: REST API (F10), webhook triggers (F9), secrets providers (F8), MCP client and server, and multi-tenancy path.

### Preserved GraphCaster-DNA (post-UX port)

The following capabilities were explicitly kept unchanged during the UX port and remain core differentiators:

| Capability | Detail |
|---|---|
| Tauri desktop + NSIS installer | Native window/file dialogs; offline-capable; Russian locale |
| Schema-driven inspector | Node parameters generated from JSON Schema; NDV inherits this |
| LOD rendering (3 tiers) | Full / compact / ghost at zoom thresholds; `useViewportCulling` |
| Async layout via Web Worker | `workers/layoutWorker.ts`; non-blocking for large graphs |
| CRDT collaboration (Yjs) | F77; document-level ops, not just awareness |
| Plugin node registry | `/api/v1/nodes`; `graphcaster.plugins` entry point group |
| `graph_ref` + nested trace | Hierarchical run tree deeper than n8n's linear execution timeline |
| PNG-embed export | F75; embed workflow JSON inside exported PNG for drag-drop re-import |
| Dual SSE/WS transport | Run broker supports both; multi-tenant Redis coordination optional |
| i18n: en + ru | Full locale coverage in both languages |

---

## 3. Canonical UX Flows

**Flow A — Blank canvas to save to run.** User opens GraphCaster desktop, adds a `start` node from the command palette, wires it to a `task` node (shell command), then to an `exit` node. The file autosaves to `graphs/<graphId>.json` on each change. Clicking Run emits `run_started`, `node_execute` per visited node, live `process_output` lines in the Console panel, and `run_finished`. Artifacts land in `runs/<graphId>/<runId>/events.ndjson` and `run-summary.json`.

**Flow B — Modify, run, diff.** User changes the `argv` of a task node; autosave writes the document and `graph_document_revision` (F38) recomputes. On the next Run, step-cache (F17) detects the SHA-256 key change, emits `node_cache_miss`, and re-executes only the changed node. Unchanged upstream nodes emit `node_cache_hit` and short-circuit. The Console identifies which nodes were replayed versus served from cache.

**Flow C — Webhook trigger.** User adds a `trigger_webhook` node, configures a path and HMAC secret. The broker registers `POST /webhook/<path>`. An external system sends a signed POST; the broker verifies `X-GC-Webhook-Signature` (F9), checks the idempotency key, and starts a run. The caller receives `202` with `runId` and can subscribe to `GET /runs/<runId>/stream` (SSE) or the WebSocket endpoint (F30) for live progress.

**Flow D — Pin output and replay from node.** During a run, user right-clicks a completed `llm_agent` node and selects "Pin output," writing the payload into `task.data.gcPin` (F72). On subsequent runs, `gcPin.enabled` causes the runner to emit `node_pinned_skip` and continue downstream without re-invoking the agent. To replay from a specific node, the user passes `--context-json` (F75) or triggers "Replay from here" in the UI (F48), merging pinned outputs into the run context.

**Flow E — Deploy graph as MCP tool for Claude Desktop.** User runs `python -m graph_caster mcp -g ./graphs` (F62). The stdio MCP server exposes `graphcaster_list_graphs` and `graphcaster_run_graph` tools; adding the process to Claude Desktop's MCP config makes graphs immediately callable by Claude. For HTTP deployment, the planned flow-to-MCP exporter (F65) derives the tool's input schema from the `start` node and output schema from the `exit` node.

---

## 4. Folder and Artifact Conventions

```
<workspace>/
  graphs/                          # Graph documents, one file per graph
    <graphId>.json
  runs/
    <graphId>/
      <runId>/
        events.ndjson              # All run events, one JSON per line
        run-summary.json           # Final status, duration, node counts
      step-cache/
        v1/
          <sha256>.json            # Per-node cached outputs (F17)
  .graphcaster/
    workspace.secrets.env          # Local secrets file for GC_SECRETS_PROVIDER=file (F8)
    knowledge/                     # Knowledge base datasets, planned (F56)
      <datasetId>/
    plugins/                       # Local plugin packages, planned (F92, F93)

~/.graphcaster/                    # User-level config and global plugin store
```

The `runs/` tree is the single source of truth for execution history. NDJSON files are append-only during a run; `run-summary.json` is written once at completion. S3 upload (F28) mirrors this tree to `s3://<bucket>/<prefix>/<graphId>/<runId>/` after the summary is written.

The `.graphcaster/workspace.secrets.env` file is never committed to version control. The runtime resolves secrets at execution time via the configured provider (file, Vault KV v2, or AWS Secrets Manager); the resolved values are fingerprinted for step-cache key computation (F8, F17) but never written to the run artifact directory.

---

## 5. Visual Design Principles

**Muted neutrals as the base.** The canvas background is near-black or near-white depending on theme; node chrome uses low-saturation grays. Color is reserved for state communication, not decoration.

**State colors are semantic and consistent:**

| State | Color signal |
|---|---|
| Running | Blue pulsing border / animated edge |
| Error | Red fill on node header |
| Cached (hit) | Green subtle glow |
| Done | Neutral, border returns to default |
| Muted | Desaturated, 40% opacity chrome |
| Bypassed | Dashed border, label suffix "(bypassed)" |
| Pinned | Amber accent on pin icon |
| Idle | Default chrome, no accent |

**Level of Detail (LOD) via zoom (F21, F31).** At full zoom, nodes show their full chrome: type badge, handle labels, condition inputs, status icon. Below the compact threshold, nodes collapse to a reduced representation: type icon plus label only, handles without labels, edges still routed. Off-viewport nodes are rendered as lightweight ghost tiles (F31) to maintain layout without DOM cost. LOD thresholds use hysteresis to prevent oscillation at boundary zoom levels.

**Sparse panels.** The Inspector panel opens only when a node or edge is selected; the Console panel is collapsed by default and expands on run start. No persistent sidebars occupy canvas space during authoring.

**Edge labels.** Condition expressions and `routeDescription` values (for `ai_route` edges) render as compact labels on edges. In compact LOD, labels are hidden to reduce visual noise.

---

## 6. Schema Philosophy

The graph document is a JSON file with a stable top-level contract: `schemaVersion`, `graphId`, `nodes`, `edges`, and `meta`. The `schemaVersion` field is an integer bumped on any breaking change; the loader emits a warning (not an error) on encountering unknown keys, which allows forward-compatible extensions without breaking existing runtimes.

Handle names are stable identifiers, not positional indices. `in_default` / `out_default` are the canonical names for single-input / single-output nodes; `out_error` is the reserved name for error branches. Alternative names (`source_handle` / `target_handle`) are supported by the Python loader for backward compatibility but are not the authoring convention.

Conditions are data, not code. Edge conditions are expressed as JSONLogic predicates or Mustache template strings referencing `$json` and `$node` (F3). This means conditions are serializable, diffable, and evaluable without an interpreter at schema load time. The expression evaluator enforces a 5-second timeout (F32) and operates on a safe AST without arbitrary `eval()` (F57, F58).

Node types are versioned via `typeVersion` (F47). When a node type evolves incompatibly, the old version handler is preserved in the registry alongside the new one. Existing graphs that reference `typeVersion: 1` continue to execute correctly after the runtime ships `typeVersion: 2`.

---

## 7. Runtime Philosophy

**Async-first.** The runner is built on anyio (F2, F7); all I/O is non-blocking. Parallelism within a run is via fork nodes (F7) and a `ThreadPoolExecutor` bounded by `GC_FORK_MAX_PARALLEL`. Default deployment is a single Python process — no required message broker, no required database.

**Opt-in Redis scaling.** When `GC_RUN_BROKER_REDIS_URL` is set, the broker acquires distributed locks (F26) for a global concurrent-run limit and uses the same connection for pub/sub relay (F42, F90). Redis is additive; the runtime functions correctly without it.

**Observability as substrate.** OTel spans (`gc.run`, `gc.node`) are emitted when `GC_OTEL_EXPORTER_OTLP_ENDPOINT` is configured (F13); Prometheus metrics at `GET /metrics` when the broker runs (F47). The NDJSON stream is written to disk, streamed to SSE/WS subscribers, and replayable offline. None of this is behind a tier gate.

**Pervasive caching.** Step-cache (F17) applies to `task`, `mcp_tool`, `llm_agent`, and `ai_route` nodes. The key is SHA-256 of canonical node data, document revision (F38), ancestor fingerprints, and secret fingerprints (F8). F43 will extend this to ComfyUI-style ancestry-hash caching. `--step-cache-dirty` marks specific nodes for re-execution without clearing the full cache.

**Sandboxed code execution and secret hygiene.** `code_node_worker.py` (F34) executes user Python in a subprocess with resource limits. `ai_route` (F20) masks authorization and cookie headers before external calls. Secrets are resolved per-run from the configured provider (F8), fingerprinted for cache keys, injected via `envKeys`, and never written to the NDJSON stream or artifact directory.

---

## 8. Plugin and Extension Model (Preview)

The plugin system (F92–F97) is designed around Python packages installed into the same environment as `graph_caster`. A plugin is discovered via the `graphcaster.plugins` entry point group. At startup, the plugin loader collects all registered entry points, calls each `declare()` function, and merges the provided nodes, tools, model providers, trigger handlers, and RAG sources into the runtime registry.

A minimal plugin manifest:

```python
from graph_caster.plugin.api import declare, GraphCasterNode, Input, Output

class ReverseTextNode(GraphCasterNode):
    type = "reverse_text"
    inputs = [Input("text", str, required=True)]
    outputs = [Output("result", str)]
    async def run(self, ctx, text: str) -> dict:
        return {"result": text[::-1]}

declare(nodes=[ReverseTextNode])
```

Plugins declare explicit permissions: `storage` (read/write workspace files), `tool` (invoke external HTTP), `model` (use LLM provider credentials), `network` (arbitrary outbound). Permission violations are caught at declaration time.

In development, `GC_DEV=1` activates hot-reload via watchdog on `~/.graphcaster/plugins/` and `./plugins/` (F93). Changes to plugin Python files trigger automatic re-import without restarting the broker.

Per-plugin locales follow ComfyUI's `locales/<lang>/nodeDefs.json` convention (F94). The broker aggregates all plugin locale files and serves them at `GET /api/v1/i18n/<lang>.json`.

The planned plugin registry (F97) will allow discovery via PyPI (prefix `graphcaster-plugin-`) and a GitHub manifest list, browseable from the Plugins page in the UI.

---

## 9. Non-Goals

- **Not Airflow-scale orchestration.** No per-task worker queues, no distributed job dispatch. The Redis coordination layer (F26) enforces global concurrency caps, nothing more.
- **Not a drag-and-drop end-user AI builder.** The canvas targets developers and technical users. No no-code form builder, no consumer-facing flow creation. The playground (planned) is a developer testing aid.
- **Not a managed SaaS.** No billing, no hosted control plane, no usage metering. Multi-tenant isolation (F91) and SSO hooks (F90) are planned for self-hosted deployments. The managed cloud broker (F102) is long-term roadmap, not a near-term commitment.
- **Not an ML training framework.** No training jobs, no GPU scheduling, no experiment tracking. The RAG pipeline (F33, F56–F62) is for inference-time retrieval only.
- **Not a chat front-end.** The playground panel triggers runs against a chat-shaped graph. It is not a conversation manager or end-user messaging interface.

---

## 10. Open Questions

1. **Single canvas vs. multi-canvas workspace.** The current model is one canvas per graph document. Should the UI support a tabbed multi-canvas view for working across graphs simultaneously, or is the graphs list panel sufficient? This affects autosave semantics and the collaboration model.

2. **Workflow-as-Code DSL.** Should GraphCaster support a text-based DSL (YAML or Python) as an alternative to the JSON graph document? This would enable version-controlled graph authoring in editors without the canvas. The risk is maintaining two authoring surfaces with equivalent semantics.

3. **Code node languages.** F34 implements a Python code node. Should JavaScript (via Node.js subprocess or isolated-vm) be a first-class code node language? Langflow uses Python-only with AST parsing; n8n supports both. The decision affects the sandbox strategy and the dependency surface.

4. **Embed widget isolation: shadow DOM vs. iframe.** The planned embed widget (F51) can be implemented as a shadow-DOM component (lighter, harder to style safely) or an iframe (heavier, full isolation). The shadow-DOM approach is closer to Flowise's `flowise-embed.js`; the iframe approach is closer to Dify's public chat embed. The choice affects theming, CSP headers, and the BFF contract.

5. **Plugin marketplace: PyPI prefix vs. GitHub manifest.** F97 proposes discovery via PyPI (`graphcaster-plugin-*`) and a GitHub manifest list. The GitHub manifest approach allows curation and metadata; the PyPI approach is lower friction but harder to curate. These are not mutually exclusive, but the primary registry needs to be chosen before building the Plugins UI.

6. **Versioned node types and schema migration.** F47 introduces `typeVersion` on nodes. When should `schemaVersion` (document-level) be bumped versus `typeVersion` (node-level)? A migration helper (F94) is planned but the policy for automatic migration versus explicit user action is not yet defined.

7. **Fork pool floor under load.** `GC_RUNNER_MIN_WORKERS` sets a minimum thread pool size (F46). Under sustained load with many fork nodes, the pool may grow to `GC_RUNNER_MAX_WORKERS`. The policy for shrinking the pool — time-based idle eviction versus request-count-based — is unresolved.

8. **CRDT collaboration and conflict with autosave.** Yjs CRDT (F84) and autosave (F16) operate on the same document. When a collaborative session is active, autosave should defer to the CRDT sync. The protocol for transitioning a document from offline autosave mode to collaborative mode (and back) when a second user joins needs to be specified before F84 implementation begins.
