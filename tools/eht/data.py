"""Core data structures shared by parser and generators."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set


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
    #: ES_COMPONENT(...) annotations — metadata about the component itself, as
    #: `Property.annotations` is about one field.
    annotations: Dict[str, str] = field(default_factory=dict)


# A C++ method every JS read of the component must run first. Transform's world
# TRS is decomposed lazily from the cached matrix, so the fields sitting in memory
# are stale until it is — a reader that skips this sees the last decomposed value
# (zero for a UI node that nothing else drew). Declared once here because BOTH
# binding surfaces expose the read: embind returns the struct, the native buffer
# binding hands JS its memory, and the two must not drift.
READ_HOOKS: Dict[str, str] = {'Transform': 'ensureDecomposed'}


# Parent and Children are two halves of one relationship: writing either as a plain
# component leaves the other stale, and a tree walk cannot reach past the gap.
# Every binding surface routes their writes through ecs::setParent instead.
HIERARCHY_COMPONENTS: Set[str] = {'Parent', 'Children'}


@dataclass
class Enum:
    """An ES_ENUM enum class."""
    name: str
    namespace: str
    values: List[str] = field(default_factory=list)
    underlying_type: str = "int"
