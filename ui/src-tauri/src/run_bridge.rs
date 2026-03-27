// Copyright GraphCaster. All Rights Reserved.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter, Manager, State};

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

    {
        let map = state.active.lock().map_err(|_| "state poisoned")?;
        if map.contains_key(&run_id) {
            return Err("a run with this runId is already active".into());
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
    {
        let mut map = state.active.lock().map_err(|_| "state poisoned")?;
        map.insert(run_id.clone(), Arc::clone(&child_arc));
    }

    let app_out = app.clone();
    let rid_out = run_id.clone();
    let stdout_thread: JoinHandle<()> = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_out.emit(
                "gc-run-event",
                serde_json::json!({
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
    thread::spawn(move || {
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        let code = match child_arc.lock() {
            Ok(mut guard) => {
                if let Some(mut ch) = guard.take() {
                    ch.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1)
                } else {
                    -1
                }
            }
            Err(_) => -1,
        };
        let _ = app_exit.emit(
            "gc-run-exit",
            serde_json::json!({ "runId": rid_exit, "code": code }),
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
