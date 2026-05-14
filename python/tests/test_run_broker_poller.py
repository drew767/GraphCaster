# Copyright GraphCaster. All Rights Reserved.

"""Tests for run_broker_poller (F70): URL, RSS, command polling triggers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Helpers: fake httpx client
# ---------------------------------------------------------------------------


@dataclass
class _FakeResponse:
    status_code: int
    _body: bytes = b""
    _headers: dict[str, str] = field(default_factory=dict)

    @property
    def content(self) -> bytes:
        return self._body

    @property
    def headers(self) -> dict[str, str]:
        return self._headers


class _FakeHttpxClient:
    """Synchronous-style fake that is awaitable for .get()."""

    def __init__(self, responses: list[_FakeResponse]) -> None:
        self._responses = list(responses)
        self._idx = 0
        self.requests: list[dict[str, Any]] = []

    async def get(self, url: str, *, headers: dict | None = None, timeout: float = 30) -> _FakeResponse:
        self.requests.append({"url": url, "headers": headers or {}})
        if self._idx < len(self._responses):
            resp = self._responses[self._idx]
            self._idx += 1
            return resp
        return self._responses[-1]

    async def __aenter__(self) -> "_FakeHttpxClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        pass


# ---------------------------------------------------------------------------
# Helpers: broker client spy
# ---------------------------------------------------------------------------

class _SpyBrokerClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def start_run(
        self,
        graph_id: str,
        start_node_id: str,
        source: str = "poll",
        payload: dict | None = None,
    ) -> None:
        self.calls.append(
            {
                "graph_id": graph_id,
                "start_node_id": start_node_id,
                "source": source,
                "payload": payload,
            }
        )


# ---------------------------------------------------------------------------
# Helpers: graph JSON builder
# ---------------------------------------------------------------------------

def _make_graph(graph_id: str, node_id: str, data: dict) -> dict:
    return {
        "schemaVersion": 1,
        "graphId": graph_id,
        "nodes": [
            {
                "id": node_id,
                "type": "trigger_poll",
                "position": {"x": 0, "y": 0},
                "data": data,
            }
        ],
        "edges": [],
    }


# ---------------------------------------------------------------------------
# Parsing tests
# ---------------------------------------------------------------------------

class TestParseTriggerPollNodes:
    def test_basic_url_trigger(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = _make_graph("g1", "n1", {
            "kind": "url",
            "url": "https://example.com/feed",
            "intervalSec": 60,
            "compareMode": "content-hash",
        })
        triggers = _parse_trigger_poll_nodes(doc)
        assert len(triggers) == 1
        t = triggers[0]
        assert t.graph_id == "g1"
        assert t.node_id == "n1"
        assert t.kind == "url"
        assert t.url == "https://example.com/feed"
        assert t.interval_sec == 60.0
        assert t.compare_mode == "content-hash"

    def test_rss_trigger(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = _make_graph("g2", "rss1", {
            "kind": "rss",
            "url": "https://github.com/python/cpython/releases.atom",
            "intervalSec": 300,
            "compareMode": "newest-item",
        })
        triggers = _parse_trigger_poll_nodes(doc)
        assert len(triggers) == 1
        t = triggers[0]
        assert t.kind == "rss"
        assert t.compare_mode == "newest-item"

    def test_command_trigger(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = _make_graph("g3", "cmd1", {
            "kind": "command",
            "argv": ["python", "-c", "print('hello')"],
            "intervalSec": 30,
        })
        triggers = _parse_trigger_poll_nodes(doc)
        assert len(triggers) == 1
        t = triggers[0]
        assert t.kind == "command"
        assert t.argv == ["python", "-c", "print('hello')"]

    def test_interval_minimum_enforced(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = _make_graph("g4", "n1", {"kind": "url", "url": "http://x", "intervalSec": 0.5})
        triggers = _parse_trigger_poll_nodes(doc)
        assert triggers[0].interval_sec == 5.0

    def test_unknown_kind_defaults_to_url(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = _make_graph("g5", "n1", {"kind": "ftp", "url": "http://x", "intervalSec": 10})
        triggers = _parse_trigger_poll_nodes(doc)
        assert triggers[0].kind == "url"

    def test_non_poll_nodes_ignored(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = {
            "schemaVersion": 1,
            "graphId": "g6",
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "p1", "type": "trigger_poll", "position": {"x": 100, "y": 0}, "data": {
                    "kind": "url", "url": "http://x", "intervalSec": 10
                }},
            ],
            "edges": [],
        }
        triggers = _parse_trigger_poll_nodes(doc)
        assert len(triggers) == 1
        assert triggers[0].node_id == "p1"

    def test_missing_graph_id_returns_empty_string(self) -> None:
        from graph_caster.run_broker_poller import _parse_trigger_poll_nodes

        doc = {
            "schemaVersion": 1,
            "nodes": [
                {"id": "p1", "type": "trigger_poll", "position": {"x": 0, "y": 0}, "data": {
                    "kind": "url", "url": "http://x", "intervalSec": 10,
                }},
            ],
            "edges": [],
        }
        triggers = _parse_trigger_poll_nodes(doc)
        assert triggers[0].graph_id == ""


# ---------------------------------------------------------------------------
# RSS parsing
# ---------------------------------------------------------------------------

class TestParseRssItems:
    RSS_FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Releases</title>
    <item>
      <title>v3.13.0</title>
      <link>https://github.com/python/cpython/releases/tag/v3.13.0</link>
      <guid>https://github.com/python/cpython/releases/tag/v3.13.0</guid>
    </item>
    <item>
      <title>v3.12.7</title>
      <link>https://github.com/python/cpython/releases/tag/v3.12.7</link>
      <guid>https://github.com/python/cpython/releases/tag/v3.12.7</guid>
    </item>
  </channel>
</rss>"""

    ATOM_FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://github.com/python/cpython/releases/tag/v3.13.0</id>
    <title>v3.13.0</title>
    <link href="https://github.com/python/cpython/releases/tag/v3.13.0"/>
  </entry>
  <entry>
    <id>https://github.com/python/cpython/releases/tag/v3.12.7</id>
    <title>v3.12.7</title>
    <link href="https://github.com/python/cpython/releases/tag/v3.12.7"/>
  </entry>
