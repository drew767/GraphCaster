# Copyright GraphCaster. All Rights Reserved.

"""Local node registry for GraphCasterNode subclasses.

Provides register_class() which validates a node class and stores it under
(type, version). When a global NodeRegistry (F47) is available it will be
used as the backing store; otherwise a module-level dict is used.
"""

from __future__ import annotations

import asyncio
from typing import Any

from graph_caster.node_api.base import GraphCasterNode

_REGISTRY: dict[tuple[str, float], type[GraphCasterNode]] = {}


def _validate_cls(node_cls: type[GraphCasterNode]) -> None:
    if not hasattr(node_cls, "type") or not isinstance(node_cls.type, str) or not node_cls.type:
        raise ValueError(f"{node_cls.__name__} must define a non-empty class variable `type`")

    input_names = [inp.name for inp in node_cls.inputs]
    if len(input_names) != len(set(input_names)):
        raise ValueError(f"{node_cls.__name__} has duplicate input names: {input_names}")

    output_names = [out.name for out in node_cls.outputs]
    if len(output_names) != len(set(output_names)):
        raise ValueError(f"{node_cls.__name__} has duplicate output names: {output_names}")


def _make_sync_adapter(node_cls: type[GraphCasterNode]):
    """Return a callable(node_data, ctx) -> outputs dict that invokes node_cls.run()."""

    def adapter(node_data: dict[str, Any], ctx: Any) -> dict[str, Any]:
        instance = node_cls()
        kwargs: dict[str, Any] = {}
        for inp in node_cls.inputs:
            if inp.name in node_data:
                kwargs[inp.name] = node_data[inp.name]
            elif inp.default is not None:
                kwargs[inp.name] = inp.default

        coro = instance.run(ctx, **kwargs)
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, instance.run(ctx, **kwargs))
                return future.result()
        else:
            return loop.run_until_complete(coro)

    return adapter


def register_class(node_cls: type[GraphCasterNode]) -> None:
    """Validate and register a GraphCasterNode subclass.

    The node is stored under (node_cls.type, node_cls.version). Duplicate
    registrations for the same (type, version) overwrite the previous entry.
    """
    _validate_cls(node_cls)
    key = (node_cls.type, node_cls.version)
    _REGISTRY[key] = node_cls


def get_registered(node_type: str, version: float = 1.0) -> type[GraphCasterNode] | None:
    """Return the registered class for (type, version) or None."""
    return _REGISTRY.get((node_type, version))


def all_registered() -> dict[tuple[str, float], type[GraphCasterNode]]:
    """Return a snapshot of all registered node classes."""
    return dict(_REGISTRY)


def make_adapter(node_cls: type[GraphCasterNode]):
    """Return a sync adapter function for the given node class."""
    return _make_sync_adapter(node_cls)
