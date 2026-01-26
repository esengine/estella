#!/usr/bin/env python3
"""
Binding Generator for ESEngine

This tool automatically generates JavaScript/TypeScript bindings for C++ components
marked with ES_COMPONENT() macros. It parses C++ headers and generates:
  1. WebBindings.generated.cpp - Emscripten embind bindings
  2. ECSBindings.generated.cpp - QuickJS bindings for native platform
  3. esengine.d.ts - TypeScript definition file

Usage:
    python generate_bindings.py --input src/esengine/ecs/components --output src/esengine/bindings
"""

import re
import os
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass, field


# =============================================================================
# Data Structures
# =============================================================================

@dataclass
class Property:
    """Represents a C++ property marked with ES_PROPERTY()"""
    name: str
    type: str
    default_value: Optional[str] = None


@dataclass
class Method:
    """Represents a C++ method marked with ES_METHOD()"""
    name: str
    return_type: str
    parameters: List[tuple]  # [(type, name), ...]
    is_const: bool = False
    is_static: bool = False


@dataclass
class Component:
    """Represents a C++ component marked with ES_COMPONENT()"""
    name: str
    namespace: str
    properties: List[Property] = field(default_factory=list)
    methods: List[Method] = field(default_factory=list)
    header_path: str = ""
    is_struct: bool = True  # True for struct, False for class


# =============================================================================
# Parser
# =============================================================================

class ComponentParser:
    """Parses C++ headers to extract component metadata"""

    # Regex patterns
    COMPONENT_PATTERN = re.compile(
        r'ES_COMPONENT\(\)\s*(?:struct|class)\s+(\w+)',
        re.MULTILINE
    )

    PROPERTY_PATTERN = re.compile(
        r'ES_PROPERTY\(\)\s*([^;]+?)\s+(\w+)(?:\s*\{([^}]*)\}|\s*=\s*([^;]+))?;',
        re.MULTILINE
    )

    METHOD_PATTERN = re.compile(
        r'ES_METHOD\((.*?)\)\s*([^(]+?)\s+(\w+)\s*\(([^)]*)\)',
        re.MULTILINE
    )

    NAMESPACE_PATTERN = re.compile(
        r'namespace\s+([\w:]+)\s*\{',
        re.MULTILINE
    )

    def __init__(self):
        self.components: List[Component] = []

    def parse_file(self, filepath: Path):
        """Parse a single C++ header file"""
        content = filepath.read_text(encoding='utf-8')

        # Extract namespace
        namespace_match = self.NAMESPACE_PATTERN.search(content)
        namespace = namespace_match.group(1) if namespace_match else ""

        # Find all components
        for match in self.COMPONENT_PATTERN.finditer(content):
            component_name = match.group(1)
            component_start = match.end()

            # Find the matching closing brace
            brace_count = 0
            component_end = component_start
            for i in range(component_start, len(content)):
                if content[i] == '{':
                    brace_count += 1
                elif content[i] == '}':
                    brace_count -= 1
                    if brace_count == -1:
                        component_end = i
                        break

            component_body = content[component_start:component_end]

            # Get relative path, handling both absolute and relative paths
            try:
                if filepath.is_absolute():
                    rel_path = filepath.relative_to(Path.cwd())
                else:
                    rel_path = filepath
            except ValueError:
                # If relative_to fails, just use the name
                rel_path = filepath.name

            component = Component(
                name=component_name,
                namespace=namespace,
                header_path=str(rel_path).replace('\\', '/')
            )

            # Parse properties
            for prop_match in self.PROPERTY_PATTERN.finditer(component_body):
                prop_type = prop_match.group(1).strip()
                prop_name = prop_match.group(2).strip()
                default_val = prop_match.group(3) or prop_match.group(4)

                component.properties.append(Property(
                    name=prop_name,
                    type=prop_type,
                    default_value=default_val.strip() if default_val else None
                ))

            # Parse methods
            for method_match in self.METHOD_PATTERN.finditer(component_body):
                attributes = method_match.group(1).strip()
                return_type = method_match.group(2).strip()
                method_name = method_match.group(3).strip()
                params_str = method_match.group(4).strip()

                # Parse parameters
                parameters = []
                if params_str:
                    for param in params_str.split(','):
                        param = param.strip()
                        if param:
                            parts = param.rsplit(None, 1)
                            if len(parts) == 2:
                                parameters.append((parts[0], parts[1]))

                component.methods.append(Method(
                    name=method_name,
                    return_type=return_type,
                    parameters=parameters,
                    is_const='const' in attributes,
                    is_static='static' in attributes
                ))

            self.components.append(component)

    def parse_directory(self, directory: Path):
        """Recursively parse all .hpp files in a directory"""
        for filepath in directory.rglob('*.hpp'):
            try:
                self.parse_file(filepath)
            except Exception as e:
                print(f"Warning: Failed to parse {filepath}: {e}", file=sys.stderr)


