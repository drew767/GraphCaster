# Copyright GraphCaster. All Rights Reserved.

"""Run-broker polling trigger daemon (F70).

Scans a graphs directory for JSON files containing ``trigger_poll`` nodes,
periodically fetches the configured URL/RSS feed/command, compares the result
to the previous state hash, and calls a broker client's ``start_run``
coroutine when the state changes.

Enable: set ``GC_RUN_BROKER_POLLER=on`` (or ``1`` / ``true`` / ``yes``).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from graph_caster.run_broker.watcher import TriggerEvent, WatcherRunner

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _poller_enabled() -> bool:
    v = (os.environ.get("GC_RUN_BROKER_POLLER") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

CompareMode = Literal["content-hash", "etag", "last-modified", "newest-item"]
PollKind = Literal["url", "rss", "command"]


@dataclass
class PollTrigger:
    """A single poll trigger derived from a trigger_poll node in a graph."""

    graph_id: str
    node_id: str
    kind: PollKind
    url: str | None
    command: str | None
    argv: list[str] | None
    interval_sec: float
    compare_mode: CompareMode
    headers: dict[str, str]
    timeout_sec: float
    state: dict[str, Any] = field(default_factory=dict)
    # {"last_hash": ..., "last_etag": ..., "newest_id": ..., "last_polled_at": ...}

    def to_dict(self) -> dict[str, Any]:
        return {
            "graphId": self.graph_id,
            "nodeId": self.node_id,
            "kind": self.kind,
            "url": self.url,
            "command": self.command,
            "argv": self.argv,
            "intervalSec": self.interval_sec,
            "compareMode": self.compare_mode,
            "headers": self.headers,
            "timeoutSec": self.timeout_sec,
            "lastPolledAt": self.state.get("last_polled_at"),
        }


# ---------------------------------------------------------------------------
# Graph document parsing
# ---------------------------------------------------------------------------

def _parse_trigger_poll_nodes(
    doc: dict[str, Any],
) -> list[PollTrigger]:
    """Return trigger_poll node specs from *doc*."""
    graph_id = (
        doc.get("graphId")
        or doc.get("graph_id")
        or doc.get("meta", {}).get("graphId")
        or ""
    )
    nodes = doc.get("nodes") or []
    results: list[PollTrigger] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "trigger_poll":
            continue
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        data = node.get("data") or {}

        kind_raw = str(data.get("kind") or "url").strip().lower()
        if kind_raw not in ("url", "rss", "command"):
            kind_raw = "url"
        kind: PollKind = kind_raw  # type: ignore[assignment]

        url = data.get("url") or None
        if url is not None:
            url = str(url).strip() or None

        command = data.get("command") or None
        if command is not None:
            command = str(command).strip() or None

        argv_raw = data.get("argv") or None
        argv: list[str] | None = None
        if argv_raw is not None and isinstance(argv_raw, list):
            argv = [str(a) for a in argv_raw]

        try:
            interval_sec = float(data.get("intervalSec", data.get("interval_sec", 60.0)))
        except (TypeError, ValueError):
            interval_sec = 60.0
        interval_sec = max(5.0, interval_sec)

        compare_mode_raw = str(
            data.get("compareMode", data.get("compare_mode", "content-hash"))
        ).strip()
        if compare_mode_raw not in ("content-hash", "etag", "last-modified", "newest-item"):
            compare_mode_raw = "content-hash"
        compare_mode: CompareMode = compare_mode_raw  # type: ignore[assignment]

        headers_raw = data.get("headers") or {}
        headers: dict[str, str] = {}
        if isinstance(headers_raw, dict):
            for k, v in headers_raw.items():
                headers[str(k)] = str(v)

        try:
            timeout_sec = float(data.get("timeoutSec", data.get("timeout_sec", 30.0)))
        except (TypeError, ValueError):
            timeout_sec = 30.0
        timeout_sec = max(1.0, timeout_sec)

        results.append(
            PollTrigger(
                graph_id=str(graph_id),
                node_id=node_id,
                kind=kind,
                url=url,
                command=command,
                argv=argv,
                interval_sec=interval_sec,
                compare_mode=compare_mode,
                headers=headers,
                timeout_sec=timeout_sec,
            )
        )
    return results


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------

def _state_path(state_dir: Path, graph_id: str, node_id: str) -> Path:
    safe = f"{graph_id}__{node_id}".replace("/", "_").replace("\\", "_")
    return state_dir / f"{safe}.json"


def _load_state(state_dir: Path, graph_id: str, node_id: str) -> dict[str, Any]:
    p = _state_path(state_dir, graph_id, node_id)
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return {}


def _save_state(state_dir: Path, graph_id: str, node_id: str, state: dict[str, Any]) -> None:
    p = _state_path(state_dir, graph_id, node_id)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(state), encoding="utf-8")
    except Exception as exc:
        logger.warning("Poller: cannot save state for %s/%s: %s", graph_id, node_id, exc)


# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------

class _Metrics:
    def __init__(self) -> None:
        self._triggers: int = 0
        self._fires: dict[tuple[str, str, str], int] = {}
        self._errors: dict[tuple[str, str, str], int] = {}

    def set_trigger_count(self, n: int) -> None:
        self._triggers = n

    def inc_fire(self, graph_id: str, node_id: str, kind: str) -> None:
        key = (graph_id, node_id, kind)
        self._fires[key] = self._fires.get(key, 0) + 1

    def inc_error(self, graph_id: str, node_id: str, reason: str) -> None:
        key = (graph_id, node_id, reason)
        self._errors[key] = self._errors.get(key, 0) + 1

    def prometheus_text(self) -> str:
        lines = [
            "# HELP gc_poller_triggers_total Number of poll triggers currently loaded.",
            "# TYPE gc_poller_triggers_total gauge",
            f"gc_poller_triggers_total {self._triggers}",
            "# HELP gc_poller_fires_total Total state-change fires per trigger.",
            "# TYPE gc_poller_fires_total counter",
        ]
        for (gid, nid, kind), cnt in sorted(self._fires.items()):
            lines.append(
                f'gc_poller_fires_total{{graphId="{gid}",nodeId="{nid}",kind="{kind}"}} {cnt}'
            )
        lines += [
            "# HELP gc_poller_errors_total Total per-trigger poll errors.",
            "# TYPE gc_poller_errors_total counter",
        ]
        for (gid, nid, reason), cnt in sorted(self._errors.items()):
            lines.append(
                f'gc_poller_errors_total{{graphId="{gid}",nodeId="{nid}",reason="{reason}"}} {cnt}'
            )
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# RSS helpers
# ---------------------------------------------------------------------------

_RSS_NS = {
    "atom": "http://www.w3.org/2005/Atom",
}


def _parse_rss_items(xml_bytes: bytes) -> list[dict[str, str]]:
    """Parse RSS/Atom XML and return list of item dicts with 'guid', 'link', 'title'."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"RSS XML parse error: {exc}") from exc

    items: list[dict[str, str]] = []

    # RSS 2.0: <rss><channel><item>
    for item in root.iter("item"):
        guid_el = item.find("guid")
        link_el = item.find("link")
        title_el = item.find("title")
        guid = (guid_el.text or "").strip() if guid_el is not None else ""
        link = (link_el.text or "").strip() if link_el is not None else ""
        title = (title_el.text or "").strip() if title_el is not None else ""
        identifier = guid or link
        items.append({"guid": identifier, "link": link, "title": title})

    # Atom: <feed><entry>
    if not items:
        for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
            id_el = entry.find("{http://www.w3.org/2005/Atom}id")
            link_el = entry.find("{http://www.w3.org/2005/Atom}link")
            title_el = entry.find("{http://www.w3.org/2005/Atom}title")
            guid = (id_el.text or "").strip() if id_el is not None else ""
            link = link_el.get("href", "") if link_el is not None else ""
            title = (title_el.text or "").strip() if title_el is not None else ""
            identifier = guid or link
            items.append({"guid": identifier, "link": link, "title": title})

    return items


