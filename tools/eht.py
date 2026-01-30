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
from typing import List, Dict, Optional


# =============================================================================
# Data Structures
# =============================================================================

@dataclass
class Property:
    name: str
    cpp_type: str
    default_value: Optional[str] = None


@dataclass
class Method:
    name: str
    return_type: str
    params: List[tuple]
    is_const: bool = False


@dataclass
class Component:
    name: str
    namespace: str
    properties: List[Property] = field(default_factory=list)
    methods: List[Method] = field(default_factory=list)
    header_path: str = ""


@dataclass
class Enum:
    name: str
    namespace: str
    values: List[str] = field(default_factory=list)
    underlying_type: str = "int"


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
    RE_METHOD = re.compile(
        r'ES_METHOD\s*\(([^)]*)\)\s*'
        r'(\w+(?:\s*[*&])?)\s+(\w+)\s*\(([^)]*)\)'
    )
    RE_ENUM_VALUE = re.compile(r'(\w+)\s*(?:=\s*\d+)?\s*,?')

    def __init__(self):
        self.components: List[Component] = []
        self.enums: List[Enum] = []

    def parse_file(self, filepath: Path) -> None:
        content = filepath.read_text(encoding='utf-8')
        ns_match = self.RE_NAMESPACE.search(content)
        namespace = ns_match.group(1) if ns_match else ""
        self._parse_enums(content, namespace, filepath)
        self._parse_components(content, namespace, filepath)

    def _parse_enums(self, content: str, namespace: str, filepath: Path) -> None:
        for match in self.RE_ENUM.finditer(content):
            enum_name = match.group(1)
            underlying = match.group(2) or "int"

            start = match.end()
            brace_start = content.find('{', start)
            if brace_start == -1:
                continue

            brace_end = content.find('};', brace_start)
            if brace_end == -1:
                continue

            enum_body = content[brace_start + 1:brace_end]
            clean_body = re.sub(r'ES_ENUM_VALUE\s*\([^)]*\)', '', enum_body)
            values = [m.group(1) for m in self.RE_ENUM_VALUE.finditer(clean_body)]
            values = [v for v in values if v]

            self.enums.append(Enum(
                name=enum_name,
                namespace=namespace,
                values=values,
                underlying_type=underlying
            ))

    def _parse_components(self, content: str, namespace: str, filepath: Path) -> None:
        for match in self.RE_COMPONENT.finditer(content):
            comp_name = match.group(1)
            comp_start = match.end()

            body_start = content.find('{', comp_start)
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
                name=comp_name,
                namespace=namespace,
                header_path=str(filepath.as_posix())
            )

            for prop_match in self.RE_PROPERTY.finditer(body):
                cpp_type = prop_match.group(1).strip()
                prop_name = prop_match.group(2).strip()
                default = prop_match.group(3) or prop_match.group(4)

                component.properties.append(Property(
                    name=prop_name,
                    cpp_type=cpp_type,
                    default_value=default.strip() if default else None
                ))

            for method_match in self.RE_METHOD.finditer(body):
                attrs = method_match.group(1).strip()
                ret_type = method_match.group(2).strip()
                method_name = method_match.group(3).strip()
                params_str = method_match.group(4).strip()

                params = []
                if params_str:
                    for p in params_str.split(','):
                        p = p.strip()
                        if p:
                            parts = p.rsplit(None, 1)
                            if len(parts) == 2:
                                params.append((parts[0], parts[1]))

                component.methods.append(Method(
                    name=method_name,
                    return_type=ret_type,
                    params=params,
                    is_const='const' in attrs
                ))

            self.components.append(component)

    def parse_directory(self, dirpath: Path) -> None:
        for filepath in dirpath.rglob('*.hpp'):
            try:
                self.parse_file(filepath)
            except Exception as e:
                print(f"Warning: Failed to parse {filepath}: {e}")


# =============================================================================
# Type Mapping
# =============================================================================

