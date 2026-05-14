# Copyright GraphCaster. All Rights Reserved.

"""Tests for F89 webhook notification templates."""

from __future__ import annotations

import pytest

from graph_caster.notifications.templates import (
    DiscordTemplate,
    GenericTemplate,
    SlackTemplate,
    TeamsTemplate,
    get_template,
)

# ---------------------------------------------------------------------------
# Sample run summaries
# ---------------------------------------------------------------------------

_SUCCESS = {
    "schemaVersion": 1,
    "type": "run_finished",
    "runId": "run-001",
    "rootGraphId": "graph-abc",
    "status": "success",
    "finishedAt": "2026-05-12T10:00:00Z",
    "nodeCount": 5,
    "errorCount": 0,
    "durationMs": 3200,
}

_FAILED = {
    "schemaVersion": 1,
    "type": "run_finished",
    "runId": "run-002",
    "rootGraphId": "graph-abc",
    "status": "failed",
    "finishedAt": "2026-05-12T10:01:00Z",
    "nodeCount": 3,
    "errorCount": 1,
    "durationMs": 1500,
    "errors": [{"message": "Node task1 timed out after 30s"}],
}

_CANCELLED = {
    "schemaVersion": 1,
    "type": "run_finished",
    "runId": "run-003",
    "rootGraphId": "graph-abc",
    "status": "cancelled",
    "finishedAt": "2026-05-12T10:02:00Z",
}

_PARTIAL = {
    "schemaVersion": 1,
    "type": "run_finished",
    "runId": "run-004",
    "rootGraphId": "graph-abc",
    "status": "partial",
    "finishedAt": "2026-05-12T10:03:00Z",
}

_MINIMAL = {
    "status": "success",
}


# ---------------------------------------------------------------------------
# get_template registry
# ---------------------------------------------------------------------------


def test_get_template_known() -> None:
    for name in ("generic", "slack", "discord", "teams"):
        tmpl = get_template(name)
        assert tmpl.name == name


def test_get_template_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Unknown webhook template"):
        get_template("foobar")


def test_get_template_case_insensitive() -> None:
    assert get_template("Slack").name == "slack"
    assert get_template("TEAMS").name == "teams"


# ---------------------------------------------------------------------------
# GenericTemplate
# ---------------------------------------------------------------------------


class TestGenericTemplate:
    def test_passthrough_success(self) -> None:
        body = GenericTemplate().render(_SUCCESS)
        assert body["runId"] == "run-001"
        assert body["status"] == "success"

    def test_passthrough_failed(self) -> None:
        body = GenericTemplate().render(_FAILED)
        assert body["status"] == "failed"

    def test_content_type(self) -> None:
        assert GenericTemplate().content_type() == "application/json"

    def test_does_not_mutate_input(self) -> None:
        original = dict(_SUCCESS)
        GenericTemplate().render(_SUCCESS)
        assert _SUCCESS == original

    def test_minimal_no_crash(self) -> None:
        body = GenericTemplate().render(_MINIMAL)
        assert body["status"] == "success"


# ---------------------------------------------------------------------------
# SlackTemplate
# ---------------------------------------------------------------------------


class TestSlackTemplate:
    def test_blocks_structure_success(self) -> None:
        body = SlackTemplate().render(_SUCCESS)
        assert "blocks" in body
        blocks = body["blocks"]
        types = [b["type"] for b in blocks]
        assert "header" in types
        assert "section" in types

    def test_header_text_success(self) -> None:
        body = SlackTemplate().render(_SUCCESS)
        header = next(b for b in body["blocks"] if b["type"] == "header")
        assert "succeeded" in header["text"]["text"].lower()
        assert "✅" in header["text"]["text"]

    def test_header_text_failed(self) -> None:
        body = SlackTemplate().render(_FAILED)
        header = next(b for b in body["blocks"] if b["type"] == "header")
        assert "failed" in header["text"]["text"].lower()
        assert "❌" in header["text"]["text"]

    def test_header_text_cancelled(self) -> None:
        body = SlackTemplate().render(_CANCELLED)
        header = next(b for b in body["blocks"] if b["type"] == "header")
        assert "cancel" in header["text"]["text"].lower()
        assert "⚠️" in header["text"]["text"]

    def test_error_code_block_on_failed(self) -> None:
        body = SlackTemplate().render(_FAILED)
        blocks = body["blocks"]
        section_texts = [
            b["text"]["text"]
            for b in blocks
            if b["type"] == "section" and "text" in b
        ]
        error_block = next(
            (t for t in section_texts if "timed out" in t), None
        )
        assert error_block is not None, f"expected error code block, sections: {section_texts}"
        assert "```" in error_block

    def test_no_error_block_on_success(self) -> None:
        body = SlackTemplate().render(_SUCCESS)
        blocks = body["blocks"]
        section_texts = [
            b["text"]["text"]
            for b in blocks
            if b["type"] == "section" and "text" in b
        ]
        for t in section_texts:
            assert "timed out" not in t

    def test_context_block_has_run_id(self) -> None:
        body = SlackTemplate().render(_SUCCESS)
        context_blocks = [b for b in body["blocks"] if b["type"] == "context"]
        assert context_blocks, "expected at least one context block"
        text_content = " ".join(
            e.get("text", "") for ctx in context_blocks for e in ctx.get("elements", [])
        )
        assert "run-001" in text_content

    def test_footer_link_when_ui_base_url_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GC_RUN_UI_BASE_URL", "https://gc.example.com")
        body = SlackTemplate().render(_SUCCESS)
        action_blocks = [b for b in body["blocks"] if b["type"] == "actions"]
        assert action_blocks, "expected actions block with UI link"
        buttons = action_blocks[0]["elements"]
        urls = [btn.get("url", "") for btn in buttons]
        assert any("run-001" in u for u in urls)

    def test_no_footer_link_without_ui_base_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GC_RUN_UI_BASE_URL", raising=False)
        body = SlackTemplate().render(_SUCCESS)
        action_blocks = [b for b in body["blocks"] if b["type"] == "actions"]
        assert not action_blocks

    def test_minimal_no_crash(self) -> None:
        body = SlackTemplate().render(_MINIMAL)
        assert "blocks" in body

    def test_content_type(self) -> None:
        assert SlackTemplate().content_type() == "application/json"