def _newest_guid(items: list[dict[str, str]]) -> str | None:
    """Return the GUID of the first (newest) item, or None."""
    if items:
        return items[0]["guid"] or None
    return None


# ---------------------------------------------------------------------------
# Per-kind poll logic
# ---------------------------------------------------------------------------

async def _poll_url(
    trigger: PollTrigger,
    *,
    http_client: Any,
) -> tuple[bool, dict[str, Any]]:
    """Poll a URL trigger. Returns (changed, payload).

    Raises on connection/timeout errors; callers should catch and log.
    """
    import httpx

    url = trigger.url
    if not url:
        raise ValueError("trigger_poll kind=url requires url")

    request_headers = dict(trigger.headers)

    if trigger.compare_mode == "etag":
        last_etag = trigger.state.get("last_etag")
        if last_etag:
            request_headers["If-None-Match"] = last_etag
    elif trigger.compare_mode == "last-modified":
        last_mod = trigger.state.get("last_modified")
        if last_mod:
            request_headers["If-Modified-Since"] = last_mod

    try:
        response = await http_client.get(url, headers=request_headers, timeout=trigger.timeout_sec)
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"URL poll timeout: {exc}") from exc
    except httpx.RequestError as exc:
        raise OSError(f"URL poll error: {exc}") from exc

    status = response.status_code

    if trigger.compare_mode == "etag":
        if status == 304:
            return False, {}
        new_etag = response.headers.get("etag", "")
        old_etag = trigger.state.get("last_etag", "")
        if new_etag and new_etag == old_etag:
            return False, {}
        trigger.state["last_etag"] = new_etag
        body_bytes = response.content
        body_preview = body_bytes[:512].decode("utf-8", errors="replace")
        return True, {
            "kind": "url",
            "url": url,
            "status": status,
            "body_preview": body_preview,
            "headers": dict(response.headers),
        }

    elif trigger.compare_mode == "last-modified":
        if status == 304:
            return False, {}
        new_lm = response.headers.get("last-modified", "")
        old_lm = trigger.state.get("last_modified", "")
        if new_lm and new_lm == old_lm:
            return False, {}
        trigger.state["last_modified"] = new_lm
        body_bytes = response.content
        body_preview = body_bytes[:512].decode("utf-8", errors="replace")
        return True, {
            "kind": "url",
            "url": url,
            "status": status,
            "body_preview": body_preview,
            "headers": dict(response.headers),
        }

    else:
        # content-hash (default)
        body_bytes = response.content
        new_hash = hashlib.sha256(body_bytes).hexdigest()
        old_hash = trigger.state.get("last_hash", "")
        if new_hash == old_hash:
            return False, {}
        trigger.state["last_hash"] = new_hash
        body_preview = body_bytes[:512].decode("utf-8", errors="replace")
        return True, {
            "kind": "url",
            "url": url,
            "status": status,
            "body_preview": body_preview,
            "headers": dict(response.headers),
        }


