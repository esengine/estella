#!/usr/bin/env python3
"""
EHT - ESEngine Header Tool

Parses C++ headers marked with ES_COMPONENT/ES_PROPERTY/ES_ENUM macros
and generates:
  - Emscripten embind bindings (WebBindings.generated.cpp)
  - TypeScript definitions (esengine.d.ts)

Usage:
    python tools/eht.py [--input DIR] [--output DIR] [--verbose]
"""

import re
import argparse
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set


# =============================================================================
# Data Structures
# =============================================================================

@dataclass
class Property:
    name: str
    cpp_type: str
    default_value: Optional[str] = None
    annotations: Dict[str, str] = field(default_factory=dict)


@dataclass
class Component:
    name: str
    namespace: str
    properties: List[Property] = field(default_factory=list)
    header_path: str = ""


@dataclass
class Enum:
    name: str
    namespace: str
    values: List[str] = field(default_factory=list)
    underlying_type: str = "int"


# =============================================================================
# Type System
# =============================================================================

class TypeSystem:
    """Manages type mappings and conversions."""

    # Types that can be directly bound with value_object
    PRIMITIVE_TYPES = {
        'bool', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'f32', 'f64', 'float', 'double', 'int', 'unsigned'
    }

    # GLM types that are bound as value_objects
    GLM_TYPES = {'glm::vec2', 'glm::vec3', 'glm::vec4', 'glm::quat', 'glm::uvec2'}

    # Custom struct types with semantic field names (bound as value_objects)
    # Maps C++ type -> (TS interface name, [(field_name, cpp_member)])
    CUSTOM_STRUCT_TYPES = {
        'Padding': ('Padding', [('left', 'left'), ('top', 'top'), ('right', 'right'), ('bottom', 'bottom')]),
    }

    # Types that should be skipped entirely (too complex to bind)
    SKIP_TYPES = {'glm::mat4', 'std::function'}

    # Vector types that can be bound with register_vector
    VECTOR_TYPES = {'std::vector<Entity>': ('u32', 'VectorEntity', 'VectorEntity')}

    # C++ to TypeScript type mapping
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
        self.enum_names = set()
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

    def is_vector(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        return t in self.VECTOR_TYPES

    def is_skip(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
        if t in self.VECTOR_TYPES:
            return False
        if 'std::vector' in t:
            return True
        return any(skip in t for skip in self.SKIP_TYPES)

    def needs_wrapper(self, comp: Component) -> bool:
        for prop in comp.properties:
            if self.is_enum(prop.cpp_type) or self.is_handle(prop.cpp_type):
                return True
        return False

    def get_js_type(self, cpp_type: str) -> str:
        t = self.clean_type(cpp_type)
        if self.is_handle(t):
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
        if t in self.VECTOR_TYPES:
            return self.VECTOR_TYPES[t][2]
        if self.is_enum(t) or self.is_handle(t):
            return 'number'
        return 'any'


# =============================================================================
# C++ Parser
# =============================================================================

class CppParser:
    RE_NAMESPACE = re.compile(r'namespace\s+([\w:]+)\s*\{')
    RE_COMPONENT = re.compile(r'ES_COMPONENT\s*\(\s*\)\s*struct\s+(\w+)')
    RE_ENUM = re.compile(r'ES_ENUM\s*\(\s*\)\s*enum\s+class\s+(\w+)(?:\s*:\s*(\w+))?')
    RE_PROPERTY = re.compile(
        r'ES_PROPERTY\s*\(\s*([^)]*)\s*\)\s*'
        r'([^;]+?)\s+(\w+)\s*'
        r'(?:\{([^}]*)\}|=\s*([^;]+))?;'
    )
    RE_ENUM_VALUE = re.compile(r'(\w+)\s*(?:=\s*\d+)?\s*,?')

    def __init__(self):
        self.components: List[Component] = []
        self.enums: List[Enum] = []

    def parse_file(self, filepath: Path) -> None:
        content = filepath.read_text(encoding='utf-8')
        ns_match = self.RE_NAMESPACE.search(content)
        namespace = ns_match.group(1) if ns_match else ""
        self._parse_enums(content, namespace)
        self._parse_components(content, namespace, filepath)

    def _parse_enums(self, content: str, namespace: str) -> None:
        for match in self.RE_ENUM.finditer(content):
            enum_name = match.group(1)
            underlying = match.group(2) or "int"

            brace_start = content.find('{', match.end())
            if brace_start == -1:
                continue
            brace_end = content.find('};', brace_start)
            if brace_end == -1:
                continue

            enum_body = content[brace_start + 1:brace_end]
            values = [m.group(1) for m in self.RE_ENUM_VALUE.finditer(enum_body) if m.group(1)]

            self.enums.append(Enum(
                name=enum_name, namespace=namespace,
                values=values, underlying_type=underlying
            ))

    def _parse_components(self, content: str, namespace: str, filepath: Path) -> None:
        for match in self.RE_COMPONENT.finditer(content):
            comp_name = match.group(1)
            body_start = content.find('{', match.end())
            if body_start == -1:
                continue

            brace_count = 1
            body_end = body_start + 1
            while body_end < len(content) and brace_count > 0:
                if content[body_end] == '{':
                    brace_count += 1
                elif content[body_end] == '}':
                    brace_count -= 1
                body_end += 1

            body = content[body_start:body_end]
            component = Component(
                name=comp_name, namespace=namespace,
                header_path=str(filepath.as_posix())
            )

            for prop_match in self.RE_PROPERTY.finditer(body):
                annotations = self._parse_annotations(prop_match.group(1))
                cpp_type = prop_match.group(2).strip()
                prop_name = prop_match.group(3).strip()
                default = prop_match.group(4) or prop_match.group(5)
                component.properties.append(Property(
                    name=prop_name, cpp_type=cpp_type,
                    default_value=default.strip() if default else None,
                    annotations=annotations
                ))

            self.components.append(component)

    @staticmethod
    def _parse_annotations(raw: str) -> Dict[str, str]:
        result: Dict[str, str] = {}
        for token in raw.split(','):
            token = token.strip()
            if not token:
                continue
            if '=' in token:
                key, value = token.split('=', 1)
                result[key.strip()] = value.strip()
            else:
                result[token] = 'true'
        return result

    def parse_directory(self, dirpath: Path) -> None:
        for filepath in dirpath.rglob('*.hpp'):
            try:
                self.parse_file(filepath)
            except Exception as e:
                print(f"Warning: Failed to parse {filepath}: {e}")


# =============================================================================
# Embind Generator
# =============================================================================

class EmbindGenerator:
    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.enums = enums
        self.types = TypeSystem(enums)

    def generate(self) -> str:
        lines = self._gen_header()
        lines.extend(self._gen_includes())
        lines.extend(self._gen_math_types())
        lines.extend(self._gen_enums())
        lines.extend(self._gen_components())
        lines.extend(self._gen_registry())
        lines.append('')
        lines.append('#endif  // ES_PLATFORM_WEB')
        lines.append('')
        return '\n'.join(lines)

    def _gen_header(self) -> List[str]:
        return [
            '/**',
            ' * @file    WebBindings.generated.cpp',
            ' * @brief   Auto-generated Emscripten embind bindings',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' *',
            ' * @copyright Copyright (c) 2026 ESEngine Team',
            ' */',
            '',
            '#ifdef ES_PLATFORM_WEB',
            '',
            '#include <emscripten/bind.h>',
            '#include "../ecs/Registry.hpp"',
            '#include "../math/Math.hpp"',
            '#include "../core/UITypes.hpp"',
        ]

    def _gen_includes(self) -> List[str]:
        headers = set()
        for comp in self.components:
            if comp.header_path and 'src/esengine/' in comp.header_path:
                rel = '../' + comp.header_path.replace('\\', '/').split('src/esengine/')[-1]
                headers.add(f'#include "{rel}"')
        headers.add('#include "../ecs/TransformSystem.hpp"')
        lines = sorted(headers)
        lines.extend([
            '',
            'using namespace emscripten;',
            'using namespace esengine;',
            'using namespace esengine::ecs;',
            '',
        ])
        return lines

    def _gen_math_types(self) -> List[str]:
        return [
            '// =============================================================================',
            '// Math Types',
            '// =============================================================================',
            '',
            'EMSCRIPTEN_BINDINGS(esengine_math) {',
            '    value_object<glm::vec2>("Vec2")',
            '        .field("x", &glm::vec2::x)',
            '        .field("y", &glm::vec2::y);',
            '',
            '    value_object<glm::vec3>("Vec3")',
            '        .field("x", &glm::vec3::x)',
            '        .field("y", &glm::vec3::y)',
            '        .field("z", &glm::vec3::z);',
            '',
            '    value_object<glm::vec4>("Vec4")',
            '        .field("x", &glm::vec4::x)',
            '        .field("y", &glm::vec4::y)',
            '        .field("z", &glm::vec4::z)',
            '        .field("w", &glm::vec4::w);',
            '',
            '    value_object<glm::uvec2>("UVec2")',
            '        .field("x", &glm::uvec2::x)',
            '        .field("y", &glm::uvec2::y);',
            '',
            '    value_object<glm::quat>("Quat")',
            '        .field("w", &glm::quat::w)',
            '        .field("x", &glm::quat::x)',
            '        .field("y", &glm::quat::y)',
            '        .field("z", &glm::quat::z);',
            '',
            '    value_object<esengine::Padding>("Padding")',
            '        .field("left", &esengine::Padding::left)',
            '        .field("top", &esengine::Padding::top)',
            '        .field("right", &esengine::Padding::right)',
            '        .field("bottom", &esengine::Padding::bottom);',
            '}',
            '',
        ]

    def _gen_enums(self) -> List[str]:
        if not self.enums:
            return []
        lines = [
            '// =============================================================================',
            '// Enums',
            '// =============================================================================',
            '',
            'EMSCRIPTEN_BINDINGS(esengine_enums) {',
        ]
        for enum in self.enums:
            full = f'{enum.namespace}::{enum.name}' if enum.namespace else enum.name
            lines.append(f'    enum_<{full}>("{enum.name}")')
            for val in enum.values:
                lines.append(f'        .value("{val}", {full}::{val})')
            lines[-1] += ';'
            lines.append('')
        lines.append('}')
        lines.append('')
        return lines

    def _gen_components(self) -> List[str]:
        lines = [
            '// =============================================================================',
            '// Components',
            '// =============================================================================',
            '',
        ]

        # Generate JS wrappers for components that need them
        for comp in self.components:
            if not self.types.needs_wrapper(comp):
                continue

            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            js = f'{comp.name}JS'

            # JS struct
            lines.append(f'struct {js} {{')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type):
                    continue
                js_type = self.types.get_js_type(prop.cpp_type)
                lines.append(f'    {js_type} {prop.name};')
            lines.append('};')
            lines.append('')

            # fromJS
            lines.append(f'{full} {comp.name.lower()}FromJS(const {js}& js) {{')
            lines.append(f'    {full} c;')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type):
                    continue
                t = self.types.clean_type(prop.cpp_type)
                if self.types.is_handle(t):
                    lines.append(f'    c.{prop.name} = {t}(js.{prop.name});')
                elif self.types.is_enum(t):
                    lines.append(f'    c.{prop.name} = static_cast<{t}>(js.{prop.name});')
                else:
                    lines.append(f'    c.{prop.name} = js.{prop.name};')
            lines.append('    return c;')
            lines.append('}')
            lines.append('')

            # toJS
            lines.append(f'{js} {comp.name.lower()}ToJS(const {full}& c) {{')
            lines.append(f'    {js} js;')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type):
                    continue
                if self.types.is_handle(prop.cpp_type):
                    lines.append(f'    js.{prop.name} = c.{prop.name}.id();')
                elif self.types.is_enum(prop.cpp_type):
                    lines.append(f'    js.{prop.name} = static_cast<i32>(c.{prop.name});')
                else:
                    lines.append(f'    js.{prop.name} = c.{prop.name};')
            lines.append('    return js;')
            lines.append('}')
            lines.append('')

        # value_object bindings
        lines.append('EMSCRIPTEN_BINDINGS(esengine_components) {')

        # Register vector types needed by component properties
        registered_vectors = set()
        for comp in self.components:
            for prop in comp.properties:
                t = self.types.clean_type(prop.cpp_type)
                if t in self.types.VECTOR_TYPES:
                    elem_type, js_name, _ = self.types.VECTOR_TYPES[t]
                    if js_name not in registered_vectors:
                        lines.append(f'    register_vector<{elem_type}>("{js_name}");')
                        lines.append('')
                        registered_vectors.add(js_name)

        for comp in self.components:
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            needs_wrap = self.types.needs_wrapper(comp)
            bind = f'{comp.name}JS' if needs_wrap else full

            lines.append(f'    value_object<{bind}>("{comp.name}")')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type):
                    continue
                lines.append(f'        .field("{prop.name}", &{bind}::{prop.name})')
            lines[-1] += ';'
            lines.append('')
        lines.append('}')
        lines.append('')
        return lines

    def _gen_registry(self) -> List[str]:
        lines = [
            '// =============================================================================',
            '// Registry',
            '// =============================================================================',
            '',
            'EMSCRIPTEN_BINDINGS(esengine_registry) {',
            '    class_<Registry>("Registry")',
            '        .constructor<>()',
            '        .function("create", optional_override([](Registry& r) {',
            '            return static_cast<u32>(r.create());',
            '        }))',
            '        .function("destroy", optional_override([](Registry& r, u32 e) {',
            '            r.destroy(static_cast<Entity>(e));',
            '        }))',
            '        .function("valid", optional_override([](Registry& r, u32 e) {',
            '            return r.valid(static_cast<Entity>(e));',
            '        }))',
            '        .function("entityCount", &Registry::entityCount)',
            '',
        ]

        for comp in self.components:
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            name = comp.name
            needs_wrap = self.types.needs_wrapper(comp)
            js = f'{name}JS'
            from_js = f'{name.lower()}FromJS'
            to_js = f'{name.lower()}ToJS'

            lines.append(f'        // {name}')
            lines.append(f'        .function("has{name}", optional_override([](Registry& r, u32 e) {{')
            lines.append(f'            return r.has<{full}>(static_cast<Entity>(e));')
            lines.append('        }))')

            if needs_wrap:
                lines.append(f'        .function("get{name}", optional_override([](Registry& r, u32 e) {{')
                lines.append(f'            auto entity = static_cast<Entity>(e);')
                lines.append(f'            if (!r.valid(entity) || !r.has<{full}>(entity)) return {js}{{}};')
                lines.append(f'            return {to_js}(r.get<{full}>(entity));')
                lines.append('        }))')
                lines.append(f'        .function("add{name}", optional_override([](Registry& r, u32 e, const {js}& js) {{')
                lines.append(f'            auto entity = static_cast<Entity>(e);')
                lines.append(f'            if (!r.valid(entity)) return;')
                lines.append(f'            r.emplaceOrReplace<{full}>(entity, {from_js}(js));')
                lines.append('        }))')
            else:
                lines.append(f'        .function("get{name}", optional_override([](Registry& r, u32 e) -> {full}& {{')
                lines.append(f'            auto entity = static_cast<Entity>(e);')
                lines.append(f'            static {full} s_dummy{{}};')
                lines.append(f'            if (!r.valid(entity) || !r.has<{full}>(entity)) return s_dummy;')
                if name == 'Transform':
                    lines.append(f'            auto& t = r.get<{full}>(entity);')
                    lines.append(f'            t.ensureDecomposed();')
                    lines.append(f'            return t;')
                else:
                    lines.append(f'            return r.get<{full}>(entity);')
                lines.append('        }), allow_raw_pointers())')
                lines.append(f'        .function("add{name}", optional_override([](Registry& r, u32 e, const {full}& c) {{')
                lines.append(f'            auto entity = static_cast<Entity>(e);')
                lines.append(f'            if (!r.valid(entity)) return;')
                lines.append(f'            r.emplaceOrReplace<{full}>(entity, c);')
                lines.append('        }))')

            lines.append(f'        .function("remove{name}", optional_override([](Registry& r, u32 e) {{')
            lines.append(f'            auto entity = static_cast<Entity>(e);')
            lines.append(f'            if (!r.valid(entity) || !r.has<{full}>(entity)) return;')
            lines.append(f'            r.remove<{full}>(entity);')
            lines.append('        }))')
            lines.append('')

        lines.extend([
            '        // Hierarchy Utilities',
            '        .function("setParent", optional_override([](Registry& r, u32 child, u32 parent) {',
            '            esengine::ecs::setParent(r, static_cast<Entity>(child), static_cast<Entity>(parent));',
            '        }))',
            '',
        ])
        lines.append('        ;')
        lines.append('}')
        return lines


