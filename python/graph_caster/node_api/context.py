# Copyright GraphCaster. All Rights Reserved.

"""NodeContext — runtime context passed to GraphCasterNode.run()."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from graph_caster.secrets.providers import SecretsProvider


@dataclass
class NodeContext:
    """All runtime resources available inside a node's run() call."""

    run_id: str
    node_id: str
    graph_id: str
    workspace_root: Path
    secrets: SecretsProvider
    emit: Callable[[dict], None]
    upstream_outputs: dict[str, dict]
    expression_eval: Callable[[str, dict], Any]
