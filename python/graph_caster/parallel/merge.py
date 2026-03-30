# Copyright GraphCaster. All Rights Reserved.

"""Merge strategies for parallel branch results."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class MergeStrategy(Enum):
    COLLECT_ALL = "collect_all"
    FIRST_SUCCESS = "first_success"
    ALL_MUST_SUCCEED = "all_must_succeed"
    CONCAT_ARRAYS = "concat_arrays"
    RACE = "race"


@dataclass
class BranchResult:
    branch_id: str
    port: str
    output: Any
    ok: bool
    error: str | None = None
    duration_ms: float = 0.0


@dataclass
class MergeResult:
    ok: bool
    output: Any
    error: str | None = None
    branch_results: list[BranchResult] = field(default_factory=list)


@dataclass
class MergeNode:
    strategy: MergeStrategy = MergeStrategy.COLLECT_ALL
    wait_timeout: float | None = None

    def merge(
        self,
        results: list[BranchResult],
        expected_count: int | None = None,
        array_key: str | None = None,
    ) -> MergeResult:
        if expected_count is not None and len(results) < expected_count:
            return MergeResult(
                ok=False,
                output=None,
                error=f"Timeout: received {len(results)}/{expected_count} results",
                branch_results=results,
            )
        if self.strategy == MergeStrategy.COLLECT_ALL:
            return self._merge_collect_all(results)
        if self.strategy == MergeStrategy.FIRST_SUCCESS:
            return self._merge_first_success(results)
        if self.strategy == MergeStrategy.ALL_MUST_SUCCEED:
            return self._merge_all_must_succeed(results)
        if self.strategy == MergeStrategy.CONCAT_ARRAYS:
            return self._merge_concat_arrays(results, array_key)
        if self.strategy == MergeStrategy.RACE:
            return self._merge_race(results)
        raise ValueError(f"Unknown strategy: {self.strategy}")

    def _merge_collect_all(self, results: list[BranchResult]) -> MergeResult:
        output = {
            "results": {r.port: r.output for r in results},
            "success_count": sum(1 for r in results if r.ok),
            "failure_count": sum(1 for r in results if not r.ok),
        }
        failures = [r for r in results if not r.ok]
        return MergeResult(
            ok=len(failures) == 0,
            output=output,
            error="; ".join(f"{r.port}: {r.error}" for r in failures) if failures else None,
            branch_results=results,
        )

    def _merge_first_success(self, results: list[BranchResult]) -> MergeResult:
        for r in results:
            if r.ok:
                return MergeResult(ok=True, output=r.output, branch_results=results)
        errors = [r.error or "unknown error" for r in results]
        return MergeResult(
            ok=False,
            output=None,
            error=f"All branches failed: {'; '.join(errors)}",
            branch_results=results,
        )

    def _merge_all_must_succeed(self, results: list[BranchResult]) -> MergeResult:
        failures = [r for r in results if not r.ok]
        if failures:
            return MergeResult(
                ok=False,
                output=None,
                error="; ".join(r.error or "unknown" for r in failures),
                branch_results=results,
            )
        return MergeResult(
            ok=True,
            output={r.port: r.output for r in results},
            branch_results=results,
        )

    def _merge_concat_arrays(
        self,
        results: list[BranchResult],
        array_key: str | None,
    ) -> MergeResult:
        combined: list[Any] = []
        for r in results:
            if not r.ok:
                continue
            if array_key and isinstance(r.output, dict):
                items = r.output.get(array_key, [])
            elif isinstance(r.output, list):
                items = r.output
            else:
                items = [r.output]
            combined.extend(items)
        output: Any = {array_key or "items": combined} if array_key else combined
        return MergeResult(ok=True, output=output, branch_results=results)

    def _merge_race(self, results: list[BranchResult]) -> MergeResult:
        if not results:
            return MergeResult(ok=False, output=None, error="No results in race")
        first = results[0]
        return MergeResult(
            ok=first.ok,
            output=first.output,
            error=first.error,
            branch_results=[first],
        )
