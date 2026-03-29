// Copyright GraphCaster. All Rights Reserved.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct StdoutRunTrack {
    saw_run_finished: bool,
    root_graph_id: Option<String>,
}

fn json_run_id_matches(v: &serde_json::Value, expected: &str) -> bool {
    match v.get("runId") {
        Some(serde_json::Value::String(s)) => s == expected,
        Some(serde_json::Value::Number(n)) => n.to_string() == expected,
        _ => false,
    }
}

fn json_run_finished_is_terminal_ok(v: &serde_json::Value) -> bool {
    v.get("type") == Some(&json!("run_finished"))
        && v
            .get("status")
            .and_then(|x| x.as_str())
            .map(|s| {
                matches!(
                    s,
                    "success" | "failed" | "cancelled" | "partial"
                )
            })
            .unwrap_or(false)
}

#[derive(Default)]
pub struct RunSessionState {
    active: Arc<Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>>,
}

impl RunSessionState {
    pub fn kill_all(&self) {
        let map = match self.active.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        for (_id, entry) in map.iter() {
            if let Ok(mut g) = entry.lock() {
                if let Some(mut ch) = g.take() {
                    let _ = ch.kill();
                    let _ = ch.wait();
                }
            }
        }
    }
}

#[derive(Serialize)]
pub struct RunEnvInfo {
    pub python_path: String,
    pub module_available: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    pub document_json: String,
    pub run_id: String,
    pub graphs_dir: Option<String>,
    pub artifacts_base: Option<String>,
    /// When set: `python -m graph_caster run --until-node <id>` (debugger-style partial run).
    /// `id` is a node in the root document only; nested `graph_ref` subgraphs still run to completion.
    pub until_node_id: Option<String>,
    /// When set: `--context-json <path>` (pinned upstream `node_outputs`).
    pub context_json_path: Option<String>,
    /// When `Some(true)` and `artifacts_base` is non-empty after trim, host adds `--step-cache` (F17).
    pub step_cache: Option<bool>,
    /// Optional comma-separated node ids for `--step-cache-dirty` (n8n-style forced cache miss).
    pub step_cache_dirty: Option<String>,
    /// When true, adds `--no-persist-run-events` if `--artifacts-base` is set.
    pub no_persist_run_events: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRunRequest {
    pub run_id: String,
}

fn path_env_sep() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

fn resolve_python() -> String {
    std::env::var("GC_PYTHON").unwrap_or_else(|_| {
        if cfg!(windows) {
            "python".to_string()
        } else {
            "python3".to_string()
        }
    })
}

fn max_tauri_concurrent_runs() -> usize {
    let raw = std::env::var("GC_TAURI_MAX_RUNS").unwrap_or_default();
    let n: usize = raw.trim().parse().unwrap_or(2);
    n.clamp(1, 32)
}

fn normalize_graph_id_for_fs(gid: &str) -> Result<String, String> {
    let s = gid.trim();
    if s.is_empty() || s == "default" {
        return Err("graphId invalid".into());
    }
    if s.contains("..") || s.contains('/') || s.contains('\\') {
        return Err("graphId invalid".into());
    }
    Ok(s.to_string())
}

fn safe_run_dir_segment(name: &str) -> Result<String, String> {
    let s = name.trim();
    if s.is_empty() || s.contains("..") || s.contains('/') || s.contains('\\') {
        return Err("runDirName invalid".into());
    }
    Ok(s.to_string())
}

const MAX_PERSISTED_EVENTS_BYTES: u64 = 16 * 1024 * 1024;

fn resolve_file_under_runs(base_raw: &str, gid: &str, leaf: &str, file: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(base_raw.trim());
    if base.as_os_str().is_empty() {
        return Err("artifactsBase required".into());
    }
    let base_canon = fs::canonicalize(&base).map_err(|e| format!("artifactsBase: {e}"))?;
    let gid_s = normalize_graph_id_for_fs(gid)?;
    let leaf_s = safe_run_dir_segment(leaf)?;
    let runs_gid = base_canon.join("runs").join(&gid_s);
    let runs_gid_canon = match fs::canonicalize(&runs_gid) {
        Ok(p) => p,
        Err(_) => return Ok(runs_gid.join(&leaf_s).join(file)),
    };
    let target = runs_gid_canon.join(&leaf_s).join(file);
    if !target.is_file() {
        return Ok(target);
    }
    let tc = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !tc.starts_with(&runs_gid_canon) {
        return Err("invalid run path — escapes workspace".into());
    }
    Ok(tc)
}

fn unique_run_document_path(run_id: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "graph-caster-run-{}-{}-{}.json",
        run_id,
        std::process::id(),
        nanos
    ))
}