# =============================================================================
# Emscripten Binding Generator
# =============================================================================

class EmscriptenGenerator:
    """Generates Emscripten embind bindings"""

    def __init__(self, components: List[Component]):
        self.components = components

    def generate(self) -> str:
        """Generate complete WebBindings.generated.cpp file"""
        lines = [
            "/**",
            " * @file    WebBindings.generated.cpp",
            " * @brief   Auto-generated Emscripten bindings",
            " * @details Generated by tools/generate_bindings.py - DO NOT EDIT MANUALLY",
            " *",
            " * @author  ESEngine Binding Generator",
            " * @date    2026",
            " */",
            "",
            "#ifdef ES_PLATFORM_WEB",
            "",
            "#include <emscripten/bind.h>",
            "#include \"../ecs/Registry.hpp\"",
            "#include \"../ecs/Entity.hpp\"",
            "#include \"../math/Math.hpp\"",
            ""
        ]

        # Component headers
        included_headers = set()
        for component in self.components:
            rel_path = component.header_path.replace('src/esengine/', '')
            include_line = f'#include "../{rel_path}"'
            if include_line not in included_headers:
                lines.append(include_line)
                included_headers.add(include_line)

        lines.extend([
            "",
            "using namespace emscripten;",
            "",
            "namespace esengine {",
            "",
            "// =============================================================================",
            "// Math Types",
            "// =============================================================================",
            "",
            "EMSCRIPTEN_BINDINGS(esengine_math) {",
            "    // Vec2",
            "    value_object<glm::vec2>(\"Vec2\")",
            "        .field(\"x\", &glm::vec2::x)",
            "        .field(\"y\", &glm::vec2::y);",
            "",
            "    // Vec3",
            "    value_object<glm::vec3>(\"Vec3\")",
            "        .field(\"x\", &glm::vec3::x)",
            "        .field(\"y\", &glm::vec3::y)",
            "        .field(\"z\", &glm::vec3::z);",
            "",
            "    // Vec4",
            "    value_object<glm::vec4>(\"Vec4\")",
            "        .field(\"x\", &glm::vec4::x)",
            "        .field(\"y\", &glm::vec4::y)",
            "        .field(\"z\", &glm::vec4::z)",
            "        .field(\"w\", &glm::vec4::w);",
            "",
            "    // Quat",
            "    value_object<glm::quat>(\"Quat\")",
            "        .field(\"x\", &glm::quat::x)",
            "        .field(\"y\", &glm::quat::y)",
            "        .field(\"z\", &glm::quat::z)",
            "        .field(\"w\", &glm::quat::w);",
            "}",
            "",
            "// =============================================================================",
            "// ECS Entity Type",
            "// =============================================================================",
            "",
            "EMSCRIPTEN_BINDINGS(esengine_entity) {",
            "    // Entity is u32, exposed as number in JavaScript",
            "}",
            ""
        ])

        # Generate component bindings
        lines.extend(self._generate_components())

        # Generate Registry bindings
        lines.extend(self._generate_registry())

        lines.extend([
            "",
            "}  // namespace esengine",
            "",
            "#endif  // ES_PLATFORM_WEB",
            ""
        ])

        return '\n'.join(lines)

    def _generate_components(self) -> List[str]:
        """Generate bindings for all components"""
        lines = [
            "// =============================================================================",
            "// ECS Components",
            "// =============================================================================",
            "",
            "EMSCRIPTEN_BINDINGS(esengine_components) {"
        ]

        for component in self.components:
            full_name = f"{component.namespace}::{component.name}"

            lines.append(f"    // {component.name} component")
            lines.append(f'    value_object<{full_name}>("{component.name}")')

            for prop in component.properties:
                lines.append(f'        .field("{prop.name}", &{full_name}::{prop.name})')

            for method in component.methods:
                if not method.is_static:
                    lines.append(f'        .function("{method.name}", &{full_name}::{method.name})')

            lines.append("        ;")
            lines.append("")

        lines.append("}")
        lines.append("")

        return lines

    def _generate_registry(self) -> List[str]:
        """Generate Registry bindings with automatic component accessors"""
        lines = [
            "// =============================================================================",
            "// ECS Registry",
            "// =============================================================================",
            "",
            "EMSCRIPTEN_BINDINGS(esengine_registry) {",
            "    class_<ecs::Registry>(\"Registry\")",
            "        .constructor<>()",
            "",
            "        // Entity management",
            "        .function(\"create\", optional_override([](ecs::Registry& self) {",
            "            return self.create();",
            "        }))",
            "        .function(\"destroy\", optional_override([](ecs::Registry& self, Entity e) {",
            "            self.destroy(e);",
            "        }))",
            "        .function(\"valid\", optional_override([](ecs::Registry& self, Entity e) {",
            "            return self.valid(e);",
            "        }))",
            "        .function(\"entityCount\", optional_override([](const ecs::Registry& self) {",
            "            return self.entityCount();",
            "        }))",
            ""
        ]

        for component in self.components:
            full_name = f"{component.namespace}::{component.name}"
            camel_name = component.name

            lines.extend([
                f"        // {component.name} component",
                f'        .function("has{camel_name}", optional_override([](ecs::Registry& self, Entity e) {{',
                f"            return self.has<{full_name}>(e);",
                "        }))",
                f'        .function("get{camel_name}", optional_override([](ecs::Registry& self, Entity e) -> {full_name}& {{',
                f"            return self.get<{full_name}>(e);",
                "        }))",
                f'        .function("add{camel_name}", optional_override([](ecs::Registry& self, Entity e, const {full_name}& c) -> {full_name}& {{',
                f"            return self.emplaceOrReplace<{full_name}>(e, c);",
                "        }))",
                f'        .function("remove{camel_name}", optional_override([](ecs::Registry& self, Entity e) {{',
                f"            self.remove<{full_name}>(e);",
                "        }))",
                ""
            ])

        lines.append("        ;")
        lines.append("}")

        return lines


