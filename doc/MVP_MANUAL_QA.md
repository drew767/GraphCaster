<!-- Copyright GraphCaster. All Rights Reserved. -->

# GraphCaster MVP — manual QA checklist

Run before a release tag or when touching run/UI core paths. Automated checks: **`.github/workflows/ci.yml`** (`pytest`, `npm test`, `npm run build`).

## Editor & workspace

- [ ] App starts (web **`npm run dev:web`** and/or desktop **`npm run dev`** as applicable).
- [ ] Create graph, add nodes (palette / context menu), connect edges; save loads back unchanged.
- [ ] Undo / redo; multi-select; copy/paste nodes; search focuses node.
- [ ] Onboarding tips show once; F1 / View → keyboard shortcuts modal lists shortcuts.
- [ ] Inspector shows node type description; toasts on save / run started (where implemented).

## Run & console

- [ ] **Run** completes for a trivial **task** (`echo` or `python -c`).
- [ ] **Stop** cancels a long-running step; no zombie UI state (run button usable again).
- [ ] Console shows NDJSON lines; filters and JSON highlighting readable.
- [ ] Persisted run list / replay (if using broker): stream reconnects after brief network glitch (dev).

## Errors

- [ ] Invalid **`gcCursorAgent`** schema (e.g. bad **`presetVersion`**) blocked before run with **GC2002** + hint; bare **task** / empty preset still fail during the step (historical behavior).
- [ ] Broker offline / wrong URL surfaces a clear network message (web mode).

## Cursor Agent (optional)

- [ ] Set **`GC_CURSOR_AGENT`** to your CLI; open **`examples/cursor-agent-linear.json`** (or fixture); run reaches **exit** or fails with clear agent error (not spawn/silent hang).

## Regression aura

- [ ] **`pytest -q`** (from **`python/`**) and **`npm test`** + **`npm run build`** (from **`ui/`**) pass locally.
