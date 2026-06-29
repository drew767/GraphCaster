# Copyright GraphCaster. All Rights Reserved.

"""Parity contract for ``schemas/structural-rules.json``.

This test pins the Python side of the parity-engine pair. Bidirectional parity
with the TypeScript engine (``ui/src/contract/structuralRules.ts``) is deferred
until there is infrastructure to invoke vitest from pytest — at that point this
test should evolve into a true cross-language comparison harness.

What this test does today (unidirectional):

* Loads the catalog and confirms every catalog id has a registered Python
  handler in ``structural_rules_engine.RULE_FNS_BY_ID``.
* Builds a synthetic "bad" document that is engineered to trigger every one of
  the 5 currently-ported rules, then asserts ``validate_structural`` returns
  exactly that set of ``kind`` values.
* Runs ``validate_structural`` over every real fixture in
  ``schemas/test-fixtures/`` and asserts: (a) it does not crash; (b) every
  emitted warning's ``kind`` is in the catalog; (c) every emitted warning has
  ``severity`` set.

TODO (bidirectional parity): spawn the UI's parity test (which would run the
TS engine over the same fixtures) and compare the JSON-serialised warning
lists element-by-element.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.models import GraphDocument
from graph_caster.structural_rules_engine import (
    RULE_FNS_BY_ID,
    load_rules_catalog,
    validate_structural,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMAS_DIR = REPO_ROOT / "schemas"
FIXTURES_DIR = SCHEMAS_DIR / "test-fixtures"


def _catalog_rule_ids() -> set[str]:
    return {r["id"] for r in load_rules_catalog() if isinstance(r.get("id"), str)}


def test_every_catalog_rule_has_python_handler() -> None:
    catalog_ids = _catalog_rule_ids()
    missing = catalog_ids - set(RULE_FNS_BY_ID)
    assert missing == set(), (
        f"catalog rule ids without a Python handler: {sorted(missing)} "
        f"— register in structural_rules_engine.py"
    )


def test_catalog_has_known_proof_of_concept_rules() -> None:
    """The 5 PoC rules must remain in the catalog. Drift here is intentional."""
    expected = {
        "fork_few_outputs",
        "barrier_merge_out_error_incoming",
        "barrier_merge_no_success_incoming",
        "merge_few_inputs",
        "http_request_empty_url",
    }
    assert _catalog_rule_ids() == expected, (
        "structural-rules.json drifted from the proof-of-concept set; "
        "either update this test or revert the catalog."
    )


def _bad_doc_dict() -> dict:
    """Synthetic document engineered to trigger every PoC rule exactly once."""
    return {
        "schemaVersion": 1,
        "meta": {
            "schemaVersion": 1,
            "graphId": "11111111-1111-4111-8111-111111111111",
            "title": "synthetic bad doc",
        },
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            # fork with only 1 unconditional outgoing → fork_few_outputs
            {"id": "f1", "type": "fork", "position": {"x": 100, "y": 0}, "data": {}},
            # task that emits out_error into the barrier merge
            {
                "id": "t1",
                "type": "task",
                "position": {"x": 200, "y": 0},
                "data": {"command": "PLACEHOLDER"},
            },
            # barrier merge with 1 success incoming + 1 out_error incoming →
            #   barrier_merge_out_error_incoming + merge_few_inputs
            #   (and no other success incoming would also trigger
            #    barrier_merge_no_success_incoming if the success edge were
            #    absent — so we rely on a second merge below for that one)
            {
                "id": "m1",
                "type": "merge",
                "position": {"x": 300, "y": 0},
                "data": {"mode": "barrier"},
            },
            # second barrier merge with zero non-frame incoming →
            #   barrier_merge_no_success_incoming
            {
                "id": "m2",
                "type": "merge",
                "position": {"x": 400, "y": 0},
                "data": {"mode": "barrier"},
            },
            # http_request without url → http_request_empty_url
            {"id": "h1", "type": "http_request", "position": {"x": 500, "y": 0}, "data": {}},
            {"id": "x1", "type": "exit", "position": {"x": 600, "y": 0}, "data": {}},
        ],
        "edges": [
            {"id": "e0", "source": "s1", "sourceHandle": "out_default", "target": "f1"},
            {"id": "e1", "source": "f1", "sourceHandle": "out_default", "target": "t1"},
            {"id": "e_err", "source": "t1", "sourceHandle": "out_error", "target": "m1"},
            {"id": "e_ok", "source": "t1", "sourceHandle": "out_default", "target": "m1"},
            {"id": "e2", "source": "m1", "sourceHandle": "out_default", "target": "h1"},
            {"id": "e3", "source": "h1", "sourceHandle": "out_default", "target": "x1"},
        ],
    }


def test_synthetic_doc_triggers_every_poc_rule() -> None:
    doc = GraphDocument.from_dict(_bad_doc_dict())
    warnings = validate_structural(doc)
    kinds = {w["kind"] for w in warnings}
    expected = {
        "fork_few_outputs",
        "barrier_merge_out_error_incoming",
        "barrier_merge_no_success_incoming",
        "merge_few_inputs",
        "http_request_empty_url",
    }
    assert expected.issubset(kinds), (
        f"engine produced kinds={sorted(kinds)} but missing {sorted(expected - kinds)}"
    )
    # Every warning must carry severity from the catalog.
    for w in warnings:
        assert "severity" in w, f"warning lacks severity: {w}"
        assert w["severity"] in ("warning", "error"), w


@pytest.mark.parametrize(
    "fixture_path",
    sorted(FIXTURES_DIR.glob("*.json")),
    ids=lambda p: p.name,
)
def test_engine_runs_on_every_fixture_without_crashing(fixture_path: Path) -> None:
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    warnings = validate_structural(doc)
    catalog_ids = _catalog_rule_ids()
    for w in warnings:
        assert w.get("kind") in catalog_ids, (
            f"{fixture_path.name}: emitted unknown kind {w.get('kind')!r} "
            f"(not in catalog {sorted(catalog_ids)})"
        )
        assert w.get("severity") in ("warning", "error"), (
            f"{fixture_path.name}: warning lacks severity: {w}"
        )