class TypeMapper:
    CPP_TO_TS = {
        'bool': 'boolean',
        'i8': 'number', 'i16': 'number', 'i32': 'number', 'i64': 'number',
        'u8': 'number', 'u16': 'number', 'u32': 'number', 'u64': 'number',
        'f32': 'number', 'f64': 'number',
        'float': 'number', 'double': 'number',
        'int': 'number', 'unsigned': 'number',
        'std::string': 'string',
        'Entity': 'number',
        'glm::vec2': 'Vec2',
        'glm::vec3': 'Vec3',
        'glm::vec4': 'Vec4',
        'glm::quat': 'Quat',
        'glm::mat4': 'Mat4',
        'glm::uvec2': 'UVec2',
        'glm::ivec2': 'Vec2',
    }

    EMBIND_VALUE_TYPES = {'glm::vec2', 'glm::vec3', 'glm::vec4', 'glm::quat'}
    OPAQUE_TYPES = {'glm::mat4', 'glm::uvec2', 'resource::TextureHandle'}

    @classmethod
    def to_typescript(cls, cpp_type: str) -> str:
        cpp_type = cpp_type.replace('const', '').replace('&', '').strip()
        return cls.CPP_TO_TS.get(cpp_type, 'any')

    @classmethod
    def is_opaque(cls, cpp_type: str) -> bool:
        cpp_type = cpp_type.replace('const', '').replace('&', '').strip()
        return cpp_type in cls.OPAQUE_TYPES


# =============================================================================
# Code Generators
# =============================================================================

class EmbindGenerator:
    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.enums = enums

    def generate(self) -> str:
        lines = [
            '/**',
            ' * @file    WebBindings.generated.cpp',
            ' * @brief   Auto-generated Emscripten embind bindings',
            ' * @details Generated by EHT (ESEngine Header Tool) - DO NOT EDIT',
            ' *',
            ' * @author  ESEngine Team',
            ' * @date    2026',
            ' *',
            ' * @copyright Copyright (c) 2026 ESEngine Team',
            ' *            Licensed under the MIT License.',
            ' */',
            '',
            '#ifdef ES_PLATFORM_WEB',
            '',
            '#include <emscripten/bind.h>',
            '#include "../ecs/Registry.hpp"',
            '#include "../math/Math.hpp"',
            '',
        ]

        # Include component headers
        headers = set()
        for comp in self.components:
            if comp.header_path:
                # Convert to relative include path (always use forward slashes)
                rel = comp.header_path.replace('\\', '/')
                if 'src/esengine/' in rel:
                    rel = '../' + rel.split('src/esengine/')[-1]
                headers.add(f'#include "{rel}"')

        lines.extend(sorted(headers))
        lines.extend([
            '',
            'using namespace emscripten;',
            'using namespace esengine;',
            'using namespace esengine::ecs;',
            '',
        ])

        # Generate math type bindings
        lines.extend(self._gen_math_types())

        # Generate enum bindings
        lines.extend(self._gen_enums())

        # Generate component bindings
        lines.extend(self._gen_components())

        # Generate Registry bindings
        lines.extend(self._gen_registry())

        lines.extend([
            '',
            '#endif  // ES_PLATFORM_WEB',
            ''
        ])

        return '\n'.join(lines)

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
            full_name = f'{enum.namespace}::{enum.name}' if enum.namespace else enum.name
            lines.append(f'    enum_<{full_name}>("{enum.name}")')
            for value in enum.values:
                lines.append(f'        .value("{value}", {full_name}::{value})')
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
            'EMSCRIPTEN_BINDINGS(esengine_components) {',
        ]

        for comp in self.components:
            full_name = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            lines.append(f'    // {comp.name}')
            lines.append(f'    value_object<{full_name}>("{comp.name}")')

            for prop in comp.properties:
                if TypeMapper.is_opaque(prop.cpp_type):
                    continue
                lines.append(f'        .field("{prop.name}", &{full_name}::{prop.name})')

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
            full_name = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            name = comp.name

            lines.extend([
                f'        // {name}',
                f'        .function("has{name}", optional_override([](Registry& r, u32 e) {{',
                f'            return r.has<{full_name}>(static_cast<Entity>(e));',
                '        }))',
                f'        .function("get{name}", optional_override([](Registry& r, u32 e) -> {full_name}& {{',
                f'            return r.get<{full_name}>(static_cast<Entity>(e));',
                '        }), allow_raw_pointers())',
                f'        .function("add{name}", optional_override([](Registry& r, u32 e, const {full_name}& c) {{',
                f'            r.emplaceOrReplace<{full_name}>(static_cast<Entity>(e), c);',
                '        }))',
                f'        .function("remove{name}", optional_override([](Registry& r, u32 e) {{',
                f'            r.remove<{full_name}>(static_cast<Entity>(e));',
                '        }))',
                '',
            ])

        lines.append('        ;')
        lines.append('}')
        return lines


