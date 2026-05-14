# Copyright GraphCaster. All Rights Reserved.

"""JSON Schema fragment generator from GraphCasterNode class declarations."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from graph_caster.node_api.base import GraphCasterNode
    from graph_caster.node_api.fields import Input


def _field_type_schema(field_type: type | str) -> dict[str, Any]:
    """Map a field_type value to a JSON Schema type fragment."""
    _MAP: dict[Any, dict] = {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        "json": {},
        "secret": {"type": "string"},
        "str": {"type": "string"},
        "int": {"type": "integer"},
        "float": {"type": "number"},
        "bool": {"type": "boolean"},
    }
    if field_type in _MAP:
        return dict(_MAP[field_type])
    if isinstance(field_type, str) and field_type.startswith("list["):
        inner = field_type[5:-1]
        inner_schema = _field_type_schema(inner)
        return {"type": "array", "items": inner_schema}
    return {}


def _input_schema(inp: Input) -> dict[str, Any]:
    schema = _field_type_schema(inp.field_type)

    if inp.options is not None:
        schema["enum"] = list(inp.options)

    if inp.range is not None:
        lo, hi = inp.range
        schema["minimum"] = lo
        schema["maximum"] = hi

    if inp.multiline:
        schema["x-multiline"] = True

    if inp.description:
        schema["description"] = inp.description

    if inp.is_list:
        schema = {"type": "array", "items": schema}

    return schema


def node_data_schema(cls: type[GraphCasterNode]) -> dict[str, Any]:
    """Return a JSON Schema object fragment for the node's data inputs."""
    properties: dict[str, Any] = {}
    required: list[str] = []

    for inp in cls.inputs:
        properties[inp.name] = _input_schema(inp)
        if inp.required:
            required.append(inp.name)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required
    return schema