async def _poll_rss(
    trigger: PollTrigger,
    *,
    http_client: Any,
) -> tuple[bool, dict[str, Any]]:
    """Poll an RSS/Atom feed. Returns (changed, payload).

    Detects new items by comparing newest GUID against stored state.
    """
    import httpx

    url = trigger.url
    if not url:
        raise ValueError("trigger_poll kind=rss requires url")

    try:
        response = await http_client.get(url, headers=trigger.headers, timeout=trigger.timeout_sec)
    except httpx.TimeoutException as exc:
        raise TimeoutError(f"RSS poll timeout: {exc}") from exc
    except httpx.RequestError as exc:
        raise OSError(f"RSS poll error: {exc}") from exc

    try:
        items = _parse_rss_items(response.content)
    except ValueError as exc:
        raise ValueError(f"RSS parse error: {exc}") from exc

    newest = _newest_guid(items)

    if trigger.compare_mode == "newest-item":
        old_newest = trigger.state.get("newest_id")
        if newest is None or newest == old_newest:
            return False, {}
        # Find new items: items before the old newest guid
        if old_newest is None:
            new_items = items
        else:
            new_items = []
            for item in items:
                if item["guid"] == old_newest:
                    break
                new_items.append(item)
        trigger.state["newest_id"] = newest
        return True, {
            "kind": "rss",
            "url": url,
            "new_items": new_items,
        }
    else:
        # content-hash fallback for rss
        new_hash = hashlib.sha256(response.content).hexdigest()
        old_hash = trigger.state.get("last_hash", "")
        if new_hash == old_hash:
            return False, {}
        trigger.state["last_hash"] = new_hash
        trigger.state["newest_id"] = newest
        return True, {
            "kind": "rss",
            "url": url,
            "new_items": items,
        }