# ---------------------------------------------------------------------------
# DiscordTemplate
# ---------------------------------------------------------------------------


class TestDiscordTemplate:
    def test_embeds_structure(self) -> None:
        body = DiscordTemplate().render(_SUCCESS)
        assert "embeds" in body
        assert len(body["embeds"]) == 1

    def test_color_green_on_success(self) -> None:
        body = DiscordTemplate().render(_SUCCESS)
        assert body["embeds"][0]["color"] == 0x2ECC71

    def test_color_red_on_failed(self) -> None:
        body = DiscordTemplate().render(_FAILED)
        assert body["embeds"][0]["color"] == 0xE74C3C

    def test_color_yellow_on_cancelled(self) -> None:
        body = DiscordTemplate().render(_CANCELLED)
        assert body["embeds"][0]["color"] == 0xF1C40F

    def test_color_yellow_on_partial(self) -> None:
        body = DiscordTemplate().render(_PARTIAL)
        assert body["embeds"][0]["color"] == 0xF1C40F

    def test_title_contains_status(self) -> None:
        body = DiscordTemplate().render(_SUCCESS)
        assert "succeeded" in body["embeds"][0]["title"].lower()

    def test_description_has_run_id(self) -> None:
        body = DiscordTemplate().render(_SUCCESS)
        desc = body["embeds"][0].get("description", "")
        assert "run-001" in desc

    def test_timestamp_present(self) -> None:
        body = DiscordTemplate().render(_SUCCESS)
        assert "timestamp" in body["embeds"][0]
        assert "2026-05-12" in body["embeds"][0]["timestamp"]

    def test_error_field_on_failed(self) -> None:
        body = DiscordTemplate().render(_FAILED)
        fields = body["embeds"][0].get("fields", [])
        error_field = next((f for f in fields if f["name"] == "Error"), None)
        assert error_field is not None
        assert "timed out" in error_field["value"]

    def test_ui_url_on_embed_when_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GC_RUN_UI_BASE_URL", "https://gc.example.com")
        body = DiscordTemplate().render(_SUCCESS)
        assert "url" in body["embeds"][0]
        assert "run-001" in body["embeds"][0]["url"]

    def test_minimal_no_crash(self) -> None:
        body = DiscordTemplate().render(_MINIMAL)
        assert "embeds" in body
        assert len(body["embeds"]) == 1

    def test_content_type(self) -> None:
        assert DiscordTemplate().content_type() == "application/json"


# ---------------------------------------------------------------------------
# TeamsTemplate
# ---------------------------------------------------------------------------


class TestTeamsTemplate:
    def test_message_card_schema(self) -> None:
        body = TeamsTemplate().render(_SUCCESS)
        assert body["@type"] == "MessageCard"
        assert body["@context"] == "http://schema.org/extensions"

    def test_theme_color_success(self) -> None:
        body = TeamsTemplate().render(_SUCCESS)
        assert body["themeColor"] == "00b300"

    def test_theme_color_failed(self) -> None:
        body = TeamsTemplate().render(_FAILED)
        assert body["themeColor"] == "cc0000"

    def test_theme_color_cancelled(self) -> None:
        body = TeamsTemplate().render(_CANCELLED)
        assert body["themeColor"] == "ffa500"

    def test_sections_facts_contain_graph_id(self) -> None:
        body = TeamsTemplate().render(_SUCCESS)
        sections = body["sections"]
        facts = sections[0]["facts"]
        fact_values = [f["value"] for f in facts]
        assert "graph-abc" in fact_values

    def test_sections_facts_contain_run_id(self) -> None:
        body = TeamsTemplate().render(_SUCCESS)
        facts = body["sections"][0]["facts"]
        fact_values = [f["value"] for f in facts]
        assert "run-001" in fact_values

    def test_sections_facts_contain_status(self) -> None:
        body = TeamsTemplate().render(_SUCCESS)
        facts = body["sections"][0]["facts"]
        names = [f["name"] for f in facts]
        assert "Status" in names

    def test_potential_action_when_ui_base_url_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GC_RUN_UI_BASE_URL", "https://gc.example.com")
        body = TeamsTemplate().render(_SUCCESS)
        actions = body.get("potentialAction", [])
        assert actions
        targets = actions[0]["targets"]
        assert any("run-001" in t["uri"] for t in targets)

    def test_no_potential_action_without_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GC_RUN_UI_BASE_URL", raising=False)
        body = TeamsTemplate().render(_SUCCESS)
        assert "potentialAction" not in body

    def test_error_text_on_failed(self) -> None:
        body = TeamsTemplate().render(_FAILED)
        section = body["sections"][0]
        assert "text" in section
        assert "timed out" in section["text"]

    def test_minimal_no_crash(self) -> None:
        body = TeamsTemplate().render(_MINIMAL)
        assert body["@type"] == "MessageCard"
        facts = body["sections"][0]["facts"]
        names = [f["name"] for f in facts]
        assert "Status" in names

    def test_content_type(self) -> None:
        assert TeamsTemplate().content_type() == "application/json"