# =============================================================================
# TypeScript Generator
# =============================================================================

class TypeScriptGenerator:
    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.enums = enums
        self.types = TypeSystem(enums)

    def generate(self) -> str:
        lines = self._gen_header()
        lines.extend(self._gen_enums())
        lines.extend(self._gen_components())
        lines.extend(self._gen_registry())
        lines.extend(self._gen_module())
        return '\n'.join(lines)

    def _gen_header(self) -> List[str]:
        return [
            '/**',
            ' * @file    wasm.generated.ts',
            ' * @brief   ESEngine WASM Bindings TypeScript Definitions',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            'import type { Entity, Vec2, Vec3, Vec4, Quat } from \'./types\';',
            '',
            '// Additional Math Types',
            'export interface UVec2 { x: number; y: number; }',
            'export interface Padding { left: number; top: number; right: number; bottom: number; }',
            'export type Mat4 = number[];',
            '',
            '// Emscripten Vector Types',
            'export interface VectorEntity {',
            '    size(): number;',
            '    get(index: number): number;',
            '    push_back(value: number): void;',
            '    set(index: number, value: number): boolean;',
            '    delete(): void;',
            '}',
            '',
        ]

    def _gen_enums(self) -> List[str]:
        if not self.enums:
            return []
        lines = ['// Enums', '']
        for enum in self.enums:
            lines.append(f'export enum {enum.name} {{')
            for i, val in enumerate(enum.values):
                lines.append(f'    {val} = {i},')
            lines.append('}')
            lines.append('')
        return lines

    def _gen_components(self) -> List[str]:
        lines = ['// Components', '']
        for comp in self.components:
            lines.append(f'export interface {comp.name} {{')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type):
                    continue
                ts = self.types.to_typescript(prop.cpp_type)
                lines.append(f'    {prop.name}: {ts};')
            lines.append('}')
            lines.append('')
        return lines

    def _gen_registry(self) -> List[str]:
        lines = [
            '// Registry',
            'export interface Registry {',
            '    create(): Entity;',
            '    destroy(entity: Entity): void;',
            '    valid(entity: Entity): boolean;',
            '    entityCount(): number;',
            '',
        ]
        for comp in self.components:
            n = comp.name
            lines.extend([
                f'    has{n}(entity: Entity): boolean;',
                f'    get{n}(entity: Entity): {n};',
                f'    add{n}(entity: Entity, component: {n}): void;',
                f'    remove{n}(entity: Entity): void;',
            ])
        lines.extend([
            '',
            '    // Hierarchy Utilities',
            '    setParent(child: Entity, parent: Entity): void;',
        ])
        lines.append('}')
        lines.append('')
        return lines

    def _gen_module(self) -> List[str]:
        lines = [
            '// Module',
            'export interface ESEngineModule {',
            '    Registry: new () => Registry;',
        ]
        for comp in self.components:
            lines.append(f'    {comp.name}: new () => {comp.name};')
        lines.extend([
            '}',
            ''
        ])
        return lines