fn python_command_base(python: &str) -> Command {
    let mut c = Command::new(python);
    if let Ok(pp) = std::env::var("GC_GRAPH_CASTER_PACKAGE_ROOT") {
        let prev = std::env::var("PYTHONPATH").unwrap_or_default();
        let sep = path_env_sep();
        let merged = if prev.is_empty() {
            pp
        } else {
            format!("{pp}{sep}{prev}")
        };
        c.env("PYTHONPATH", merged);
    }
    c
}

#[tauri::command]
pub fn get_run_environment_info() -> RunEnvInfo {
    let python_path = resolve_python();
    let mut cmd = python_command_base(&python_path);
    cmd.arg("-c").arg("import graph_caster");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    let module_available = cmd.status().map(|s| s.success()).unwrap_or(false);
    RunEnvInfo {
        python_path,
        module_available,
    }
}

#[tauri::command]
pub fn gc_cancel_run(state: State<'_, RunSessionState>, req: CancelRunRequest) -> Result<(), String> {
    let rid = req.run_id.trim().to_string();
    if rid.is_empty() {
        return Err("runId required".into());
    }
    let map = state.active.lock().map_err(|_| "state poisoned")?;
    let entry = map
        .get(&rid)
        .ok_or_else(|| "no active run for this runId".to_string())?;
    let mut g = entry.lock().map_err(|_| "lock poisoned")?;
    let ch = g
        .as_mut()
        .ok_or_else(|| "process already finished".to_string())?;
    let stdin = ch
        .stdin
        .as_mut()
        .ok_or_else(|| "stdin unavailable".to_string())?;
    let line =
        serde_json::to_string(&serde_json::json!({ "type": "cancel_run", "runId": &rid }))
            .map_err(|e| e.to_string())?;
    writeln!(stdin, "{line}").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn gc_start_run(
    app: AppHandle,
    state: State<'_, RunSessionState>,
    request: StartRunRequest,
) -> Result<(), String> {
    let run_id = request.run_id.trim().to_string();
    if run_id.is_empty() {
        return Err("runId required".into());
    }

    let max_runs = max_tauri_concurrent_runs();
    {
        let map = state.active.lock().map_err(|_| "state poisoned")?;
        if map.contains_key(&run_id) {
            return Err("a run with this runId is already active".into());
        }
        if map.len() >= max_runs {
            return Err("max concurrent runs reached".into());
        }
    }

    let tmp = unique_run_document_path(&run_id);
    std::fs::write(&tmp, &request.document_json).map_err(|e| e.to_string())?;

    let python = resolve_python();
    let mut cmd = python_command_base(&python);
    cmd.arg("-m").arg("graph_caster");
    cmd.arg("run");
    cmd.arg("-d").arg(&tmp);
    cmd.arg("--track-session");
    cmd.arg("--control-stdin");
    cmd.arg("--run-id").arg(&run_id);
    if let Some(ref g) = request.graphs_dir {
        let s = g.trim();
        if !s.is_empty() {
            cmd.arg("-g").arg(s);
        }
    }
    let artifacts_arg: Option<String> = request.artifacts_base.as_ref().and_then(|a| {
        let t = a.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });
    if let Some(ref path) = artifacts_arg {
        cmd.arg("--artifacts-base").arg(path);
        if request.no_persist_run_events == Some(true) {
            cmd.arg("--no-persist-run-events");
        }
    }
    if request.step_cache == Some(true) && artifacts_arg.is_some() {
        cmd.arg("--step-cache");
        if let Some(ref d) = request.step_cache_dirty {
            let s = d.trim();
            if !s.is_empty() {
                cmd.arg("--step-cache-dirty").arg(s);
            }
        }
    }
    if let Some(ref u) = request.until_node_id {
        let s = u.trim();
        if !s.is_empty() {
            cmd.arg("--until-node").arg(s);
        }
    }
    if let Some(ref c) = request.context_json_path {
        let s = c.trim();
        if !s.is_empty() {
            cmd.arg("--context-json").arg(s);
        }
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("failed to start Python ({python}): {e}")
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr missing".to_string())?;

    let child_arc: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(Some(child)));
    let stdout_track: Arc<Mutex<StdoutRunTrack>> = Arc::new(Mutex::new(StdoutRunTrack::default()));
    {
        let mut map = state.active.lock().map_err(|_| "state poisoned")?;
        if map.len() >= max_runs {
            drop(map);
            if let Ok(mut g) = child_arc.lock() {
                if let Some(mut ch) = g.take() {
                    let _ = ch.kill();
                    let _ = ch.wait();
                }
            }
            let _ = std::fs::remove_file(&tmp);
            return Err("max concurrent runs reached".into());
        }
        if map.contains_key(&run_id) {
            drop(map);
            if let Ok(mut g) = child_arc.lock() {
                if let Some(mut ch) = g.take() {
                    let _ = ch.kill();
                    let _ = ch.wait();
                }
            }
            let _ = std::fs::remove_file(&tmp);
            return Err("a run with this runId is already active".into());
        }
        map.insert(run_id.clone(), Arc::clone(&child_arc));
    }

    let app_out = app.clone();
    let rid_out = run_id.clone();
    let track_out = Arc::clone(&stdout_track);
    let stdout_thread: JoinHandle<()> = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim_start();
            if trimmed.starts_with('{') {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let mut g = track_out
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if json_run_id_matches(&v, rid_out.as_str()) {
                        if v.get("type") == Some(&json!("run_started")) {
                            if let Some(s) = v.get("rootGraphId").and_then(|x| x.as_str()) {
                                g.root_graph_id = Some(s.to_string());
                            }
                        }
                        if json_run_finished_is_terminal_ok(&v) {
                            g.saw_run_finished = true;
                        }
                    }
                }
            }
            let _ = app_out.emit(
                "gc-run-event",
                json!({
                    "runId": rid_out,
                    "line": line,
                    "stream": "stdout",
                }),
            );
        }
    });

    let app_err = app.clone();
    let rid_err = run_id.clone();
    let stderr_thread: JoinHandle<()> = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_err.emit(
                "gc-run-event",
                serde_json::json!({
                    "runId": rid_err,
                    "line": line,
                    "stream": "stderr",
                }),
            );
        }
    });

    let app_exit = app.clone();
    let rid_exit = run_id.clone();
    let active = Arc::clone(&state.active);
    let track_exit = Arc::clone(&stdout_track);
    thread::spawn(move || {
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        let code = {
            let mut guard = child_arc
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(mut ch) = guard.take() {
                ch.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1)
            } else {
                -1
            }
        };
        let t = track_exit
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let synth_line: Option<String> = if t.saw_run_finished {
            None
        } else {
            let gid = t
                .root_graph_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            Some(
                json!({
                    "type": "run_finished",
                    "runId": rid_exit,
                    "rootGraphId": gid,
                    "status": "failed",
                    "finishedAt": chrono::Utc::now().to_rfc3339_opts(
                        chrono::SecondsFormat::Millis,
                        false,
                    ),
                    "reason": "coordinator_worker_lost",
                    "coordinatorWorkerLost": true,
                    "workerProcessExitCode": code,
                })
                .to_string(),
            )
        };
        if let Some(line) = synth_line {
            let _ = app_exit.emit(
                "gc-run-event",
                json!({
                    "runId": rid_exit,
                    "line": line,
                    "stream": "stdout",
                }),
            );
        }
        let _ = app_exit.emit(
            "gc-run-exit",
            json!({ "runId": rid_exit, "code": code }),
        );
        let _ = std::fs::remove_file(&tmp);
        if let Ok(mut m) = active.lock() {
            m.remove(&rid_exit);
        }
    });

    Ok(())
}