</feed>"""

    def test_rss_parse_items(self) -> None:
        from graph_caster.run_broker_poller import _parse_rss_items

        items = _parse_rss_items(self.RSS_FIXTURE)
        assert len(items) == 2
        assert items[0]["guid"] == "https://github.com/python/cpython/releases/tag/v3.13.0"
        assert items[0]["title"] == "v3.13.0"

    def test_atom_parse_items(self) -> None:
        from graph_caster.run_broker_poller import _parse_rss_items

        items = _parse_rss_items(self.ATOM_FIXTURE)
        assert len(items) == 2
        assert items[0]["guid"] == "https://github.com/python/cpython/releases/tag/v3.13.0"

    def test_invalid_xml_raises(self) -> None:
        from graph_caster.run_broker_poller import _parse_rss_items

        with pytest.raises(ValueError, match="RSS XML parse error"):
            _parse_rss_items(b"<not-closed")

    def test_newest_guid(self) -> None:
        from graph_caster.run_broker_poller import _newest_guid, _parse_rss_items

        items = _parse_rss_items(self.RSS_FIXTURE)
        assert _newest_guid(items) == "https://github.com/python/cpython/releases/tag/v3.13.0"

    def test_newest_guid_empty(self) -> None:
        from graph_caster.run_broker_poller import _newest_guid

        assert _newest_guid([]) is None


# ---------------------------------------------------------------------------
# URL trigger: content-hash
# ---------------------------------------------------------------------------

class TestPollUrl:
    @pytest.mark.anyio
    async def test_same_response_no_fire(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        body = b"hello world"
        h = hashlib.sha256(body).hexdigest()
        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="content-hash",
            headers={}, timeout_sec=30,
            state={"last_hash": h},
        )
        client = _FakeHttpxClient([_FakeResponse(200, body)])
        changed, payload = await _poll_url(trigger, http_client=client)
        assert changed is False
        assert payload == {}

    @pytest.mark.anyio
    async def test_changed_response_fires(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        old_hash = hashlib.sha256(b"old content").hexdigest()
        new_body = b"new content"
        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="content-hash",
            headers={}, timeout_sec=30,
            state={"last_hash": old_hash},
        )
        client = _FakeHttpxClient([_FakeResponse(200, new_body)])
        changed, payload = await _poll_url(trigger, http_client=client)
        assert changed is True
        assert payload["kind"] == "url"
        assert payload["status"] == 200
        assert "new content" in payload["body_preview"]
        new_hash = hashlib.sha256(new_body).hexdigest()
        assert trigger.state["last_hash"] == new_hash

    @pytest.mark.anyio
    async def test_first_poll_always_fires(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="content-hash",
            headers={}, timeout_sec=30,
            state={},  # no prior hash
        )
        client = _FakeHttpxClient([_FakeResponse(200, b"initial")])
        changed, payload = await _poll_url(trigger, http_client=client)
        assert changed is True

    @pytest.mark.anyio
    async def test_etag_304_no_fire(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="etag",
            headers={}, timeout_sec=30,
            state={"last_etag": '"abc123"'},
        )
        client = _FakeHttpxClient([_FakeResponse(304, b"", {"etag": '"abc123"'})])
        changed, payload = await _poll_url(trigger, http_client=client)
        assert changed is False

    @pytest.mark.anyio
    async def test_etag_new_value_fires(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="etag",
            headers={}, timeout_sec=30,
            state={"last_etag": '"old"'},
        )
        client = _FakeHttpxClient([_FakeResponse(200, b"new body", {"etag": '"new"'})])
        changed, payload = await _poll_url(trigger, http_client=client)
        assert changed is True
        assert trigger.state["last_etag"] == '"new"'

    @pytest.mark.anyio
    async def test_timeout_raises_timeout_error(self) -> None:
        import httpx
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="content-hash",
            headers={}, timeout_sec=1,
            state={},
        )

        class _TimeoutClient:
            async def get(self, *a: Any, **k: Any) -> Any:
                raise httpx.TimeoutException("timed out")

        with pytest.raises(TimeoutError):
            await _poll_url(trigger, http_client=_TimeoutClient())

    @pytest.mark.anyio
    async def test_request_error_raises_os_error(self) -> None:
        import httpx
        from graph_caster.run_broker_poller import PollTrigger, _poll_url

        trigger = PollTrigger(
            graph_id="g1", node_id="n1", kind="url",
            url="https://example.com/data",
            command=None, argv=None,
            interval_sec=60, compare_mode="content-hash",
            headers={}, timeout_sec=30,
            state={},
        )

        class _ErrorClient:
            async def get(self, *a: Any, **k: Any) -> Any:
                raise httpx.RequestError("connection refused")

        with pytest.raises(OSError):
            await _poll_url(trigger, http_client=_ErrorClient())


# ---------------------------------------------------------------------------
# RSS trigger
# ---------------------------------------------------------------------------

RSS_BODY_V1 = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>v3.13.0</title>
      <guid>https://github.com/python/cpython/releases/tag/v3.13.0</guid>
    </item>
  </channel>
</rss>"""

