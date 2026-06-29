# Copyright GraphCaster. All Rights Reserved.

"""Declarative structural-rule engine.

This module is a thin dispatcher that reads ``schemas/structural-rules.json``
and runs the registered handler for each rule id. The catalog acts as a
language-neutral SSOT for the list of known rules, severity, and target node
type — the actual rule logic still lives in ``graph_caster.validate`` for now.

Rule handlers are registered via the ``@register_rule(id)`` decorator and
receive ``(doc, params)`` where ``params`` is the rule's ``params`` object from
the catalog. Each handler returns a list of warning dicts; the engine fills
in ``kind`` (= rule id) and ``severity`` from the catalog when missing.

This is the Python side of the parity-engine pair; the TS side lives in
``ui/src/contract/structuralRules.ts``.

Migration status: 5 of 23 rules ported. The remaining 18 still execute via
their original ``find_*`` functions in ``validate.py`` and are not yet driven
by this engine.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any, Callable

from graph_caster.models import GraphDocument
from graph_caster.validate import (
    find_barrier_merge_no_success_incoming_warnings,
    find_barrier_merge_out_error_incoming,
    find_fork_few_outputs_warnings,
    find_http_request_structure_warnings,
    find_merge_incoming_warnings,
)

RULES_CATALOG_PATH = (
    Path(__file__).resolve().parent.parent.parent / "schemas" / "structural-rules.json"
)

RuleFn = Callable[[GraphDocument, dict[str, Any]], list[dict[str, Any]]]

RULE_FNS_BY_ID: dict[str, RuleFn] = {}


def register_rule(rule_id: str) -> Callable[[RuleFn], RuleFn]:
    def deco(fn: RuleFn) -> RuleFn:
        RULE_FNS_BY_ID[rule_id] = fn
        return fn

    return deco


@functools.lru_cache(maxsize=1)
def load_rules_catalog() -> list[dict[str, Any]]:
    raw = json.loads(RULES_CATALOG_PATH.read_text(encoding="utf-8"))
    rules = raw.get("rules")
    if not isinstance(rules, list):
        raise ValueError("structural-rules.json: 'rules' must be an array")
    return rules


def invalidate_rules_catalog_cache() -> None:
    load_rules_catalog.cache_clear()


def validate_structural(doc: GraphDocument) -> list[dict[str, Any]]:
    """Run every registered rule from the catalog against ``doc``.

    Rules listed in the catalog but lacking a registered handler are silently
    skipped (TODO: pending migration). Each emitted warning is annotated with
    ``kind`` (= rule id) and ``severity`` from the catalog if absent.
    """
    catalog = load_rules_catalog()
    out: list[dict[str, Any]] = []
    for rule in catalog:
        rid = rule.get("id")
        if not isinstance(rid, str):
            continue
        fn = RULE_FNS_BY_ID.get(rid)
        if fn is None:
            continue
        params = rule.get("params") if isinstance(rule.get("params"), dict) else {}
        warnings = fn(doc, params or {})
        sev = rule.get("severity", "warning")
        for w in warnings:
            w.setdefault("kind", rid)
            w.setdefault("severity", sev)
        out.extend(warnings)
    return out


# ----------------------------------------------------------------------------
# Ported rules — thin wrappers around the canonical ``find_*`` functions.
# When a rule is migrated fully into this module, its body moves here and the
# corresponding ``find_*`` in ``validate.py`` becomes a thin forwarder.
# ----------------------------------------------------------------------------


@register_rule("fork_few_outputs")
def _rule_fork_few_outputs(doc: GraphDocument, params: dict[str, Any]) -> list[dict[str, Any]]:
    return list(find_fork_few_outputs_warnings(doc))


@register_rule("barrier_merge_out_error_incoming")
def _rule_barrier_merge_out_error_incoming(
    doc: GraphDocument, params: dict[str, Any]
) -> list[dict[str, Any]]:
    return list(find_barrier_merge_out_error_incoming(doc))


@register_rule("barrier_merge_no_success_incoming")
def _rule_barrier_merge_no_success_incoming(
    doc: GraphDocument, params: dict[str, Any]
) -> list[dict[str, Any]]:
    return list(find_barrier_merge_no_success_incoming_warnings(doc))


@register_rule("merge_few_inputs")
def _rule_merge_few_inputs(doc: GraphDocument, params: dict[str, Any]) -> list[dict[str, Any]]:
    return list(find_merge_incoming_warnings(doc))


@register_rule("http_request_empty_url")
def _rule_http_request_empty_url(
    doc: GraphDocument, params: dict[str, Any]
) -> list[dict[str, Any]]:
    return list(find_http_request_structure_warnings(doc))
