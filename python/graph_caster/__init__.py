# Copyright Aura. All Rights Reserved.

"""GraphCaster Python runner: load graph JSON, traverse with edge conditions, emit run events."""

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

__all__ = ["GraphDocument", "GraphRunner", "__version__"]

__version__ = "0.1.0"
