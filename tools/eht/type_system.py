"""Type classification and C++/TypeScript mapping."""

from typing import Dict, List, Set
from .data import Enum


class TypeSystem:
    """Manages type mappings and conversions between C++ and TypeScript."""

    PRIMITIVE_TYPES = {
        'bool', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'f32', 'f64', 'float', 'double', 'int', 'unsigned'
    }

    GLM_TYPES = {'glm::vec2', 'glm::vec3', 'glm::vec4', 'glm::quat', 'glm::uvec2'}

    CUSTOM_STRUCT_TYPES = {
        'Padding': ('Padding', [('left', 'left'), ('top', 'top'), ('right', 'right'), ('bottom', 'bottom')]),
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
        'Padding': 'Padding',
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

    def is_handle(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return 'Handle' in t or t.startswith('resource::')

    def is_entity(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) == 'Entity'

    def is_vector(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.VECTOR_TYPES

    def is_skip(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return t in self.SKIP_TYPES

    def is_primitive(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.PRIMITIVE_TYPES

    def is_glm(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.GLM_TYPES

    def is_custom_struct(self, cpp_type: str) -> bool:
        return self.clean_type(cpp_type) in self.CUSTOM_STRUCT_TYPES

    def needs_wrapper(self, cpp_type: str) -> bool:
        return self.is_enum(cpp_type) or self.is_handle(cpp_type)

    def is_entity_vector(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return t in self.VECTOR_TYPES and 'Entity' in t

    def needs_wrapper(self, comp) -> bool:
        """Check if a component needs a JS wrapper struct (has enum/handle/entity fields)."""
        for prop in comp.properties:
            if self.is_enum(prop.cpp_type) or self.is_handle(prop.cpp_type) \
               or self.is_entity(prop.cpp_type) or self.is_entity_vector(prop.cpp_type):
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
        if t in self.CUSTOM_STRUCT_TYPES:
            return self.CUSTOM_STRUCT_TYPES[t][0]
        return 'unknown'
