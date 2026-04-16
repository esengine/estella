"""Core data structures shared by parser and generators."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Property:
    """A single ES_PROPERTY field in a component."""
    name: str
    cpp_type: str
    default_value: Optional[str] = None
    annotations: Dict[str, str] = field(default_factory=dict)


@dataclass
class Component:
    """An ES_COMPONENT struct."""
    name: str
    namespace: str
    properties: List[Property] = field(default_factory=list)
    header_path: str = ""


@dataclass
class Enum:
    """An ES_ENUM enum class."""
    name: str
    namespace: str
    values: List[str] = field(default_factory=list)
    underlying_type: str = "int"