RSS_BODY_V2 = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>v3.14.0</title>
      <guid>https://github.com/python/cpython/releases/tag/v3.14.0</guid>
    </item>
    <item>
      <title>v3.13.0</title>
      <guid>https://github.com/python/cpython/releases/tag/v3.13.0</guid>
    </item>
  </channel>
</rss>"""


class TestPollRss:
    @pytest.mark.anyio
    async def test_first_poll_fires_with_all_items(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_rss

        trigger = PollTrigger(
            graph_id="g1", node_id="rss1", kind="rss",
            url="https://github.com/python/cpython/releases.atom",
            command=None, argv=None,
            interval_sec=300, compare_mode="newest-item",
            headers={}, timeout_sec=30,
            state={},
        )
        client = _FakeHttpxClient([_FakeResponse(200, RSS_BODY_V1)])
        changed, payload = await _poll_rss(trigger, http_client=client)
        assert changed is True
        assert payload["kind"] == "rss"
        assert len(payload["new_items"]) == 1
        newest_id = "https://github.com/python/cpython/releases/tag/v3.13.0"
        assert trigger.state["newest_id"] == newest_id

    @pytest.mark.anyio
    async def test_same_feed_no_fire(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_rss

        newest_id = "https://github.com/python/cpython/releases/tag/v3.13.0"
        trigger = PollTrigger(
            graph_id="g1", node_id="rss1", kind="rss",
            url="https://github.com/python/cpython/releases.atom",
            command=None, argv=None,
            interval_sec=300, compare_mode="newest-item",
            headers={}, timeout_sec=30,
            state={"newest_id": newest_id},
        )
        client = _FakeHttpxClient([_FakeResponse(200, RSS_BODY_V1)])
        changed, payload = await _poll_rss(trigger, http_client=client)
        assert changed is False
        assert payload == {}

    @pytest.mark.anyio
    async def test_new_item_fires(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_rss

        old_newest = "https://github.com/python/cpython/releases/tag/v3.13.0"
        trigger = PollTrigger(
            graph_id="g1", node_id="rss1", kind="rss",
            url="https://github.com/python/cpython/releases.atom",
            command=None, argv=None,
            interval_sec=300, compare_mode="newest-item",
            headers={}, timeout_sec=30,
            state={"newest_id": old_newest},
        )
        client = _FakeHttpxClient([_FakeResponse(200, RSS_BODY_V2)])
        changed, payload = await _poll_rss(trigger, http_client=client)
        assert changed is True
        assert payload["kind"] == "rss"
        assert len(payload["new_items"]) == 1
        assert payload["new_items"][0]["title"] == "v3.14.0"
        new_newest = "https://github.com/python/cpython/releases/tag/v3.14.0"
        assert trigger.state["newest_id"] == new_newest

    @pytest.mark.anyio
    async def test_invalid_xml_raises_value_error(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_rss

        trigger = PollTrigger(
            graph_id="g1", node_id="rss1", kind="rss",
            url="https://example.com/feed",
            command=None, argv=None,
            interval_sec=300, compare_mode="newest-item",
            headers={}, timeout_sec=30,
            state={},
        )
        client = _FakeHttpxClient([_FakeResponse(200, b"NOT XML <<<")])
        with pytest.raises(ValueError):
            await _poll_rss(trigger, http_client=client)


# ---------------------------------------------------------------------------
# Command trigger
# ---------------------------------------------------------------------------

class TestPollCommand:
    @pytest.mark.anyio
    async def test_deterministic_output_no_fire(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_command

        # Use sys.executable to get the same output twice
        cmd = [sys.executable, "-c", "print('stable', end='')"]
        stdout_bytes = b"stable"
        h = hashlib.sha256(stdout_bytes).hexdigest()
        trigger = PollTrigger(
            graph_id="g1", node_id="cmd1", kind="command",
            url=None, command=None, argv=cmd,
            interval_sec=30, compare_mode="content-hash",
            headers={}, timeout_sec=10,
            state={"last_hash": h},
        )
        changed, payload = await _poll_command(trigger)
        assert changed is False

    @pytest.mark.anyio
    async def test_different_output_fires(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_command

        cmd = [sys.executable, "-c", "import time; print(time.time(), end='')"]
        trigger = PollTrigger(
            graph_id="g1", node_id="cmd1", kind="command",
            url=None, command=None, argv=cmd,
            interval_sec=30, compare_mode="content-hash",
            headers={}, timeout_sec=10,
            state={"last_hash": "deadbeef"},
        )
        changed, payload = await _poll_command(trigger)
        assert changed is True
        assert payload["kind"] == "command"
        assert "stdout" in payload
        assert "exit_code" in payload

    @pytest.mark.anyio
    async def test_missing_command_raises(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_command

        trigger = PollTrigger(
            graph_id="g1", node_id="cmd1", kind="command",
            url=None, command=None, argv=None,
            interval_sec=30, compare_mode="content-hash",
            headers={}, timeout_sec=10,
            state={},
        )
        with pytest.raises(ValueError):
            await _poll_command(trigger)

    @pytest.mark.anyio
    async def test_nonexistent_command_raises_os_error(self) -> None:
        from graph_caster.run_broker_poller import PollTrigger, _poll_command

        trigger = PollTrigger(
            graph_id="g1", node_id="cmd1", kind="command",
            url=None, command=None, argv=["__nonexistent_cmd_xyz__"],
            interval_sec=30, compare_mode="content-hash",
            headers={}, timeout_sec=10,
            state={},
        )
        with pytest.raises(OSError):
            await _poll_command(trigger)


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------

class TestStatePersistence:
    def test_save_and_load(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import _load_state, _save_state

        state = {"last_hash": "abc123", "newest_id": "item-1"}
        _save_state(tmp_path, "g1", "n1", state)
        loaded = _load_state(tmp_path, "g1", "n1")
        assert loaded == state

    def test_load_nonexistent_returns_empty(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import _load_state

        result = _load_state(tmp_path, "g_missing", "n_missing")
        assert result == {}

    def test_state_file_path_format(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import _state_path

        p = _state_path(tmp_path, "my-graph", "poll-node")
        assert p.name == "my-graph__poll-node.json"


# ---------------------------------------------------------------------------
# PollWatcher integration tests
# ---------------------------------------------------------------------------

class TestPollWatcher:
    @pytest.mark.anyio
    async def test_reload_discovers_triggers(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url",
            "url": "https://example.com/data",
            "intervalSec": 60,
        })))

        broker = _SpyBrokerClient()
        watcher = PollWatcher(tmp_path, broker, state_base_dir=tmp_path / "state")
        await watcher.reload()

        triggers = watcher.list_triggers()
        assert len(triggers) == 1
        assert triggers[0].graph_id == "g1"
        assert triggers[0].node_id == "p1"

    @pytest.mark.anyio
    async def test_reload_after_new_graph_added(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        broker = _SpyBrokerClient()
        watcher = PollWatcher(tmp_path, broker, state_base_dir=tmp_path / "state")
        await watcher.reload()
        assert len(watcher.list_triggers()) == 0

        graph_file = tmp_path / "g2.json"
        graph_file.write_text(json.dumps(_make_graph("g2", "p2", {
            "kind": "url",
            "url": "https://example.com/new",
            "intervalSec": 60,
        })))
        await watcher.reload()
        assert len(watcher.list_triggers()) == 1
        assert watcher.list_triggers()[0].graph_id == "g2"

    @pytest.mark.anyio
    async def test_url_trigger_no_fire_same_content(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        body = b"stable content"
        h = hashlib.sha256(body).hexdigest()

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url",
            "url": "https://example.com/data",
            "intervalSec": 60,
        })))

        broker = _SpyBrokerClient()
        client = _FakeHttpxClient([_FakeResponse(200, body)])
        watcher = PollWatcher(tmp_path, broker, http_client=client, state_base_dir=tmp_path / "state")
        await watcher.reload()

        # Pre-seed state so no fire
        key = "g1::p1"
        watcher._triggers[key].state["last_hash"] = h

        # Force next_poll to be in the past
        watcher._next_poll[key] = 0.0

        await watcher._poll_all()
        assert len(broker.calls) == 0

    @pytest.mark.anyio
    async def test_url_trigger_fires_on_change(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        old_body = b"old"
        new_body = b"new content here"

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url",
            "url": "https://example.com/data",
            "intervalSec": 60,
        })))

        broker = _SpyBrokerClient()
        client = _FakeHttpxClient([_FakeResponse(200, new_body)])
        watcher = PollWatcher(tmp_path, broker, http_client=client, state_base_dir=tmp_path / "state")
        await watcher.reload()

        key = "g1::p1"
        old_hash = hashlib.sha256(old_body).hexdigest()
        watcher._triggers[key].state["last_hash"] = old_hash
        watcher._next_poll[key] = 0.0

        await watcher._poll_all()
        assert len(broker.calls) == 1
        assert broker.calls[0]["graph_id"] == "g1"
        assert broker.calls[0]["source"] == "poll"
        assert broker.calls[0]["payload"]["kind"] == "url"

    @pytest.mark.anyio
    async def test_invalid_url_increments_error_metric(self, tmp_path: Path) -> None:
        import httpx
        from graph_caster.run_broker_poller import PollWatcher

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url",
            "url": "https://invalid-url-that-does-not-exist.example",
            "intervalSec": 60,
        })))

        class _AlwaysErrorClient:
            async def get(self, *a: Any, **k: Any) -> Any:
                raise httpx.RequestError("connection refused")

        broker = _SpyBrokerClient()
        watcher = PollWatcher(
            tmp_path, broker,
            http_client=_AlwaysErrorClient(),
            state_base_dir=tmp_path / "state",
        )
        await watcher.reload()

        key = "g1::p1"
        watcher._next_poll[key] = 0.0

        # Should not raise — errors are contained
        await watcher._poll_all()

        assert len(broker.calls) == 0
        metrics = watcher.prometheus_metrics_text()
        assert "gc_poller_errors_total" in metrics

    @pytest.mark.anyio
    async def test_loop_continues_after_per_trigger_error(self, tmp_path: Path) -> None:
        import httpx
        from graph_caster.run_broker_poller import PollWatcher

        # Two graphs: one bad URL, one good
        g1 = tmp_path / "g1.json"
        g1.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url", "url": "https://bad.example", "intervalSec": 60,
        })))
        g2 = tmp_path / "g2.json"
        g2.write_text(json.dumps(_make_graph("g2", "p2", {
            "kind": "url", "url": "https://good.example", "intervalSec": 60,
        })))

        call_idx = [0]

        class _SelectiveClient:
            async def get(self, url: str, **k: Any) -> Any:
                if "bad" in url:
                    raise httpx.RequestError("refused")
                call_idx[0] += 1
                return _FakeResponse(200, b"body_v" + str(call_idx[0]).encode())

        broker = _SpyBrokerClient()
        watcher = PollWatcher(
            tmp_path, broker,
            http_client=_SelectiveClient(),
            state_base_dir=tmp_path / "state",
        )
        await watcher.reload()

        for key in list(watcher._next_poll):
            watcher._next_poll[key] = 0.0

        await watcher._poll_all()

        # g2/p2 should have fired; g1/p1 errored but loop continued
        good_calls = [c for c in broker.calls if c["graph_id"] == "g2"]
        assert len(good_calls) >= 1

    @pytest.mark.anyio
    async def test_state_persistence_prevents_refire_on_restart(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        body = b"persistent content"

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url", "url": "https://example.com/data", "intervalSec": 60,
        })))

        state_dir = tmp_path / "state"
        broker1 = _SpyBrokerClient()
        client1 = _FakeHttpxClient([_FakeResponse(200, body)])
        watcher1 = PollWatcher(tmp_path, broker1, http_client=client1, state_base_dir=state_dir)
        await watcher1.reload()

        key = "g1::p1"
        watcher1._next_poll[key] = 0.0
        await watcher1._poll_all()
        # First watcher should have fired (first-time hash)
        assert len(broker1.calls) == 1

        # State was persisted — new watcher instance should not refire
        broker2 = _SpyBrokerClient()
        client2 = _FakeHttpxClient([_FakeResponse(200, body)])
        watcher2 = PollWatcher(tmp_path, broker2, http_client=client2, state_base_dir=state_dir)
        await watcher2.reload()
        watcher2._next_poll[key] = 0.0
        await watcher2._poll_all()
        assert len(broker2.calls) == 0

    @pytest.mark.anyio
    async def test_prometheus_metrics_text(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        graph_file = tmp_path / "g1.json"
        graph_file.write_text(json.dumps(_make_graph("g1", "p1", {
            "kind": "url", "url": "https://example.com/data", "intervalSec": 60,
        })))

        broker = _SpyBrokerClient()
        client = _FakeHttpxClient([_FakeResponse(200, b"initial")])
        watcher = PollWatcher(tmp_path, broker, http_client=client, state_base_dir=tmp_path / "state")
        await watcher.reload()

        key = "g1::p1"
        watcher._next_poll[key] = 0.0
        await watcher._poll_all()

        metrics = watcher.prometheus_metrics_text()
        assert "gc_poller_triggers_total" in metrics
        assert "gc_poller_fires_total" in metrics

    def test_list_triggers_when_disabled(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        broker = _SpyBrokerClient()
        watcher = PollWatcher(tmp_path, broker, state_base_dir=tmp_path / "state")
        assert watcher.list_triggers() == []


# ---------------------------------------------------------------------------
# Poller disabled by default
# ---------------------------------------------------------------------------

class TestPollerEnabled:
    def test_disabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from graph_caster.run_broker_poller import _poller_enabled

        monkeypatch.delenv("GC_RUN_BROKER_POLLER", raising=False)
        assert _poller_enabled() is False

    def test_enabled_by_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from graph_caster.run_broker_poller import _poller_enabled

        monkeypatch.setenv("GC_RUN_BROKER_POLLER", "on")
        assert _poller_enabled() is True

    def test_enabled_by_1(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from graph_caster.run_broker_poller import _poller_enabled

        monkeypatch.setenv("GC_RUN_BROKER_POLLER", "1")
        assert _poller_enabled() is True

    @pytest.mark.anyio
    async def test_run_exits_immediately_when_disabled(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from graph_caster.run_broker_poller import PollWatcher

        monkeypatch.delenv("GC_RUN_BROKER_POLLER", raising=False)
        broker = _SpyBrokerClient()
        watcher = PollWatcher(tmp_path, broker, state_base_dir=tmp_path / "state")
        await watcher.run()
        assert watcher._running is False
