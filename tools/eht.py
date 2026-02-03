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

    # Types that should be skipped entirely (too complex to bind)
    SKIP_TYPES = {'glm::mat4', 'std::vector', 'std::function'}

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

    def is_skip(self, cpp_type: str) -> bool:
        t = self.clean_type(cpp_type)
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
        return t

    def to_typescript(self, cpp_type: str) -> str:
        t = self.clean_type(cpp_type)
        if t in self.CPP_TO_TS:
            return self.CPP_TO_TS[t]
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
        r'ES_PROPERTY\s*\(\s*\)\s*'
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
                cpp_type = prop_match.group(1).strip()
                prop_name = prop_match.group(2).strip()
                default = prop_match.group(3) or prop_match.group(4)
                component.properties.append(Property(
                    name=prop_name, cpp_type=cpp_type,
                    default_value=default.strip() if default else None
                ))

            self.components.append(component)

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
        ]

    def _gen_includes(self) -> List[str]:
        headers = set()
        for comp in self.components:
            if comp.header_path and 'src/esengine/' in comp.header_path:
                rel = '../' + comp.header_path.replace('\\', '/').split('src/esengine/')[-1]
                headers.add(f'#include "{rel}"')
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
                lines.append(f'            return {to_js}(r.get<{full}>(static_cast<Entity>(e)));')
                lines.append('        }))')
                lines.append(f'        .function("add{name}", optional_override([](Registry& r, u32 e, const {js}& js) {{')
                lines.append(f'            r.emplaceOrReplace<{full}>(static_cast<Entity>(e), {from_js}(js));')
                lines.append('        }))')
            else:
                lines.append(f'        .function("get{name}", optional_override([](Registry& r, u32 e) -> {full}& {{')
                lines.append(f'            return r.get<{full}>(static_cast<Entity>(e));')
                lines.append('        }), allow_raw_pointers())')
                lines.append(f'        .function("add{name}", optional_override([](Registry& r, u32 e, const {full}& c) {{')
                lines.append(f'            r.emplaceOrReplace<{full}>(static_cast<Entity>(e), c);')
                lines.append('        }))')

            lines.append(f'        .function("remove{name}", optional_override([](Registry& r, u32 e) {{')
            lines.append(f'            r.remove<{full}>(static_cast<Entity>(e));')
            lines.append('        }))')
            lines.append('')

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
            'export type Mat4 = number[];',
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

    args.ts_output.mkdir(parents=True, exist_ok=True)
    ts_path = args.ts_output / 'wasm.generated.ts'
    print(f"Generating: {ts_path}")
    ts_gen = TypeScriptGenerator(cpp_parser.components, cpp_parser.enums)
    ts_path.write_text(ts_gen.generate(), encoding='utf-8')

    print("[OK] Done!")
    return 0


if __name__ == '__main__':
    exit(main())
