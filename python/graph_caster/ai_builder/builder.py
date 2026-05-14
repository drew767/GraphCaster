# Copyright GraphCaster. All Rights Reserved.

"""F91: AIWorkflowBuilder — natural-language description → GraphDocument JSON."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from graph_caster.ai_builder.prompts import EXAMPLE_GRAPHS, REFINEMENT_PROMPT, SYSTEM_PROMPT
from graph_caster.ai_builder.validator import validate_graph
from graph_caster.llm.provider import ChatMessage, TokenUsage
from graph_caster.llm.registry import ProviderRegistry, get_default_registry


@dataclass
class BuildResult:
    graph: dict
    rationale: str
    warnings: list[str]
    tokens_used: dict
    validation_errors: list[str]


class AIWorkflowBuilder:
    """Build or refine a GraphCaster workflow graph from natural language."""

    def __init__(
        self,
        *,
        provider: str = "openai",
        model: str = "gpt-4o",
        registry: ProviderRegistry | None = None,
    ) -> None:
        self._provider_name = provider
        self._model = model
        self._registry = registry or get_default_registry()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_llm(self):
        return self._registry.get(self._provider_name)

    def _examples_block(self, examples: list[dict] | None) -> str:
        chosen = examples if examples is not None else EXAMPLE_GRAPHS
        if not chosen:
            return ""
        parts = ["## Example graphs\n"]
        for i, ex in enumerate(chosen[:3], 1):
            parts.append(f"### Example {i}\n```json\n{json.dumps(ex, indent=2)}\n```\n")
        return "\n".join(parts)

    def _node_types_block(self, available_nodes: list[str] | None) -> str:
        if not available_nodes:
            return ""
        return "## Available node types for this request\n" + ", ".join(available_nodes) + "\n"

    def _build_user_message(
        self,
        description: str,
        available_nodes: list[str] | None,
        examples: list[dict] | None,
    ) -> str:
        parts = [
            self._node_types_block(available_nodes),
            self._examples_block(examples),
            "## Request\n",
            description.strip(),
            "\n\nRespond with a JSON object containing 'graph' and 'rationale' keys only.",
        ]
        return "\n".join(p for p in parts if p)

    @staticmethod
    def _accumulate_usage(total: dict, resp_usage: TokenUsage, provider: str) -> None:
        entry = total.setdefault(provider, {"input": 0, "output": 0, "total": 0})
        entry["input"] += resp_usage.prompt_tokens
        entry["output"] += resp_usage.completion_tokens
        entry["total"] += resp_usage.total_tokens

    @staticmethod
    def _parse_llm_response(content: str) -> tuple[dict, str]:
        """Parse LLM JSON response. Returns (graph_dict, rationale)."""
        content = content.strip()
        # Strip markdown fences if present
        if content.startswith("```"):
            lines = content.splitlines()
            inner = []
            in_fence = False
            for line in lines:
                if line.startswith("```"):
                    in_fence = not in_fence
                    continue
                if in_fence:
                    inner.append(line)
            content = "\n".join(inner)

        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError("LLM response root must be a JSON object")
        graph = parsed.get("graph")
        rationale = str(parsed.get("rationale") or "")
        if not isinstance(graph, dict):
            raise ValueError("LLM response must contain 'graph' key with an object value")
        # Ensure a graphId exists
        meta = graph.setdefault("meta", {})
        if not meta.get("graphId"):
            meta["graphId"] = str(uuid.uuid4())
        return graph, rationale

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def build(
        self,
        description: str,
        *,
        available_nodes: list[str] | None = None,
        examples: list[dict] | None = None,
        refine_iterations: int = 1,
    ) -> BuildResult:
        """Generate a graph from a natural-language description.

        Steps:
        1. Compose system + user messages with schema overview and examples.
        2. Call LLM and parse JSON response.
        3. Validate against schema.
        4. If validation fails and refine_iterations > 0: feed errors back, retry.
        5. Return BuildResult.
        """
        llm = self._get_llm()
        tokens_used: dict[str, dict] = {}
        warnings: list[str] = []

        system_msg = ChatMessage(role="system", content=SYSTEM_PROMPT)
        user_content = self._build_user_message(description, available_nodes, examples)
        user_msg = ChatMessage(role="user", content=user_content)
        messages = [system_msg, user_msg]

        # First call
        resp = await llm.chat(self._model, messages, temperature=0.2)
        self._accumulate_usage(tokens_used, resp.usage, self._provider_name)

        try:
            graph, rationale = self._parse_llm_response(resp.content)
        except (json.JSONDecodeError, ValueError) as exc:
            return BuildResult(
                graph={},
                rationale="",
                warnings=[],
                tokens_used=tokens_used,
                validation_errors=[f"LLM response parse error: {exc}"],
            )

        validation_errors = validate_graph(graph)

        # Refinement loop when there are errors
        remaining = refine_iterations
        while validation_errors and remaining > 0:
            remaining -= 1
            refinement_content = REFINEMENT_PROMPT.format(
                errors="\n".join(f"- {e}" for e in validation_errors),
                prior_graph=json.dumps(graph, indent=2),
            )
            messages = [
                system_msg,
                user_msg,
                ChatMessage(role="assistant", content=resp.content),
                ChatMessage(role="user", content=refinement_content),
            ]
            resp = await llm.chat(self._model, messages, temperature=0.1)
            self._accumulate_usage(tokens_used, resp.usage, self._provider_name)

            try:
                graph, rationale = self._parse_llm_response(resp.content)
            except (json.JSONDecodeError, ValueError) as exc:
                warnings.append(f"Refinement parse error: {exc}")
                break

            validation_errors = validate_graph(graph)

        return BuildResult(
            graph=graph,
            rationale=rationale,
            warnings=warnings,
            tokens_used=tokens_used,
            validation_errors=validation_errors,
        )

    async def refine(self, prior_graph: dict, feedback: str) -> BuildResult:
        """Modify an existing graph based on natural-language feedback."""
        llm = self._get_llm()
        tokens_used: dict[str, dict] = {}
        warnings: list[str] = []

        refinement_content = (
            "Modify the following graph based on the feedback below. "
            "Return a JSON object with 'graph' and 'rationale' keys.\n\n"
            f"## Feedback\n{feedback.strip()}\n\n"
            f"## Current graph\n```json\n{json.dumps(prior_graph, indent=2)}\n```\n\n"
            "Respond with a JSON object containing 'graph' and 'rationale' keys only."
        )

        system_msg = ChatMessage(role="system", content=SYSTEM_PROMPT)
        user_msg = ChatMessage(role="user", content=refinement_content)
        messages = [system_msg, user_msg]

        resp = await llm.chat(self._model, messages, temperature=0.2)
        self._accumulate_usage(tokens_used, resp.usage, self._provider_name)

        try:
            graph, rationale = self._parse_llm_response(resp.content)
        except (json.JSONDecodeError, ValueError) as exc:
            return BuildResult(
                graph={},
                rationale="",
                warnings=[],
                tokens_used=tokens_used,
                validation_errors=[f"LLM response parse error: {exc}"],
            )

        validation_errors = validate_graph(graph)

        return BuildResult(
            graph=graph,
            rationale=rationale,
            warnings=warnings,
            tokens_used=tokens_used,
            validation_errors=validation_errors,
        )
