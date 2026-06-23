"""Type classification and C++/TypeScript mapping."""

import re
from typing import Dict, List, Optional, Set
from .data import Enum


class TypeSystem:
    """Manages type mappings and conversions between C++ and TypeScript."""

    PRIMITIVE_TYPES = {
        'bool', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'f32', 'f64', 'float', 'double', 'int', 'unsigned'
    }

    GLM_TYPES = {'glm::vec2', 'glm::vec3', 'glm::vec4', 'glm::quat', 'glm::uvec2'}

    # Small POD structs usable as builtin component fields: serialized via embind,
    # sized for the pointer cursor, mirrored to a TS interface + editor controls.
    # Generalizes the former single Padding special case. Each entry maps a struct
    # name to its ordered (member_name, member_cpp_type) list; the struct must be
    # defined in the esengine:: namespace and included by WebBindings
    # (core/UITypes.hpp) and be a standard C++ POD.
    #
    # Structs used as a DIRECT component field (Padding/Dimension) must have only
    # primitive members in PtrLayoutGenerator.TYPE_SIZES (they go through the
    # pointer cursor). Structs used ONLY as a `std::vector<Struct>` element
    # (VisualState) are exempt — vectors are never pointer-accessed — so they may
    # carry std::string members.
    CUSTOM_STRUCTS = {
        'Padding': [('left', 'f32'), ('top', 'f32'), ('right', 'f32'), ('bottom', 'f32')],
        'Dimension': [('value', 'f32'), ('unit', 'u8')],
        'VisualState': [
            ('name', 'std::string'),
            ('r', 'f32'), ('g', 'f32'), ('b', 'f32'), ('a', 'f32'),
            ('sprite', 'u32'), ('scale', 'f32'),
        ],
    }

    SKIP_TYPES = {'glm::mat4', 'std::function'}

    VECTOR_TYPES = {'std::vector<Entity>': ('u32', 'VectorEntity', 'VectorEntity')}

    CPP_TO_TS = {
        'bool': 'boolean',
        'i8': 'number', 'i16': 'number', 'i32': 'number', 'i64': 'number',
        'u8': 'number', 'u16': 'number', 'u32': 'number', 'u64': 'number',
        'f32': 'number', 'f64': 'number', 'float': 'number', 'double': 'number',
        'int': 'number', 'unsigned': 'number',
        'std::string': 'string', 'Entity': 'number',
        'glm::vec2': 'Vec2', 'glm::vec3': 'Vec3', 'glm::vec4': 'Vec4',
        'glm::quat': 'Quat', 'glm::uvec2': 'UVec2',
    }

    def __init__(self, enums: List[Enum]):
        self.enums = enums
        self.enum_names: Set[str] = set()
        for e in enums:
            self.enum_names.add(e.name)
            if e.namespace:
                self.enum_names.add(f'{e.namespace}::{e.name}')

    def clean_type(self, cpp_type: str) -> str:
        return cpp_type.replace('const', '').replace('&', '').strip()

    def is_enum(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.enum_names

    def get_enum_values(self, cpp_type: str) -> List[str]:
        t = self.clean_type(cpp_type)
        for e in self.enums:
            if e.name == t or f'{e.namespace}::{e.name}' == t:
                return e.values
        return []

    def is_handle(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return 'Handle' in t or t.startswith('resource::')

    def is_entity(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) == 'Entity'

    def is_vector(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.VECTOR_TYPES

    def vector_elem(self, cpp_type: str) -> Optional[str]:
        """For `std::vector<X>`, return the element type X (stripped); else None."""
        m = re.fullmatch(r'std::vector<(.+)>', self.clean_type(cpp_type))
        return m.group(1).strip() if m else None

    def is_struct_vector(self, cpp_type: str) -> bool:
        """`std::vector<S>` where S is a registered CUSTOM_STRUCT (REARCH_GUI F5).
        Marshalled via embind register_vector<S> + value_object<S>; never
        pointer-accessed."""
        elem = self.vector_elem(cpp_type)
        return elem is not None and elem in self.CUSTOM_STRUCTS

    def is_any_vector(self, cpp_type: str) -> bool:
        return self.is_vector(cpp_type) or self.is_struct_vector(cpp_type)

    def struct_vector_js_name(self, cpp_type: str) -> str:
        """embind register_vector binding name for a struct-vector, e.g.
        std::vector<VisualState> -> VectorVisualState."""
        return f'Vector{self.vector_elem(cpp_type)}'

    def is_skip(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return t in self.SKIP_TYPES

    def is_primitive(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.PRIMITIVE_TYPES

    def is_glm(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.GLM_TYPES

    def is_custom_struct(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.CUSTOM_STRUCTS

    def custom_struct_members(self, cpp_type: str):
        """Return the [(member_name, member_cpp_type), ...] list for a custom struct."""
        return self.CUSTOM_STRUCTS[self.clean_type(cpp_type)]

    def member_ts_type(self, member_cpp_type: str) -> str:
        """TS type for a custom-struct member (always a primitive)."""
        return self.CPP_TO_TS.get(member_cpp_type, 'number')

    def needs_wrapper(self, cpp_type: str) -> bool:
        return self.is_enum(cpp_type) or self.is_handle(cpp_type)

    def is_entity_vector(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return t in self.VECTOR_TYPES and 'Entity' in t

    def needs_wrapper(self, comp) -> bool:
        """Check if a component needs a JS wrapper struct (has enum/handle/entity/
        struct-vector fields that must be converted at the boundary)."""
        for prop in comp.properties:
            if self.is_enum(prop.cpp_type) or self.is_handle(prop.cpp_type) \
               or self.is_entity(prop.cpp_type) or self.is_entity_vector(prop.cpp_type) \
               or self.is_struct_vector(prop.cpp_type):
                return True
        return False

    def get_js_type(self, cpp_type: str) -> str:
        """Get the C++ type to use in JS wrapper structs."""
        t = self.clean_type(cpp_type)
        if self.is_handle(t) or self.is_entity(t):
            return 'u32'
        if self.is_enum(t):
            return 'i32'
        if t in self.VECTOR_TYPES:
            elem_type = self.VECTOR_TYPES[t][0]
            return f'std::vector<{elem_type}>'
        if self.is_struct_vector(t):
            # embind can't auto-convert a JS array to a registered std::vector, so
            # the wrapper field is an emscripten::val (a JS array) and from/toJS
            # convert element-by-element via the VisualState value_object.
            return 'emscripten::val'
        return t

    def to_typescript(self, cpp_type: str) -> str:
        t = self.clean_type(cpp_type)
        if t in self.CPP_TO_TS:
            return self.CPP_TO_TS[t]
        if self.is_enum(t):
            return 'number'
        if self.is_handle(t):
            return 'number'
        if t in self.VECTOR_TYPES:
            return self.VECTOR_TYPES[t][2]
        if self.is_struct_vector(t):
            return f'{self.vector_elem(t)}[]'  # e.g. VisualState[]
        if t in self.CUSTOM_STRUCTS:
            return t  # the struct name is its own TS interface name
        return 'unknown'
