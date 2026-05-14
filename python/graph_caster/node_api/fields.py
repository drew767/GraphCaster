# Copyright GraphCaster. All Rights Reserved.

"""Input and Output field descriptors for the declarative node API."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Input:
    """Declares one input slot on a GraphCasterNode."""

    name: str
    field_type: type | str
    required: bool = False
    default: Any = None
    description: str = ""
    placeholder: str = ""
    options: list[str] | None = None
    range: tuple[float, float] | None = None
    multiline: bool = False
    advanced: bool = False
    is_list: bool = False
    secret: bool = False


@dataclass
class Output:
    """Declares one output slot on a GraphCasterNode."""

    name: str
    field_type: type | str
    description: str = ""
    is_list: bool = False
