# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from graph_caster.annotations import Annotation, AnnotationStore

# Metrics counter for dataset exports (keyed by format name).
_ANNOTATION_EXPORTED_COUNTER: dict[str, int] = {}


def _run_summary(run_dir: Path) -> dict | None:
    p = run_dir / "run-summary.json"
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _iter_run_dirs(artifacts_base: Path, graph_id: str):
    root = artifacts_base / "runs" / graph_id
    if not root.is_dir():
        return
    for sub in sorted(root.iterdir()):
        if sub.is_dir():
            yield sub


def _passes_filters(
    ann: Annotation,
    *,
    min_rating: int | None,
    node_id: str | None,
    since: datetime | None,
    labels: list[str] | None,
) -> bool:
    if min_rating is not None:
        if ann.rating is None or ann.rating < min_rating:
            return False
    if node_id is not None:
        if ann.node_id != node_id:
            return False
    if since is not None:
        if ann.created_at:
            try:
                ts = datetime.fromisoformat(ann.created_at.replace("Z", "+00:00"))
                if ts < since:
                    return False
            except ValueError:
                pass
    if labels:
        for lbl in labels:
            if lbl not in ann.labels:
                return False
    return True


def _build_record(
    ann: Annotation,
    run_summaries: dict[str, dict],
) -> dict[str, Any] | None:
    summary = run_summaries.get(ann.run_id, {})
    inputs = summary.get("inputs") or {}

    prompt_parts: list[str] = []
    if inputs:
        prompt_parts.append(json.dumps(inputs, ensure_ascii=False))
    if ann.node_id:
        prompt_parts.append(f"[node:{ann.node_id}]")

    prompt = " ".join(prompt_parts) if prompt_parts else ""

    if ann.suggested_output is not None:
        completion = json.dumps(ann.suggested_output, ensure_ascii=False)
    elif ann.rating is not None and ann.rating >= 4:
        node_outputs = summary.get("node_outputs") or {}
        node_out = node_outputs.get(ann.node_id or "", {}) if ann.node_id else {}
        completion = json.dumps(node_out, ensure_ascii=False) if node_out else ""
    else:
        return None

    return {
        "prompt": prompt,
        "completion": completion,
        "annotation": ann,
        "summary": summary,
    }


def _load_run_summaries(artifacts_base: Path, graph_id: str) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for run_dir in _iter_run_dirs(artifacts_base, graph_id):
        s = _run_summary(run_dir)
        if s and "runId" in s:
            result[str(s["runId"])] = s
    return result


def export_dataset(
    artifacts_base: Path,
    graph_id: str,
    output_path: Path,
    fmt: str = "jsonl",
    *,
    min_rating: int | None = None,
    node_id: str | None = None,
    since: datetime | None = None,
    labels: list[str] | None = None,
) -> int:
    store = AnnotationStore(artifacts_base)

    import asyncio

    all_anns: list[Annotation] = asyncio.run(store.list_for_graph(graph_id))

    filtered = [
        a for a in all_anns
        if _passes_filters(a, min_rating=min_rating, node_id=node_id, since=since, labels=labels)
    ]

    run_summaries = _load_run_summaries(artifacts_base, graph_id)

    records = []
    for ann in filtered:
        rec = _build_record(ann, run_summaries)
        if rec is not None:
            records.append(rec)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    if fmt == "jsonl":
        with output_path.open("w", encoding="utf-8") as f:
            for rec in records:
                line = {
                    "prompt": rec["prompt"],
                    "completion": rec["completion"],
                    "metadata": {
                        "run_id": rec["annotation"].run_id,
                        "node_id": rec["annotation"].node_id,
                        "rating": rec["annotation"].rating,
                        "labels": rec["annotation"].labels,
                        "author": rec["annotation"].author,
                        "created_at": rec["annotation"].created_at,
                    },
                }
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
                count += 1
    elif fmt == "openai-ft":
        with output_path.open("w", encoding="utf-8") as f:
            for rec in records:
                line = {
                    "messages": [
                        {"role": "user", "content": rec["prompt"]},
                        {"role": "assistant", "content": rec["completion"]},
                    ]
                }
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
                count += 1
    elif fmt == "csv":
        with output_path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["run_id", "node_id", "rating", "comment", "prompt", "completion"],
            )
            writer.writeheader()
            for rec in records:
                ann = rec["annotation"]
                writer.writerow(
                    {
                        "run_id": ann.run_id,
                        "node_id": ann.node_id or "",
                        "rating": ann.rating if ann.rating is not None else "",
                        "comment": ann.comment,
                        "prompt": rec["prompt"],
                        "completion": rec["completion"],
                    }
                )
                count += 1
    else:
        raise ValueError(f"Unknown format: {fmt!r}")

    _ANNOTATION_EXPORTED_COUNTER[fmt] = _ANNOTATION_EXPORTED_COUNTER.get(fmt, 0) + count
    return count
