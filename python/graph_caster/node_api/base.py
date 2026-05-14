# Copyright GraphCaster. All Rights Reserved.

"""GraphCasterNode — abstract base class for the declarative node API."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

from graph_caster.node_api.fields import Input, Output


class GraphCasterNode(ABC):
    """Base class every declarative node must subclass.

    Class-level attributes declare identity and schema; the instance method
    run() carries the actual behaviour.
    """

    type: ClassVar[str]
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = ""
    description: ClassVar[str] = ""
    category: ClassVar[str] = "general"
    icon: ClassVar[str] = ""
    inputs: ClassVar[list[Input]] = []
    outputs: ClassVar[list[Output]] = []

    @abstractmethod
    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        """Execute node logic.

        kwargs keys correspond to declared Input.name values. The returned
        dict keys must match declared Output.name values.
        """

    @classmethod
    def schema(cls) -> dict:
        """Return a JSON Schema fragment describing this node's data object."""
        from graph_caster.node_api.schema_gen import node_data_schema

        return node_data_schema(cls)
