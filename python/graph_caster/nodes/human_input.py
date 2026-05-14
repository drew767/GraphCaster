# Copyright GraphCaster. All Rights Reserved.

"""HumanInputNode — pause execution until a human provides input (F45)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class HumanInputNode(GraphCasterNode):
    """Pause the run and wait for human input.

    When visited the runner emits ``human_input_required``, persists a
    checkpoint and raises :class:`~graph_caster.pause_resume.PauseException`.
    A subsequent ``resume`` command loads the checkpoint, injects the human
    payload into ``node_outputs`` and continues from the next node.

    Competitors: Dify graphon ``human_input`` pause-resume;
    Flowise ``IHumanInput`` in ``buildAgentflow.ts``.
    """

    type = "human_input"
    version = 1.0
    display_name = "Human Input"
    category = "control"

    inputs = [
        Input(
            "kind",
            str,
            options=["text", "choice", "approval", "json"],
            default="text",
            description="Input modality presented to the human.",
        ),
        Input(
            "prompt",
            str,
            required=True,
            multiline=True,
            description="Question or instruction shown to the human.",
        ),
        Input(
            "choices",
            "json",
            default=None,
            description="List of strings for kind=choice.",
        ),
        Input(
            "schema",
            "json",
            default=None,
            description="JSON Schema object for kind=json.",
        ),
        Input(
            "timeoutSec",
            float,
            default=0,
            description="Seconds before auto-resume with timedOut=true; 0 = no timeout.",
        ),
    ]

    outputs = [
        Output("value", "json", description="Human-provided value (null on timeout)."),
        Output("approved", bool, description="True/False for kind=approval; null otherwise."),
        Output("respondedAt", str, description="ISO-8601 timestamp of the response."),
        Output("respondedBy", str, description="Identifier of the responder (optional)."),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        from graph_caster.pause_resume import PauseCheckpoint, PauseException

        kind = str(kwargs.get("kind") or "text")
        prompt = str(kwargs.get("prompt") or "")
        choices = kwargs.get("choices")
        schema = kwargs.get("schema")
        timeout_sec = float(kwargs.get("timeoutSec") or 0)

        run_id: str = str(ctx.get("run_id") or "")
        graph_id: str = str(ctx.get("graph_id") or "")
        node_id: str = str(ctx.get("_current_node_id") or "")
        node_outputs: dict[str, Any] = dict(ctx.get("node_outputs") or {})

        paused_at = datetime.now(UTC).isoformat()

        checkpoint = PauseCheckpoint(
            run_id=run_id,
            graph_id=graph_id,
            paused_at_node=node_id,
            node_outputs=node_outputs,
            prompt=prompt,
            kind=kind,
            choices=choices,
            schema=schema,
            paused_at=paused_at,
            timeout_sec=timeout_sec,
        )

        raise PauseException(checkpoint)


register_class(HumanInputNode)
