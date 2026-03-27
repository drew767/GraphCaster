# Test fixtures (GraphCaster)

Minimal `graph-document` JSON files for shared UI (Vitest) and Python (pytest) checks. **Handle compatibility (F18):** `handle-ok.json`, `handle-bad-start-out.json`, `handle-bad-exit-in.json` — loaded via `GraphDocument.from_dict` / `parseGraphDocumentJson`; invalid-handle files are structurally parseable but fail `validate_graph_structure` or `findHandleCompatibilityIssues`.