# =============================================================================
# Metadata Generator
# =============================================================================

class MetadataGenerator:
    """Generates component.generated.ts with defaults and metadata."""

    COLOR_FIELD_PATTERNS = {'color', 'Color', 'tint', 'Tint'}

    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.enums = enums
        self.types = TypeSystem(enums)
        self._enum_values = self._build_enum_value_map()

    def _build_enum_value_map(self) -> Dict[str, Dict[str, int]]:
        result: Dict[str, Dict[str, int]] = {}
        for enum in self.enums:
            vals: Dict[str, int] = {}
            for i, v in enumerate(enum.values):
                vals[v] = i
            result[enum.name] = vals
            if enum.namespace:
                result[f'{enum.namespace}::{enum.name}'] = vals
        return result

    def _is_color_field(self, prop: Property) -> bool:
        t = self.types.clean_type(prop.cpp_type)
        if t != 'glm::vec4':
            return False
        return any(pat in prop.name for pat in self.COLOR_FIELD_PATTERNS)

    def _convert_default(self, prop: Property) -> str:
        t = self.types.clean_type(prop.cpp_type)
        raw = prop.default_value

        if self.types.is_handle(t):
            return '0'
        if t == 'std::string':
            if raw and raw.startswith('"') and raw.endswith('"'):
                return raw
            return "''"
        if t in self.types.VECTOR_TYPES:
            return '[]'
        if t == 'Padding':
            return '{ left: 0, top: 0, right: 0, bottom: 0 }'
        if raw and 'static_cast' in raw:
            m = re.search(r'(\w+)::(\w+)', raw)
            if m:
                enum_name, val_name = m.group(1), m.group(2)
                for key, vals in self._enum_values.items():
                    if key.endswith(enum_name) or key == enum_name:
                        if val_name in vals:
                            return str(vals[val_name])
        if self.types.is_enum(t):
            enum_short = t.split('::')[-1]
            if raw and '::' in raw:
                val_name = raw.split('::')[-1].strip()
                for key, vals in self._enum_values.items():
                    if key.endswith(enum_short) or key == enum_short:
                        if val_name in vals:
                            return str(vals[val_name])
            return '0'
        if t == 'bool':
            return 'true' if raw == 'true' else 'false'
        if t == 'glm::quat':
            vals = self._parse_float_list(raw, 4)
            return f'{{ w: {vals[0]}, x: {vals[1]}, y: {vals[2]}, z: {vals[3]} }}'
        if t == 'glm::vec2':
            vals = self._parse_float_list(raw, 2)
            return f'{{ x: {vals[0]}, y: {vals[1]} }}'
        if t == 'glm::uvec2':
            vals = self._parse_int_list(raw, 2)
            return f'{{ x: {vals[0]}, y: {vals[1]} }}'
        if t == 'glm::vec3':
            vals = self._parse_float_list(raw, 3)
            return f'{{ x: {vals[0]}, y: {vals[1]}, z: {vals[2]} }}'
        if t == 'glm::vec4':
            vals = self._parse_float_list(raw, 4)
            if self._is_color_field(prop):
                return f'{{ r: {vals[0]}, g: {vals[1]}, b: {vals[2]}, a: {vals[3]} }}'
            return f'{{ x: {vals[0]}, y: {vals[1]}, z: {vals[2]}, w: {vals[3]} }}'
        if t in TypeSystem.PRIMITIVE_TYPES:
            return self._format_number(raw)
        return '0'

    @staticmethod
    def _parse_float_list(raw: Optional[str], count: int) -> List[str]:
        if not raw:
            return ['0'] * count
        raw = raw.strip()
        parts = [p.strip().rstrip('fF') for p in raw.split(',')]
        if len(parts) == 1:
            val = MetadataGenerator._format_number(parts[0])
            return [val] * count
        result = [MetadataGenerator._format_number(p) for p in parts[:count]]
        while len(result) < count:
            result.append('0')
        return result

    @staticmethod
    def _parse_int_list(raw: Optional[str], count: int) -> List[str]:
        if not raw:
            return ['0'] * count
        parts = [p.strip() for p in raw.split(',')]
        result = parts[:count]
        while len(result) < count:
            result.append('0')
        return result

    @staticmethod
    def _format_number(raw: Optional[str]) -> str:
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

    def _get_asset_fields(self, comp: Component) -> List[Dict[str, str]]:
        fields = []
        for prop in comp.properties:
            asset_type = prop.annotations.get('asset')
            if asset_type and asset_type not in ('spine_skeleton', 'spine_atlas'):
                fields.append({'field': prop.name, 'type': asset_type})
        return fields

    def _get_spine_descriptor(self, comp: Component) -> Optional[Dict[str, str]]:
        skel_field = atlas_field = None
        for prop in comp.properties:
            asset_type = prop.annotations.get('asset')
            if asset_type == 'spine_skeleton':
                skel_field = prop.name
            elif asset_type == 'spine_atlas':
                atlas_field = prop.name
        if skel_field and atlas_field:
            return {'skeletonField': skel_field, 'atlasField': atlas_field}
        return None

    def _get_entity_fields(self, comp: Component) -> List[str]:
        return [p.name for p in comp.properties if 'entity_ref' in p.annotations]

    def _get_color_fields(self, comp: Component) -> List[str]:
        return [p.name for p in comp.properties if self._is_color_field(p)]

    def _get_animatable_fields(self, comp: Component) -> List[str]:
        fields = []
        for prop in comp.properties:
            if 'animatable' not in prop.annotations:
                continue
            t = self.types.clean_type(prop.cpp_type)
            if t == 'glm::vec2':
                fields.extend([f'{prop.name}.x', f'{prop.name}.y'])
            elif t == 'glm::vec3':
                fields.extend([f'{prop.name}.x', f'{prop.name}.y', f'{prop.name}.z'])
            elif t == 'glm::vec4':
                if self._is_color_field(prop):
                    fields.extend([f'{prop.name}.r', f'{prop.name}.g', f'{prop.name}.b', f'{prop.name}.a'])
                else:
                    fields.extend([f'{prop.name}.x', f'{prop.name}.y', f'{prop.name}.z', f'{prop.name}.w'])
            elif t == 'glm::quat':
                fields.append(f'{prop.name}.z')
            else:
                fields.append(prop.name)
        return fields

    def generate(self) -> str:
        lines = [
            '/**',
            ' * @file    component.generated.ts',
            ' * @brief   Auto-generated component metadata',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            "import type { AssetFieldType } from './scene';",
            '',
            'export interface AssetFieldMeta {',
            '    field: string;',
            '    type: AssetFieldType;',
            '}',
            '',
            'export interface SpineFieldMeta {',
            '    skeletonField: string;',
            '    atlasField: string;',
            '}',
            '',
            'export interface ComponentMetaEntry {',
            '    defaults: Record<string, unknown>;',
            '    assetFields: AssetFieldMeta[];',
            '    spine?: SpineFieldMeta;',
            '    entityFields: string[];',
            '    colorFields: string[];',
            '    animatableFields: string[];',
            '}',
            '',
            'export const COMPONENT_META: Record<string, ComponentMetaEntry> = {',
        ]

        for comp in self.components:
            if not comp.properties:
                continue

            asset_fields = self._get_asset_fields(comp)
            spine = self._get_spine_descriptor(comp)
            entity_fields = self._get_entity_fields(comp)
            color_fields = self._get_color_fields(comp)
            animatable = self._get_animatable_fields(comp)

            lines.append(f'    {comp.name}: {{')
            lines.append('        defaults: {')
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type) and prop.cpp_type not in self.types.VECTOR_TYPES:
                    continue
                val = self._convert_default(prop)
                lines.append(f'            {prop.name}: {val},')
            lines.append('        },')

            if asset_fields:
                parts = ', '.join(
                    f"{{ field: '{f['field']}', type: '{f['type']}' as AssetFieldType }}"
                    for f in asset_fields
                )
                lines.append(f'        assetFields: [{parts}],')
            else:
                lines.append('        assetFields: [],')

            if spine:
                lines.append(
                    f"        spine: {{ skeletonField: '{spine['skeletonField']}', "
                    f"atlasField: '{spine['atlasField']}' }},"
                )

            if entity_fields:
                parts = ', '.join(f"'{f}'" for f in entity_fields)
                lines.append(f'        entityFields: [{parts}],')
            else:
                lines.append('        entityFields: [],')

            if color_fields:
                parts = ', '.join(f"'{f}'" for f in color_fields)
                lines.append(f'        colorFields: [{parts}],')
            else:
                lines.append('        colorFields: [],')

            if animatable:
                parts = ', '.join(f"'{f}'" for f in animatable)
                lines.append(f'        animatableFields: [{parts}],')
            else:
                lines.append('        animatableFields: [],')

            lines.append('    },')

        lines.append('};')
        lines.append('')
        return '\n'.join(lines)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='EHT - ESEngine Header Tool')
    parser.add_argument('--input', '-i', type=Path, nargs='+',
                        default=[Path('src/esengine/ecs/components')],
                        help='Input directories')
    parser.add_argument('--output', '-o', type=Path,
                        default=Path('src/esengine/bindings'),
                        help='Output directory for C++ bindings')
    parser.add_argument('--ts-output', type=Path, default=Path('sdk'),
                        help='Output directory for TypeScript')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    print("EHT - ESEngine Header Tool")

    cpp_parser = CppParser()
    for input_dir in args.input:
        print(f"Parsing: {input_dir}")
        cpp_parser.parse_directory(input_dir)

    if args.verbose:
        print(f"  Found {len(cpp_parser.enums)} enums")
        print(f"  Found {len(cpp_parser.components)} components")
        for comp in cpp_parser.components:
            print(f"    - {comp.name}: {len(comp.properties)} properties")

    if not cpp_parser.components:
        print("Warning: No components found!")
        return 1

    args.output.mkdir(parents=True, exist_ok=True)
    embind_path = args.output / 'WebBindings.generated.cpp'
    print(f"Generating: {embind_path}")
    embind_gen = EmbindGenerator(cpp_parser.components, cpp_parser.enums)
    embind_path.write_text(embind_gen.generate(), encoding='utf-8')

    ts_gen = TypeScriptGenerator(cpp_parser.components, cpp_parser.enums)
    ts_content = ts_gen.generate()

    args.ts_output.mkdir(parents=True, exist_ok=True)
    ts_path = args.ts_output / 'wasm.generated.ts'
    print(f"Generating: {ts_path}")
    ts_path.write_text(ts_content, encoding='utf-8')

    ts_src_path = args.ts_output / 'src' / 'wasm.generated.ts'
    if ts_src_path.parent.exists():
        print(f"Generating: {ts_src_path}")
        ts_src_path.write_text(ts_content, encoding='utf-8')

    meta_gen = MetadataGenerator(cpp_parser.components, cpp_parser.enums)
    meta_content = meta_gen.generate()

    meta_path = args.ts_output / 'src' / 'component.generated.ts'
    if meta_path.parent.exists():
        print(f"Generating: {meta_path}")
        meta_path.write_text(meta_content, encoding='utf-8')

    print("[OK] Done!")
    return 0


if __name__ == '__main__':
    exit(main())
