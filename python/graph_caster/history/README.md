# Run history (Python)

SQLite catalog (`catalog.py`), NDJSON event reader (`events.py`), replay state reconstruction (`replay.py`), and a small artifact tree walker (`artifacts.py`) for listing files under a persisted run directory.

The desktop UI and dev broker read `events.ndjson` / `run-summary.json` through the Tauri bridge or HTTP; use `list_run_artifact_tree` from tools or tests when you need a full file listing under `runs/<graphId>/<runDir>/`.
