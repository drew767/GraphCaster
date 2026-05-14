# Copyright GraphCaster. All Rights Reserved.

"""Reference port of built-in nodes as GraphCasterNode subclasses.

These implementations coexist with the existing inline dispatch in GraphRunner;
migration is intentionally incremental.
"""

from __future__ import annotations

from typing import Any, ClassVar

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.context import NodeContext
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class CommentNode(GraphCasterNode):
    """Editor-only annotation node — no-op at runtime.

    Mirrors the existing behaviour: comment nodes are skipped by the runner
    (they are editor frame nodes) and produce no outputs. This class exists
    purely to demonstrate the contract and to serve as a schema source.
    """

    type: ClassVar[str] = "comment"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "Comment"
    description: ClassVar[str] = "Annotation node — no-op during execution."
    category: ClassVar[str] = "utility"
    icon: ClassVar[str] = "sticky-note"

    inputs: ClassVar[list[Input]] = [
        Input(
            name="text",
            field_type=str,
            required=False,
            default="",
            description="Annotation text (not used at runtime).",
            multiline=True,
        ),
    ]
    outputs: ClassVar[list[Output]] = []

    async def run(self, ctx: NodeContext, **kwargs: Any) -> dict[str, Any]:
        return {}


register_class(CommentNode)