# =============================================================================
# TypeScript Definition Generator
# =============================================================================

class TypeScriptGenerator:
    """Generates TypeScript definition files"""

    def __init__(self, components: List[Component]):
        self.components = components

    def generate(self) -> str:
        """Generate complete esengine.d.ts file"""
        lines = [
            "/**",
            " * @file    esengine.d.ts",
            " * @brief   TypeScript definitions for ESEngine",
            " * @details Generated by tools/generate_bindings.py - DO NOT EDIT MANUALLY",
            " */",
            "",
            "declare namespace Module {",
            "    // =============================================================================",
            "    // Core Types",
            "    // =============================================================================",
            "",
            "    type Entity = number;",
            "",
            "    // =============================================================================",
            "    // Math Types",
            "    // =============================================================================",
            "",
            "    interface Vec2 {",
            "        x: number;",
            "        y: number;",
            "    }",
            "",
            "    interface Vec3 {",
            "        x: number;",
            "        y: number;",
            "        z: number;",
            "    }",
            "",
            "    interface Vec4 {",
            "        x: number;",
            "        y: number;",
            "        z: number;",
            "        w: number;",
            "    }",
            "",
            "    interface Quat {",
            "        x: number;",
            "        y: number;",
            "        z: number;",
            "        w: number;",
            "    }",
            "",
            "    // =============================================================================",
            "    // ECS Components",
            "    // =============================================================================",
            ""
        ]

        # Generate component interfaces
        for component in self.components:
            lines.append(f"    interface {component.name} {{")

            for prop in component.properties:
                ts_type = self._cpp_to_ts_type(prop.type)
                lines.append(f"        {prop.name}: {ts_type};")

            for method in component.methods:
                if not method.is_static:
                    params = ', '.join([f"{name}: {self._cpp_to_ts_type(ptype)}"
                                       for ptype, name in method.parameters])
                    ret_type = self._cpp_to_ts_type(method.return_type)
                    lines.append(f"        {method.name}({params}): {ret_type};")

            lines.append("    }")
            lines.append("")

        # Generate Registry interface
        lines.extend([
            "    // =============================================================================",
            "    // ECS Registry",
            "    // =============================================================================",
            "",
            "    class Registry {",
            "        constructor();",
            "",
            "        // Entity management",
            "        create(): Entity;",
            "        destroy(entity: Entity): void;",
            "        valid(entity: Entity): boolean;",
            "        entityCount(): number;",
            ""
        ])

        for component in self.components:
            lines.extend([
                f"        // {component.name} component",
                f"        has{component.name}(entity: Entity): boolean;",
                f"        get{component.name}(entity: Entity): {component.name};",
                f"        add{component.name}(entity: Entity, component: {component.name}): {component.name};",
                f"        remove{component.name}(entity: Entity): void;",
                ""
            ])

        lines.extend([
            "    }",
            "",
            "    // =============================================================================",
            "    // Module Lifecycle",
            "    // =============================================================================",
            "",
            "    function onRuntimeInitialized(): void;",
            "}",
            "",
            "export = Module;",
            "export as namespace Module;",
            ""
        ])

        return '\n'.join(lines)

    def _cpp_to_ts_type(self, cpp_type: str) -> str:
        """Convert C++ type to TypeScript type"""
        cpp_type = cpp_type.strip()

        # Basic types
        type_map = {
            'bool': 'boolean',
            'f32': 'number',
            'f64': 'number',
            'u8': 'number',
            'u16': 'number',
            'u32': 'number',
            'u64': 'number',
            'i8': 'number',
            'i16': 'number',
            'i32': 'number',
            'i64': 'number',
            'float': 'number',
            'double': 'number',
            'int': 'number',
            'unsigned': 'number',
            'size_t': 'number',
            'usize': 'number',
            'Entity': 'Entity',
            'std::string': 'string',
            'void': 'void'
        }

        # Remove const and references
        cpp_type = cpp_type.replace('const', '').replace('&', '').strip()

        # Check direct mapping
        if cpp_type in type_map:
            return type_map[cpp_type]

        # GLM types
        if cpp_type.startswith('glm::'):
            glm_type = cpp_type[5:]
            if glm_type in ['vec2', 'vec3', 'vec4', 'quat']:
                return glm_type.capitalize()

        # Default to any for unknown types
        return 'any'