pub fn kill_all_on_app_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<RunSessionState>() {
        state.kill_all();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPersistedRunsRequest {
    pub artifacts_base: String,
    pub graph_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRunListItem {
    pub run_dir_name: String,
    pub has_events: bool,
    pub has_summary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEventsReadResult {
    pub text: String,
    pub truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadPersistedTextRequest {
    pub artifacts_base: String,
    pub graph_id: String,
    pub run_dir_name: String,
    #[serde(default = "default_max_bytes")]
    pub max_bytes: u64,
}

fn default_max_bytes() -> u64 {
    1_000_000
}

fn default_catalog_limit() -> i64 {
    500
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRunCatalogRequest {
    pub artifacts_base: String,
    #[serde(default)]
    pub graph_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default = "default_catalog_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCatalogRow {
    pub run_id: String,
    pub root_graph_id: String,
    pub run_dir_name: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: String,
    pub artifact_rel_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildRunCatalogRequest {
    pub artifacts_base: String,
}

#[tauri::command]
pub fn gc_list_persisted_runs(req: ListPersistedRunsRequest) -> Result<Vec<PersistedRunListItem>, String> {
    let base = PathBuf::from(req.artifacts_base.trim());
    if base.as_os_str().is_empty() {
        return Err("artifactsBase required".into());
    }
    let gid = normalize_graph_id_for_fs(&req.graph_id)?;
    let dir = base.join("runs").join(&gid);
    let rd = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };
    let mut names: Vec<String> = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            names.push(e.file_name().to_string_lossy().to_string());
        }
    }
    names.sort_by(|a, b| b.cmp(a));
    let mut out: Vec<PersistedRunListItem> = Vec::with_capacity(names.len());
    for n in names {
        let run_path = dir.join(&n);
        let has_events = run_path.join("events.ndjson").is_file();
        let has_summary = run_path.join("run-summary.json").is_file();
        out.push(PersistedRunListItem {
            run_dir_name: n,
            has_events,
            has_summary,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn gc_read_persisted_events(req: ReadPersistedTextRequest) -> Result<PersistedEventsReadResult, String> {
    let cap = (MAX_PERSISTED_EVENTS_BYTES.min(req.max_bytes)) as usize;
    let path = resolve_file_under_runs(
        &req.artifacts_base,
        &req.graph_id,
        &req.run_dir_name,
        "events.ndjson",
    )?;
    if !path.is_file() {
        return Ok(PersistedEventsReadResult {
            text: String::new(),
            truncated: false,
        });
    }
    let (text, truncated) = read_file_tail_utf8(&path, cap)?;
    Ok(PersistedEventsReadResult { text, truncated })
}

#[tauri::command]
pub fn gc_read_persisted_run_summary(req: ReadPersistedTextRequest) -> Result<Option<String>, String> {
    let path = resolve_file_under_runs(
        &req.artifacts_base,
        &req.graph_id,
        &req.run_dir_name,
        "run-summary.json",
    )?;
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

// SQLite layout must stay in sync with `python/graph_caster/run_catalog.py`:
// `_CATALOG_SCHEMA_VERSION`, table `runs` columns
// `run_id`, `root_graph_id`, `run_dir_name`, `status`, `started_at`, `finished_at`, `artifact_relpath`,
// and index order `ORDER BY finished_at DESC`. Bump the Python schema + migration before changing SQL here.
fn catalog_db_path(artifacts_base: &Path) -> PathBuf {
    artifacts_base.join(".graphcaster").join("runs_catalog.sqlite3")
}

fn map_catalog_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunCatalogRow> {
    Ok(RunCatalogRow {
        run_id: row.get(0)?,
        root_graph_id: row.get(1)?,
        run_dir_name: row.get(2)?,
        status: row.get(3)?,
        started_at: row.get(4)?,
        finished_at: row.get(5)?,
        artifact_rel_path: row.get::<_, String>(6)?.replace('\\', "/"),
    })
}

fn collect_catalog_rows<P: rusqlite::Params>(
    stmt: &mut rusqlite::Statement<'_>,
    params: P,
) -> Result<Vec<RunCatalogRow>, String> {
    let mut out = Vec::new();
    let rows = stmt.query_map(params, map_catalog_row).map_err(|e| e.to_string())?;
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn gc_list_run_catalog(req: ListRunCatalogRequest) -> Result<Vec<RunCatalogRow>, String> {
    let base = PathBuf::from(req.artifacts_base.trim());
    if base.as_os_str().is_empty() {
        return Err("artifactsBase required".into());
    }
    let db_path = catalog_db_path(&base);
    if !db_path.is_file() {
        return Ok(vec![]);
    }
    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open catalog db: {e}"))?;

    let mut lim = req.limit;
    if lim < 0 {
        lim = 0;
    }
    if lim > 10_000 {
        lim = 10_000;
    }
    let mut off = req.offset;
    if off < 0 {
        off = 0;
    }

    let graph_f: Option<String> = if let Some(ref s) = req.graph_id {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(normalize_graph_id_for_fs(t)?)
        }
    } else {
        None
    };

    let status_f: Option<String> = req
        .status
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let out: Vec<RunCatalogRow> = match (graph_f.as_ref(), status_f.as_ref()) {
        (Some(g), Some(s)) => {
            let mut stmt = conn
                .prepare(
                    "SELECT run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath \
                     FROM runs WHERE root_graph_id = ? AND status = ? ORDER BY finished_at DESC LIMIT ? OFFSET ?",
                )
                .map_err(|e| e.to_string())?;
            collect_catalog_rows(
                &mut stmt,
                rusqlite::params![g.as_str(), s.as_str(), lim, off],
            )?
        }
        (Some(g), None) => {
            let mut stmt = conn
                .prepare(
                    "SELECT run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath \
                     FROM runs WHERE root_graph_id = ? ORDER BY finished_at DESC LIMIT ? OFFSET ?",
                )
                .map_err(|e| e.to_string())?;
            collect_catalog_rows(&mut stmt, rusqlite::params![g.as_str(), lim, off])?
        }
        (None, Some(s)) => {
            let mut stmt = conn
                .prepare(
                    "SELECT run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath \
                     FROM runs WHERE status = ? ORDER BY finished_at DESC LIMIT ? OFFSET ?",
                )
                .map_err(|e| e.to_string())?;
            collect_catalog_rows(&mut stmt, rusqlite::params![s.as_str(), lim, off])?
        }
        (None, None) => {
            let mut stmt = conn
                .prepare(
                    "SELECT run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath \
                     FROM runs ORDER BY finished_at DESC LIMIT ? OFFSET ?",
                )
                .map_err(|e| e.to_string())?;
            collect_catalog_rows(&mut stmt, rusqlite::params![lim, off])?
        }
    };

    Ok(out)
}

/// Returns the decimal count printed by `graph_caster catalog-rebuild` (ASCII digits only).
/// String avoids JSON number precision loss for very large counts in the JS bridge.
#[tauri::command]
pub fn gc_rebuild_run_catalog(req: RebuildRunCatalogRequest) -> Result<String, String> {
    let ab = req.artifacts_base.trim();
    if ab.is_empty() {
        return Err("artifactsBase required".into());
    }
    let python = resolve_python();
    let mut cmd = python_command_base(&python);
    cmd.arg("-m").arg("graph_caster");
    cmd.arg("catalog-rebuild");
    cmd.arg("--artifacts-base").arg(ab);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let out = cmd.output().map_err(|e| format!("catalog-rebuild: failed to spawn {python}: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("catalog-rebuild failed: {stderr}"));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout.trim();
    if line.is_empty() || !line.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("catalog-rebuild: unexpected output: {line:?}"));
    }
    Ok(line.to_string())
}

fn read_file_tail_utf8(path: &Path, max_bytes: usize) -> Result<(String, bool), String> {
    if max_bytes == 0 {
        return Ok((String::new(), false));
    }
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len() as usize;
    if len <= max_bytes {
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        return Ok((s, false));
    }
    let skip = len - max_bytes;
    f.seek(SeekFrom::Start(skip as u64))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; max_bytes];
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    Ok((String::from_utf8_lossy(&buf).into_owned(), true))
}
