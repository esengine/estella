"""Shared field analysis utilities.

Centralizes color detection, vector expansion, and default value conversion
used by MetadataGenerator, AnimTargetGenerator, and EditorAPIGenerator.
"""

import re
from typing import Dict, List, Optional, Tuple
from .data import Component, Property
from .type_system import TypeSystem


# Field names that indicate a color (vec4 with these names → color semantics)
COLOR_FIELD_PATTERNS = {'color', 'Color', 'tint', 'Tint'}

# Sub-component expansions per GLM type
VEC2_SUBS = [('x', 'x'), ('y', 'y')]
VEC3_SUBS = [('x', 'x'), ('y', 'y'), ('z', 'z')]
VEC4_SUBS = [('x', 'x'), ('y', 'y'), ('z', 'z'), ('w', 'w')]
VEC4_COLOR_SUBS = [('r', 'r'), ('g', 'g'), ('b', 'b'), ('a', 'a')]
QUAT_SUBS = [('w', 'w'), ('x', 'x'), ('y', 'y'), ('z', 'z')]
PADDING_SUBS = [('left', 'left'), ('top', 'top'), ('right', 'right'), ('bottom', 'bottom')]


def is_color_field(prop: Property, types: TypeSystem) -> bool:
    """Check if a property represents a color (vec4 with color-like name)."""
    t = types.clean_type(prop.cpp_type)
    if t != 'glm::vec4':
        return False
    return any(pat in prop.name for pat in COLOR_FIELD_PATTERNS)


def get_sub_components(prop: Property, types: TypeSystem) -> List[Tuple[str, str]]:
    """Get the sub-component expansion list for a property type.

    Returns list of (label, cpp_member) tuples.
    For scalar types, returns [('', '')].
    For vec3, returns [('x','x'), ('y','y'), ('z','z')].
    """
    t = types.clean_type(prop.cpp_type)

    if t == 'glm::vec2':
        return VEC2_SUBS
    if t == 'glm::vec3':
        return VEC3_SUBS
    if t == 'glm::vec4':
        return VEC4_COLOR_SUBS if is_color_field(prop, types) else VEC4_SUBS
    if t == 'glm::quat':
        return QUAT_SUBS
    if t == 'glm::uvec2':
        return VEC2_SUBS
    if t == 'Padding':
        return PADDING_SUBS
    # Scalar
    return [('', '')]


def get_editor_type(prop: Property, types: TypeSystem) -> str:
    """Map a C++ property to an editor field type string.

    Returns: 'float', 'int', 'bool', 'string', 'color', 'asset', 'entity', 'enum', 'skip'
    """
    t = types.clean_type(prop.cpp_type)

    if types.is_skip(t):
        return 'skip'
    if is_color_field(prop, types):
        return 'color'
    if prop.annotations.get('asset'):
        return 'asset'
    if 'entity_ref' in prop.annotations:
        return 'entity'
    if types.is_handle(t):
        return 'int'  # Handle → u32
    if types.is_enum(t):
        return 'enum'
    if types.is_entity(t):
        return 'entity'
    if t in ('bool',):
        return 'bool'
    if t in ('std::string',):
        return 'string'
    if t in ('f32', 'f64', 'float', 'double'):
        return 'float'
    if t in TypeSystem.PRIMITIVE_TYPES:
        return 'int'
    if t in TypeSystem.GLM_TYPES or t in TypeSystem.CUSTOM_STRUCT_TYPES:
        return 'float'  # Sub-components are all floats (or ints for uvec2)
    if t in TypeSystem.VECTOR_TYPES:
        return 'skip'  # Vector types not editable as simple fields
    return 'skip'


def build_enum_value_map(enums) -> Dict[str, Dict[str, int]]:
    """Build a lookup from enum type name to { value_name: index }."""
    result: Dict[str, Dict[str, int]] = {}
    for enum in enums:
        vals = {v: i for i, v in enumerate(enum.values)}
        result[enum.name] = vals
        if enum.namespace:
            result[f'{enum.namespace}::{enum.name}'] = vals
    return result


def format_number(raw: Optional[str]) -> str:
    """Convert a C++ numeric literal to a clean string."""
    if not raw:
        return '0'
    raw = raw.strip().rstrip('fF')
    try:
        val = float(raw)
        if val == int(val):
            return str(int(val))
        return str(val)
    except (ValueError, OverflowError):
        return '0'


def parse_float_list(raw: Optional[str], count: int) -> List[str]:
    """Parse a C++ initializer list of floats."""
    if not raw:
        return ['0'] * count
    raw = raw.strip()
    parts = [p.strip().rstrip('fF') for p in raw.split(',')]
    if len(parts) == 1:
        val = format_number(parts[0])
        return [val] * count
    result = [format_number(p) for p in parts[:count]]
    while len(result) < count:
        result.append('0')
    return result


def parse_int_list(raw: Optional[str], count: int) -> List[str]:
    """Parse a C++ initializer list of integers."""
    if not raw:
        return ['0'] * count
    parts = [p.strip() for p in raw.split(',')]
    result = parts[:count]
    while len(result) < count:
        result.append('0')
    return result


def convert_default_ts(prop: Property, types: TypeSystem,
                       enum_values: Dict[str, Dict[str, int]]) -> str:
    """Convert a C++ default value to TypeScript literal."""
    t = types.clean_type(prop.cpp_type)
    raw = prop.default_value

    if types.is_handle(t):
        return '0'
    if t == 'std::string':
        if raw and raw.startswith('"') and raw.endswith('"'):
            return raw
        return "''"
    if t in types.VECTOR_TYPES:
        return '[]'
    if t == 'Padding':
        return '{ left: 0, top: 0, right: 0, bottom: 0 }'
    if raw and 'static_cast' in raw:
        m = re.search(r'(\w+)::(\w+)', raw)
        if m:
            enum_name, val_name = m.group(1), m.group(2)
            for key, vals in enum_values.items():
                if key.endswith(enum_name) or key == enum_name:
                    if val_name in vals:
                        return str(vals[val_name])
    if types.is_enum(t):
        enum_short = t.split('::')[-1]
        if raw and '::' in raw:
            val_name = raw.split('::')[-1].strip()
            for key, vals in enum_values.items():
                if key.endswith(enum_short) or key == enum_short:
                    if val_name in vals:
                        return str(vals[val_name])
        return '0'
    if t == 'bool':
        return 'true' if raw == 'true' else 'false'
    if t == 'glm::quat':
        vals = parse_float_list(raw, 4)
        return f'{{ w: {vals[0]}, x: {vals[1]}, y: {vals[2]}, z: {vals[3]} }}'
    if t == 'glm::vec2':
        vals = parse_float_list(raw, 2)
        return f'{{ x: {vals[0]}, y: {vals[1]} }}'
    if t == 'glm::uvec2':
        vals = parse_int_list(raw, 2)
        return f'{{ x: {vals[0]}, y: {vals[1]} }}'
    if t == 'glm::vec3':
        vals = parse_float_list(raw, 3)
        return f'{{ x: {vals[0]}, y: {vals[1]}, z: {vals[2]} }}'
    if t == 'glm::vec4':
        vals = parse_float_list(raw, 4)
        if is_color_field(prop, types):
            return f'{{ r: {vals[0]}, g: {vals[1]}, b: {vals[2]}, a: {vals[3]} }}'
        return f'{{ x: {vals[0]}, y: {vals[1]}, z: {vals[2]}, w: {vals[3]} }}'
    if t in TypeSystem.PRIMITIVE_TYPES:
        return format_number(raw)
    return '0'