# =============================================================================
# QuickJS Binding Generator
# =============================================================================

class QuickJSGenerator:
    """Generates QuickJS bindings for Native platform"""

    def __init__(self, components: List[Component]):
        self.components = components

    def generate(self) -> str:
        """Generate complete ECSBindings.generated.cpp file"""
        lines = [
            "/**",
            " * @file    ECSBindings.generated.cpp",
            " * @brief   Auto-generated QuickJS bindings for Native platform",
            " * @details Generated by tools/generate_bindings.py - DO NOT EDIT MANUALLY",
            " *",
            " * @author  ESEngine Binding Generator",
            " * @date    2026",
            " */",
            "",
            "#ifdef ES_SCRIPTING_ENABLED",
            "",
            "#include \"ECSBindings.hpp\"",
            "#include \"../../ecs/Registry.hpp\"",
            "#include \"../../math/Math.hpp\"",
            ""
        ]

        # Component headers
        included_headers = set()
        for component in self.components:
            rel_path = component.header_path.replace('src/esengine/', '')
            include_line = f'#include "../../{rel_path}"'
            if include_line not in included_headers:
                lines.append(include_line)
                included_headers.add(include_line)

        lines.extend([
            "",
            "namespace esengine::scripting {",
            "",
            "// Global registry pointer for C callbacks",
            "static ecs::Registry* g_registry = nullptr;",
            ""
        ])

        # Generate helper functions for type conversions
        lines.extend(self._generate_helpers())

        # Generate component binding functions
        for component in self.components:
            lines.extend(self._generate_component_bindings(component))

        # Generate main binding function
        lines.extend(self._generate_main_bind())

        lines.extend([
            "",
            "}  // namespace esengine::scripting",
            "",
            "#endif  // ES_SCRIPTING_ENABLED",
            ""
        ])

        return '\n'.join(lines)

    def _generate_helpers(self) -> List[str]:
        """Generate type conversion helper functions"""
        return [
            "// =============================================================================",
            "// Type Conversion Helpers",
            "// =============================================================================",
            "",
            "static glm::vec3 jsToVec3(JSContext* ctx, JSValue jsObj) {",
            "    glm::vec3 result(0.0f);",
            "    JSValue x = JS_GetPropertyStr(ctx, jsObj, \"x\");",
            "    JSValue y = JS_GetPropertyStr(ctx, jsObj, \"y\");",
            "    JSValue z = JS_GetPropertyStr(ctx, jsObj, \"z\");",
            "    double dx, dy, dz;",
            "    JS_ToFloat64(ctx, &dx, x);",
            "    JS_ToFloat64(ctx, &dy, y);",
            "    JS_ToFloat64(ctx, &dz, z);",
            "    result.x = static_cast<f32>(dx);",
            "    result.y = static_cast<f32>(dy);",
            "    result.z = static_cast<f32>(dz);",
            "    JS_FreeValue(ctx, x);",
            "    JS_FreeValue(ctx, y);",
            "    JS_FreeValue(ctx, z);",
            "    return result;",
            "}",
            "",
            "static JSValue vec3ToJS(JSContext* ctx, const glm::vec3& vec) {",
            "    JSValue obj = JS_NewObject(ctx);",
            "    JS_SetPropertyStr(ctx, obj, \"x\", JS_NewFloat64(ctx, vec.x));",
            "    JS_SetPropertyStr(ctx, obj, \"y\", JS_NewFloat64(ctx, vec.y));",
            "    JS_SetPropertyStr(ctx, obj, \"z\", JS_NewFloat64(ctx, vec.z));",
            "    return obj;",
            "}",
            "",
            "static glm::quat jsToQuat(JSContext* ctx, JSValue jsObj) {",
            "    glm::quat result(1.0f, 0.0f, 0.0f, 0.0f);",
            "    JSValue w = JS_GetPropertyStr(ctx, jsObj, \"w\");",
            "    JSValue x = JS_GetPropertyStr(ctx, jsObj, \"x\");",
            "    JSValue y = JS_GetPropertyStr(ctx, jsObj, \"y\");",
            "    JSValue z = JS_GetPropertyStr(ctx, jsObj, \"z\");",
            "    double dw, dx, dy, dz;",
            "    JS_ToFloat64(ctx, &dw, w);",
            "    JS_ToFloat64(ctx, &dx, x);",
            "    JS_ToFloat64(ctx, &dy, y);",
            "    JS_ToFloat64(ctx, &dz, z);",
            "    result.w = static_cast<f32>(dw);",
            "    result.x = static_cast<f32>(dx);",
            "    result.y = static_cast<f32>(dy);",
            "    result.z = static_cast<f32>(dz);",
            "    JS_FreeValue(ctx, w);",
            "    JS_FreeValue(ctx, x);",
            "    JS_FreeValue(ctx, y);",
            "    JS_FreeValue(ctx, z);",
            "    return result;",
            "}",
            "",
            "static JSValue quatToJS(JSContext* ctx, const glm::quat& quat) {",
            "    JSValue obj = JS_NewObject(ctx);",
            "    JS_SetPropertyStr(ctx, obj, \"w\", JS_NewFloat64(ctx, quat.w));",
            "    JS_SetPropertyStr(ctx, obj, \"x\", JS_NewFloat64(ctx, quat.x));",
            "    JS_SetPropertyStr(ctx, obj, \"y\", JS_NewFloat64(ctx, quat.y));",
            "    JS_SetPropertyStr(ctx, obj, \"z\", JS_NewFloat64(ctx, quat.z));",
            "    return obj;",
            "}",
            ""
        ]

    def _generate_component_bindings(self, component: Component) -> List[str]:
        """Generate QuickJS bindings for a single component"""
        lines = [
            f"// =============================================================================",
            f"// {component.name} Component Bindings",
            f"// =============================================================================",
            ""
        ]

        full_name = f"{component.namespace}::{component.name}"

        # Generate get method
        lines.extend([
            f"static JSValue js_Registry_get{component.name}(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv) {{",
            f"    u32 entity;",
            f"    JS_ToUint32(ctx, &entity, argv[0]);",
            f"    if (!g_registry->has<{full_name}>(entity)) {{",
            f'        return JS_ThrowReferenceError(ctx, "Entity does not have {component.name} component");',
            f"    }}",
            f"    auto& comp = g_registry->get<{full_name}>(entity);",
            f"    JSValue obj = JS_NewObject(ctx);",
        ])

        # Add property getters
        for prop in component.properties:
            if 'vec3' in prop.type:
                lines.append(f'    JS_SetPropertyStr(ctx, obj, "{prop.name}", vec3ToJS(ctx, comp.{prop.name}));')
            elif 'quat' in prop.type:
                lines.append(f'    JS_SetPropertyStr(ctx, obj, "{prop.name}", quatToJS(ctx, comp.{prop.name}));')
            elif 'f32' in prop.type or 'float' in prop.type:
                lines.append(f'    JS_SetPropertyStr(ctx, obj, "{prop.name}", JS_NewFloat64(ctx, comp.{prop.name}));')
            else:
                lines.append(f'    // TODO: Add converter for {prop.type}')

        lines.extend([
            f"    return obj;",
            f"}}",
            ""
        ])

        # Generate set method
        lines.extend([
            f"static JSValue js_Registry_add{component.name}(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv) {{",
            f"    u32 entity;",
            f"    JS_ToUint32(ctx, &entity, argv[0]);",
            f"    {full_name} comp;",
        ])

        # Parse properties from JS object
        for prop in component.properties:
            lines.append(f'    JSValue {prop.name}Val = JS_GetPropertyStr(ctx, argv[1], "{prop.name}");')
            if 'vec3' in prop.type:
                lines.append(f'    comp.{prop.name} = jsToVec3(ctx, {prop.name}Val);')
            elif 'quat' in prop.type:
                lines.append(f'    comp.{prop.name} = jsToQuat(ctx, {prop.name}Val);')
            elif 'f32' in prop.type or 'float' in prop.type:
                lines.extend([
                    f'    double d{prop.name};',
                    f'    JS_ToFloat64(ctx, &d{prop.name}, {prop.name}Val);',
                    f'    comp.{prop.name} = static_cast<f32>(d{prop.name});'
                ])
            lines.append(f'    JS_FreeValue(ctx, {prop.name}Val);')

        lines.extend([
            f"    g_registry->emplaceOrReplace<{full_name}>(entity, comp);",
            f"    return JS_UNDEFINED;",
            f"}}",
            ""
        ])

        return lines

    def _generate_main_bind(self) -> List[str]:
        """Generate main binding registration function"""
        lines = [
            "// =============================================================================",
            "// Main Binding Function",
            "// =============================================================================",
            "",
            "void bindECS(ScriptContext& ctx, ecs::Registry& registry) {",
            "    g_registry = &registry;",
            "    JSContext* jsCtx = ctx.getJSContext();",
            "    JSValue global = JS_GetGlobalObject(jsCtx);",
            "    JSValue registryObj = JS_NewObject(jsCtx);",
            "",
            "    // Entity management",
            "    JS_SetPropertyStr(jsCtx, registryObj, \"create\",",
            "                     JS_NewCFunction(jsCtx, js_Registry_create, \"create\", 0));",
            "    JS_SetPropertyStr(jsCtx, registryObj, \"destroy\",",
            "                     JS_NewCFunction(jsCtx, js_Registry_destroy, \"destroy\", 1));",
            "    JS_SetPropertyStr(jsCtx, registryObj, \"valid\",",
            "                     JS_NewCFunction(jsCtx, js_Registry_valid, \"valid\", 1));",
            ""
        ]

        # Register all component methods
        for component in self.components:
            lines.extend([
                f"    // {component.name} component",
                f'    JS_SetPropertyStr(jsCtx, registryObj, "get{component.name}",',
                f'                     JS_NewCFunction(jsCtx, js_Registry_get{component.name}, "get{component.name}", 1));',
                f'    JS_SetPropertyStr(jsCtx, registryObj, "add{component.name}",',
                f'                     JS_NewCFunction(jsCtx, js_Registry_add{component.name}, "add{component.name}", 2));',
                ""
            ])

        lines.extend([
            '    JS_SetPropertyStr(jsCtx, global, "Registry", registryObj);',
            "    JS_FreeValue(jsCtx, global);",
            "}",
            ""
        ])

        return lines


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Generate bindings for ESEngine components'
    )
    parser.add_argument(
        '--input',
        type=str,
        default='src/esengine/ecs/components',
        help='Input directory containing component headers'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='src/esengine/bindings',
        help='Output directory for generated bindings'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose output'
    )

    args = parser.parse_args()

    # Parse components
    print(f"Parsing components from: {args.input}")
    parser_obj = ComponentParser()
    parser_obj.parse_directory(Path(args.input))

    if args.verbose:
        print(f"Found {len(parser_obj.components)} components:")
        for comp in parser_obj.components:
            print(f"  - {comp.namespace}::{comp.name} ({len(comp.properties)} properties, {len(comp.methods)} methods)")

    if not parser_obj.components:
        print("Warning: No components found!", file=sys.stderr)
        return 1

    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate Emscripten bindings
    print("Generating Emscripten bindings...")
    emscripten_gen = EmscriptenGenerator(parser_obj.components)
    emscripten_code = emscripten_gen.generate()
    (output_dir / 'WebBindings.generated.cpp').write_text(emscripten_code, encoding='utf-8')

    # Generate TypeScript definitions
    print("Generating TypeScript definitions...")
    ts_gen = TypeScriptGenerator(parser_obj.components)
    ts_code = ts_gen.generate()
    (Path('bindings') / 'esengine.d.ts').write_text(ts_code, encoding='utf-8')

    # Generate QuickJS bindings
    print("Generating QuickJS bindings...")
    quickjs_gen = QuickJSGenerator(parser_obj.components)
    quickjs_code = quickjs_gen.generate()
    (Path('src/esengine/scripting/bindings') / 'ECSBindings.generated.cpp').write_text(quickjs_code, encoding='utf-8')

    print("[OK] Binding generation complete!")
    return 0


if __name__ == '__main__':
    sys.exit(main())
