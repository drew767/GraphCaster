# Copyright GraphCaster. All Rights Reserved.

"""
Build argv and cwd for the Cursor Agent CLI preset on ``task`` nodes (``data.gcCursorAgent``).

CLI reference (verified via ``agent --help`` on Cursor Agent CLI, 2026-03):
  Headless / scripting: ``-p`` / ``--print`` (non-interactive; pairs with ``--output-format``).
  File / tool side effects: ``-f`` / ``--force`` or ``--yolo`` (alias for force).
  Model: ``--model <id>``; output: ``--output-format text|json|stream-json`` (with ``--print``).
  Workspace directory: subprocess ``cwd`` (GraphCaster); CLI also documents ``--workspace <path>``.

Success: rely on process exit code (``successMode`` / ``successExitCodes`` on the ``task`` node).

Resolution order for the executable:
  1. Environment variable ``GC_CURSOR_AGENT`` (full path to binary or ``agent.cmd`` on Windows).
  2. ``shutil.which("agent")`` on PATH.
  3. Windows fallback: ``%LOCALAPPDATA%\\cursor-agent\\agent.cmd`` if that path exists.

Secrets (API keys) must not appear in the graph JSON; use host environment (e.g. ``CURSOR_API_KEY``)
as documented by Cursor.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

# {{out:<nodeId>.processResult.stdout}} or .stderr — nodeId: alphanumeric, hyphen, underscore
_PLACEHOLDER_RE = re.compile(
    r"\{\{out:([a-zA-Z0-9_-]+)\.processResult\.(stdout|stderr)\}\}"
)
# Stored on processResult.stdout/stderr and default cap for placeholder expansion (keep in sync).
MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN = 8192


class CursorAgentPresetError(Exception):
    """Invalid gcCursorAgent configuration or missing CLI executable."""


def resolve_workspace_root_from_graphs_root(graphs_root: Path | None) -> Path | None:
    """
    Heuristic: if the graphs directory is named ``graphs``, parent is the workspace root;
    otherwise treat ``graphs_root`` itself as the workspace root.
    """
    if graphs_root is None:
        return None
    gr = Path(graphs_root).resolve()
    if gr.name.lower() == "graphs":
        return gr.parent
    return gr


def _path_from_ctx(ctx: dict[str, Any], key: str) -> Path | None:
    raw = ctx.get(key)
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return Path(str(raw)).resolve()
    except OSError:
        return None


def resolve_cwd_base(
    cwd_base: str,
    *,
    graphs_root: Path | None,
    artifact_dir: Path | None,
) -> Path:
    """Resolve the base path for ``cwdBase`` enum."""
    mode = (cwd_base or "workspace_root").strip().lower().replace("-", "_")
    if mode in {"workspace", "workspace_root"}:
        wr = resolve_workspace_root_from_graphs_root(graphs_root)
        if wr is not None:
            return wr
        if graphs_root is not None:
            return Path(graphs_root).resolve()
        return Path.cwd().resolve()
    if mode in {"graphs", "graphs_root"}:
        if graphs_root is not None:
            return Path(graphs_root).resolve()
        return Path.cwd().resolve()
    if mode in {"artifact", "artifact_dir", "artifacts"}:
        if artifact_dir is not None:
            return Path(artifact_dir).resolve()
        return Path.cwd().resolve()
    raise CursorAgentPresetError(f"gcCursorAgent.cwdBase: unknown value {cwd_base!r}")


def _safe_resolve_under(base: Path, rel: str) -> Path:
    rel = rel.strip().replace("\\", "/")
    if rel == "" or rel.startswith("/"):
        raise CursorAgentPresetError("promptFile must be a non-empty relative path")
    parts = Path(rel).parts
    if ".." in parts:
        raise CursorAgentPresetError("promptFile must not contain '..'")
    out = (base / rel).resolve()
    try:
        out.relative_to(base.resolve())
    except ValueError as e:
        raise CursorAgentPresetError("promptFile escapes cwd base") from e
    return out


def expand_prompt_placeholders(
    prompt: str,
    node_outputs: dict[str, Any] | None,
    *,
    max_value_len: int = MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN,
) -> str:
    """Replace ``{{out:<id>.processResult.stdout|stderr}}`` with truncated text."""

    def repl(m: re.Match[str]) -> str:
        nid = m.group(1)
        stream = m.group(2)
        outs = node_outputs or {}
        entry = outs.get(nid)
        if not isinstance(entry, dict):
            return ""
        pr = entry.get("processResult")
        if not isinstance(pr, dict):
            return ""
        raw = pr.get(stream)
        if raw is None:
            return ""
        s = str(raw)
        if len(s) > max_value_len:
            return s[: max_value_len - 3] + "..."
        return s

    return _PLACEHOLDER_RE.sub(repl, prompt)


def resolve_agent_executable() -> Path:
    override = os.environ.get("GC_CURSOR_AGENT")
    if override and str(override).strip():
        p = Path(str(override).strip())
        if p.is_file():
            return p.resolve()
        raise CursorAgentPresetError(
            f"GC_CURSOR_AGENT points to missing file: {p}",
        )

    import shutil

    found = shutil.which("agent")
    if found:
        return Path(found).resolve()

    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidate = Path(local) / "cursor-agent" / "agent.cmd"
            if candidate.is_file():
                return candidate.resolve()

    raise CursorAgentPresetError(
        "Cursor Agent CLI not found. Install `agent`, set PATH, or set GC_CURSOR_AGENT "
        "to the full path (on Windows often %LOCALAPPDATA%\\cursor-agent\\agent.cmd).",
    )


def validate_gc_cursor_agent_errors(data: dict[str, Any]) -> list[str]:
    """Return human-readable validation errors; empty means OK for preset fields."""
    raw = data.get("gcCursorAgent")
    if raw is None:
        return []
    if not isinstance(raw, dict):
        return ["gcCursorAgent must be an object"]
    gca: dict[str, Any] = raw
    ver = gca.get("presetVersion", 1)
    try:
        vi = int(ver)
    except (TypeError, ValueError):
        return ["gcCursorAgent.presetVersion must be an integer"]
    if vi != 1:
        return [f"gcCursorAgent.presetVersion {vi} is not supported (only 1)"]

    prompt = gca.get("prompt")
    pfile = gca.get("promptFile")
    p_ok = isinstance(prompt, str) and prompt.strip() != ""
    f_ok = isinstance(pfile, str) and pfile.strip() != ""
    if not p_ok and not f_ok:
        return ["gcCursorAgent: set non-empty prompt or promptFile"]

    cwd_b = gca.get("cwdBase", "workspace_root")
    if not isinstance(cwd_b, str) or not cwd_b.strip():
        return ["gcCursorAgent.cwdBase must be a non-empty string"]

    ex = gca.get("extraArgs")
    if ex is not None and not isinstance(ex, list):
        return ["gcCursorAgent.extraArgs must be an array of strings"]
    if isinstance(ex, list):
        for i, a in enumerate(ex):
            if not isinstance(a, (str, int, float, bool)):
                return [f"gcCursorAgent.extraArgs[{i}] must be a string or number"]
    model = gca.get("model")
    if model is not None and not isinstance(model, str):
        return ["gcCursorAgent.model must be a string"]
    of = gca.get("outputFormat")
    if of is not None and not isinstance(of, str):
        return ["gcCursorAgent.outputFormat must be a string"]
    return []


def _truthy(v: Any, default: bool) -> bool:
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    s = str(v).strip().lower()
    if s in {"1", "true", "yes", "on"}:
        return True
    if s in {"0", "false", "no", "off", ""}:
        return False
    return default


def build_argv_and_cwd_for_gc_cursor_agent(data: dict[str, Any], ctx: dict[str, Any]) -> tuple[list[str], Path]:
    """
    Build ``argv`` for subprocess and working directory for the Cursor Agent preset.

    ``ctx`` may contain:
      - ``_gc_graphs_root``: str path (injected by GraphRunner)
      - ``root_run_artifact_dir``: str path
      - ``node_outputs``: dict for placeholder expansion
    """
    gca = data.get("gcCursorAgent")
    if not isinstance(gca, dict):
        raise CursorAgentPresetError("gcCursorAgent missing")

    graphs_root = _path_from_ctx(ctx, "_gc_graphs_root")
    artifact_dir = _path_from_ctx(ctx, "root_run_artifact_dir")

    cwd_base_name = str(gca.get("cwdBase") or "workspace_root")
    cwd_base_path = resolve_cwd_base(
        cwd_base_name,
        graphs_root=graphs_root,
        artifact_dir=artifact_dir,
    )
    rel = gca.get("cwdRelative")
    if isinstance(rel, str) and rel.strip():
        cwd = _safe_resolve_under(cwd_base_path, rel)
    else:
        cwd = cwd_base_path

    prompt_inline = gca.get("prompt")
    prompt_file = gca.get("promptFile")
    text = ""
    if isinstance(prompt_inline, str) and prompt_inline.strip():
        text = prompt_inline
    elif isinstance(prompt_file, str) and prompt_file.strip():
        pth = _safe_resolve_under(cwd_base_path, prompt_file.strip())
        try:
            text = pth.read_text(encoding="utf-8")
        except OSError as e:
            raise CursorAgentPresetError(f"cannot read promptFile: {e}") from e
    else:
        raise CursorAgentPresetError("gcCursorAgent: empty prompt and promptFile")

    node_outputs = ctx.get("node_outputs")
    if not isinstance(node_outputs, dict):
        node_outputs = {}
    text = expand_prompt_placeholders(text, node_outputs)

    exe = resolve_agent_executable()
    argv: list[str] = [str(exe)]

    if _truthy(gca.get("printMode"), True):
        argv.append("-p")
    if _truthy(gca.get("applyFileChanges"), False):
        argv.append("--force")

    model = gca.get("model")
    if isinstance(model, str) and model.strip():
        argv.extend(["--model", model.strip()])

    output_format = gca.get("outputFormat")
    if isinstance(output_format, str) and output_format.strip():
        argv.extend(["--output-format", output_format.strip()])

    extra = gca.get("extraArgs")
    if isinstance(extra, list):
        for a in extra:
            argv.append(str(a))

    argv.append(text)
    return argv, cwd