async def _poll_command(
    trigger: PollTrigger,
    *,
    loop: asyncio.AbstractEventLoop | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Run a subprocess and hash its stdout. Returns (changed, payload)."""
    if trigger.argv:
        cmd_args = trigger.argv
    elif trigger.command:
        cmd_args = [trigger.command]
    else:
        raise ValueError("trigger_poll kind=command requires command or argv")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=trigger.timeout_sec
            )
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.communicate()
            raise TimeoutError(f"Command poll timeout: {exc}") from exc
    except (OSError, FileNotFoundError) as exc:
        raise OSError(f"Command spawn error: {exc}") from exc

    exit_code = proc.returncode or 0
    stdout_str = stdout.decode("utf-8", errors="replace") if stdout else ""
    stderr_str = stderr.decode("utf-8", errors="replace") if stderr else ""

    new_hash = hashlib.sha256((stdout or b"")).hexdigest()
    old_hash = trigger.state.get("last_hash", "")

    if new_hash == old_hash:
        return False, {}

    trigger.state["last_hash"] = new_hash
    return True, {
        "kind": "command",
        "stdout": stdout_str,
        "stderr": stderr_str,
        "exit_code": exit_code,
    }


# ---------------------------------------------------------------------------
# PollWatcher
# ---------------------------------------------------------------------------

class PollWatcher:
    """Polling trigger daemon.

    Scans ``graphs_dir`` for ``*.json`` graph files, finds nodes with
    ``type == "trigger_poll"``, and periodically polls each source.
    On state change: fires ``broker_client.start_run``.

    State is persisted to ``<state_dir>/poll-state/<graphId>__<nodeId>.json``
    across restarts.

    Args:
        graphs_dir: Directory containing graph JSON files.
        broker_client: Object exposing ``async start_run(graph_id, start_node_id,
            source, payload)`` coroutine.
        default_interval_sec: Fallback poll interval when a trigger does not
            specify ``intervalSec``.
        http_client: Optional httpx.AsyncClient (injectable for tests).
        state_base_dir: Base directory for state persistence.  Defaults to
            ``graphs_dir`` / ``../.graphcaster``.
        clock: Injectable wall-clock (``time.monotonic`` by default).
    """

    def __init__(
        self,
        graphs_dir: Path,
        broker_client: Any,
        *,
        default_interval_sec: float = 60.0,
        http_client: Any = None,
        state_base_dir: Path | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._graphs_dir = Path(graphs_dir)
        self._broker_client = broker_client
        self._default_interval_sec = default_interval_sec
        self._http_client_override = http_client
        self._clock: Callable[[], float] = clock or time.monotonic
        self._triggers: dict[str, PollTrigger] = {}
        self._next_poll: dict[str, float] = {}
        self._running = False
        self._dir_mtime: float = 0.0
        self._file_mtimes: dict[Path, float] = {}
        self._metrics = _Metrics()

        if state_base_dir is not None:
            self._state_dir = Path(state_base_dir) / "poll-state"
        else:
            self._state_dir = self._graphs_dir.parent / ".graphcaster" / "poll-state"

    @property
    def poll_interval_seconds(self) -> float:
        """Cooperative sleep between ticks — minimum across loaded triggers (>= 1.0s)."""
        if self._triggers:
            return max(1.0, min(t.interval_sec for t in self._triggers.values()))
        return 5.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_triggers(self) -> list[PollTrigger]:
        """Return a snapshot of currently loaded poll triggers."""
        return list(self._triggers.values())

    def prometheus_metrics_text(self) -> str:
        """Return Prometheus text exposition for poller metrics."""
        return self._metrics.prometheus_text()

    # ------------------------------------------------------------------
    # Graph scanning / reload
    # ------------------------------------------------------------------

    async def reload(self) -> None:
        """Re-scan graphs_dir for trigger_poll nodes."""
        import anyio

        new_triggers: dict[str, PollTrigger] = {}

        try:
            entries = list(self._graphs_dir.glob("*.json"))
        except OSError as exc:
            logger.warning("Poller: cannot list graphs_dir %s: %s", self._graphs_dir, exc)
            return

        for path in entries:
            try:
                raw = await anyio.to_thread.run_sync(path.read_text, "utf-8")
                doc = json.loads(raw)
            except Exception as exc:
                logger.warning("Poller: skip %s (parse error: %s)", path.name, exc)
                continue

            if not isinstance(doc, dict):
                continue

            try:
                node_specs = _parse_trigger_poll_nodes(doc)
            except Exception as exc:
                logger.warning("Poller: error extracting nodes from %s: %s", path.name, exc)
                continue

            for trigger in node_specs:
                if not trigger.graph_id:
                    logger.warning(
                        "Poller: graph in %s has no graphId, skipping node %s",
                        path.name,
                        trigger.node_id,
                    )
                    continue

                if trigger.kind in ("url", "rss") and not trigger.url:
                    logger.warning(
                        "Poller: trigger %s/%s kind=%s has no url, skipping",
                        trigger.graph_id,
                        trigger.node_id,
                        trigger.kind,
                    )
                    continue

                if trigger.kind == "command" and not trigger.command and not trigger.argv:
                    logger.warning(
                        "Poller: trigger %s/%s kind=command has no command/argv, skipping",
                        trigger.graph_id,
                        trigger.node_id,
                    )
                    continue

                key = f"{trigger.graph_id}::{trigger.node_id}"
                existing = self._triggers.get(key)
                if existing is not None:
                    # Preserve accumulated state across reload
                    trigger.state = existing.state
                else:
                    # Load persisted state from disk so we don't refire on restart
                    trigger.state = _load_state(self._state_dir, trigger.graph_id, trigger.node_id)
                    logger.debug(
                        "Poller: loaded trigger %s/%s kind=%s interval=%.1fs",
                        trigger.graph_id,
                        trigger.node_id,
                        trigger.kind,
                        trigger.interval_sec,
                    )

                new_triggers[key] = trigger

        added = set(new_triggers) - set(self._triggers)
        removed = set(self._triggers) - set(new_triggers)
        if added:
            logger.info("Poller: +%d triggers loaded: %s", len(added), ", ".join(sorted(added)))
        if removed:
            logger.info("Poller: -%d triggers removed: %s", len(removed), ", ".join(sorted(removed)))

        # Initialise next-poll times for new triggers (fire immediately on first run)
        now = self._clock()
        for key in added:
            self._next_poll[key] = now

        self._triggers = new_triggers
        self._metrics.set_trigger_count(len(self._triggers))

    async def _maybe_reload(self) -> None:
        """Reload if graphs_dir mtime or any graph file mtime changed."""
        try:
            dir_mtime = self._graphs_dir.stat().st_mtime
        except OSError:
            return
        if dir_mtime != self._dir_mtime:
            self._dir_mtime = dir_mtime
            await self.reload()
            return

        for path in self._graphs_dir.glob("*.json"):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if self._file_mtimes.get(path) != mtime:
                self._file_mtimes[path] = mtime
                await self.reload()
                return

    # ------------------------------------------------------------------
    # Per-trigger polling
    # ------------------------------------------------------------------

    async def _poll_one(self, key: str, trigger: PollTrigger) -> None:
        """Poll one trigger, fire if state changed."""
        import httpx

        now_wall = self._clock()
        if now_wall < self._next_poll.get(key, 0.0):
            return

        # Schedule next poll before the await so time spent polling doesn't shrink the interval
        self._next_poll[key] = now_wall + trigger.interval_sec

        trigger.state["last_polled_at"] = time.time()

        http_client = self._http_client_override

        try:
            if trigger.kind == "url":
                if http_client is None:
                    async with httpx.AsyncClient() as client:
                        changed, payload = await _poll_url(trigger, http_client=client)
                else:
                    changed, payload = await _poll_url(trigger, http_client=http_client)

            elif trigger.kind == "rss":
                if http_client is None:
                    async with httpx.AsyncClient() as client:
                        changed, payload = await _poll_rss(trigger, http_client=client)
                else:
                    changed, payload = await _poll_rss(trigger, http_client=http_client)

            else:  # command
                changed, payload = await _poll_command(trigger)

        except TimeoutError as exc:
            logger.error(
                "Poller: timeout polling %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            self._metrics.inc_error(trigger.graph_id, trigger.node_id, "timeout")
            return
        except (OSError, ConnectionError) as exc:
            logger.error(
                "Poller: HTTP/command error polling %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            self._metrics.inc_error(trigger.graph_id, trigger.node_id, "http")
            return
        except ValueError as exc:
            logger.error(
                "Poller: parse error polling %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            self._metrics.inc_error(trigger.graph_id, trigger.node_id, "parse")
            return
        except Exception as exc:
            logger.error(
                "Poller: unexpected error polling %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            self._metrics.inc_error(trigger.graph_id, trigger.node_id, "http")
            return

        _save_state(self._state_dir, trigger.graph_id, trigger.node_id, trigger.state)

        if not changed:
            return

        logger.info(
            "Poller: state changed for %s/%s kind=%s — firing run",
            trigger.graph_id,
            trigger.node_id,
            trigger.kind,
        )

        try:
            await self._broker_client.start_run(
                graph_id=trigger.graph_id,
                start_node_id=trigger.node_id,
                source="poll",
                payload=payload,
            )
            self._metrics.inc_fire(trigger.graph_id, trigger.node_id, trigger.kind)
        except Exception as exc:
            logger.error(
                "Poller: start_run failed for %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            self._metrics.inc_error(trigger.graph_id, trigger.node_id, "http")

    async def _poll_all(self) -> None:
        """Poll every due trigger once."""
        for key, trigger in list(self._triggers.items()):
            try:
                await self._poll_one(key, trigger)
            except Exception as exc:
                logger.error(
                    "Poller: unexpected error in poll loop for %s/%s: %s",
                    trigger.graph_id,
                    trigger.node_id,
                    exc,
                )
                self._metrics.inc_error(trigger.graph_id, trigger.node_id, "http")

    # ------------------------------------------------------------------
    # Watcher protocol + run wrapper
    # ------------------------------------------------------------------

    async def tick(self) -> list[TriggerEvent]:
        """Watcher protocol: poll all triggers + reload-if-changed; events fire inline."""
        await self._poll_all()
        await self._maybe_reload()
        return []

    async def run(self) -> None:
        """Thin wrapper: drive self via shared WatcherRunner."""
        if not _poller_enabled():
            logger.info("Poller: disabled (set GC_RUN_BROKER_POLLER=on to enable).")
            return

        async def _noop(_ev: TriggerEvent) -> None:
            return

        self._runner = WatcherRunner(dispatch=_noop)
        self._running = True
        logger.info("Poller: starting, graphs_dir=%s", self._graphs_dir)
        try:
            await self._runner.run(self)
        finally:
            self._running = False
            logger.info("Poller: stopped.")

    def stop(self) -> None:
        """Signal the run loop to stop after the current tick."""
        self._running = False
        runner = getattr(self, "_runner", None)
        if runner is not None:
            runner.stop()