class TypeScriptGenerator:
    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.enums = enums

    def generate(self) -> str:
        lines = [
            '/**',
            ' * @file    esengine.d.ts',
            ' * @brief   ESEngine TypeScript Definitions',
            ' * @details Generated by EHT (ESEngine Header Tool) - DO NOT EDIT',
            ' *',
            ' * @author  ESEngine Team',
            ' * @date    2026',
            ' *',
            ' * @copyright Copyright (c) 2026 ESEngine Team',
            ' *            Licensed under the MIT License.',
            ' */',
            '',
            '// =============================================================================',
            '// Core Types',
            '// =============================================================================',
            '',
            'export type Entity = number;',
            '',
            '// =============================================================================',
            '// Math Types',
            '// =============================================================================',
            '',
            'export interface Vec2 { x: number; y: number; }',
            'export interface Vec3 { x: number; y: number; z: number; }',
            'export interface Vec4 { x: number; y: number; z: number; w: number; }',
            'export interface UVec2 { x: number; y: number; }',
            'export interface Quat { w: number; x: number; y: number; z: number; }',
            'export type Mat4 = number[];',
            '',
        ]

        # Generate enums
        if self.enums:
            lines.extend([
                '// =============================================================================',
                '// Enums',
                '// =============================================================================',
                '',
            ])
            for enum in self.enums:
                lines.append(f'export enum {enum.name} {{')
                for i, value in enumerate(enum.values):
                    lines.append(f'    {value} = {i},')
                lines.append('}')
                lines.append('')

        # Generate components
        lines.extend([
            '// =============================================================================',
            '// Components',
            '// =============================================================================',
            '',
        ])
        for comp in self.components:
            lines.append(f'export interface {comp.name} {{')
            for prop in comp.properties:
                ts_type = TypeMapper.to_typescript(prop.cpp_type)
                lines.append(f'    {prop.name}: {ts_type};')
            lines.append('}')
            lines.append('')

        # Generate Registry interface
        lines.extend([
            '// =============================================================================',
            '// Registry',
            '// =============================================================================',
            '',
            'export interface Registry {',
            '    create(): Entity;',
            '    destroy(entity: Entity): void;',
            '    valid(entity: Entity): boolean;',
            '    entityCount(): number;',
            '',
        ])

        for comp in self.components:
            name = comp.name
            lines.extend([
                f'    has{name}(entity: Entity): boolean;',
                f'    get{name}(entity: Entity): {name};',
                f'    add{name}(entity: Entity, component: {name}): void;',
                f'    remove{name}(entity: Entity): void;',
            ])

        lines.append('}')
        lines.append('')

        # Module interface
        lines.extend([
            '// =============================================================================',
            '// Module',
            '// =============================================================================',
            '',
            'export interface ESEngineModule {',
            '    Registry: new () => Registry;',
        ])
        for comp in self.components:
            lines.append(f'    {comp.name}: new () => {comp.name};')
        lines.extend([
            '}',
            '',
            'export default function createModule(): Promise<ESEngineModule>;',
            ''
        ])

        return '\n'.join(lines)


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='EHT - ESEngine Header Tool',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--input', '-i',
        type=Path,
        default=Path('src/esengine/ecs/components'),
        help='Input directory containing component headers'
    )
    parser.add_argument(
        '--output', '-o',
        type=Path,
        default=Path('src/esengine/bindings'),
        help='Output directory for generated C++ bindings'
    )
    parser.add_argument(
        '--ts-output',
        type=Path,
        default=Path('bindings'),
        help='Output directory for TypeScript definitions'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Verbose output'
    )

    args = parser.parse_args()

    print(f"EHT - ESEngine Header Tool")
    print(f"Parsing: {args.input}")

    # Parse headers
    cpp_parser = CppParser()
    cpp_parser.parse_directory(args.input)

    if args.verbose:
        print(f"  Found {len(cpp_parser.enums)} enums")
        print(f"  Found {len(cpp_parser.components)} components")
        for comp in cpp_parser.components:
            print(f"    - {comp.name}: {len(comp.properties)} properties")

    if not cpp_parser.components:
        print("Warning: No components found!")
        return 1

    # Generate embind bindings
    args.output.mkdir(parents=True, exist_ok=True)
    embind_path = args.output / 'WebBindings.generated.cpp'

    print(f"Generating: {embind_path}")
    embind_gen = EmbindGenerator(cpp_parser.components, cpp_parser.enums)
    embind_path.write_text(embind_gen.generate(), encoding='utf-8')

    # Generate TypeScript definitions
    args.ts_output.mkdir(parents=True, exist_ok=True)
    ts_path = args.ts_output / 'esengine.d.ts'

    print(f"Generating: {ts_path}")
    ts_gen = TypeScriptGenerator(cpp_parser.components, cpp_parser.enums)
    ts_path.write_text(ts_gen.generate(), encoding='utf-8')

    print("[OK] EHT complete!")
    return 0


if __name__ == '__main__':
    exit(main())
