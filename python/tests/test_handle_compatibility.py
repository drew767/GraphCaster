# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.handle_contract import find_handle_compatibility_violations
from graph_caster.models import GraphDocument
from graph_caster.validate import GraphStructureError, validate_graph_structure

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = GRAPH_CASTER_ROOT / "schemas" / "test-fixtures"


def _load_fixture(name: str) -> GraphDocument:
    p = FIXTURES / name
    return GraphDocument.from_dict(json.loads(p.read_text(encoding="utf-8")))


def test_fixture_ok_validates() -> None:
    doc = _load_fixture("handle-ok.json")
    assert validate_graph_structure(doc) == "s1"


def test_fixture_bad_start_source_handle_raises() -> None:
    doc = _load_fixture("handle-bad-start-out.json")
    with pytest.raises(GraphStructureError, match="invalid source handle"):
        validate_graph_structure(doc)


def test_fixture_bad_exit_target_handle_raises() -> None:
    doc = _load_fixture("handle-bad-exit-in.json")
    with pytest.raises(GraphStructureError, match="invalid target handle"):
        validate_graph_structure(doc)


def test_find_violations_matches_fixtures() -> None:
    assert find_handle_compatibility_violations(_load_fixture("handle-ok.json")) == []
    bad_src = find_handle_compatibility_violations(_load_fixture("handle-bad-start-out.json"))
    assert len(bad_src) == 1 and bad_src[0]["kind"] == "invalid_source_handle"
    bad_tgt = find_handle_compatibility_violations(_load_fixture("handle-bad-exit-in.json"))
    assert len(bad_tgt) == 1 and bad_tgt[0]["kind"] == "invalid_target_handle"


def test_merge_out_error_source_invalid() -> None:
    doc = _load_fixture("handle-bad-merge-out-error.json")
    v = find_handle_compatibility_violations(doc)
    assert len(v) == 1
    assert v[0]["kind"] == "invalid_source_handle"
    assert v[0]["nodeType"] == "merge"
    with pytest.raises(GraphStructureError, match="invalid source handle"):
        validate_graph_structure(doc)


def test_merge_fixture_validates() -> None:
    doc = _load_fixture("handle-merge.json")
    assert find_handle_compatibility_violations(doc) == []
    assert validate_graph_structure(doc) == "s1"
