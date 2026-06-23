from typing import Dict, List, Optional, Set
from ..data import Component, Enum, Property
from ..type_system import TypeSystem
from ..field_utils import is_color_field


class PtrLayoutGenerator:
    """Generates ptrLayouts.generated.ts with computed struct field offsets."""

    TYPE_SIZES = {
        'bool': 1, 'u8': 1, 'i8': 1,
        'u16': 2, 'i16': 2,
        'f32': 4, 'i32': 4, 'u32': 4, 'float': 4, 'int': 4, 'unsigned': 4,
        'f64': 8, 'i64': 8, 'u64': 8, 'double': 8,
        'glm::vec2': 8, 'glm::uvec2': 8,
        'glm::vec3': 12,
        'glm::vec4': 16, 'glm::quat': 16,
    }

    TYPE_ALIGNS = {
        'bool': 1, 'u8': 1, 'i8': 1,
        'u16': 2, 'i16': 2,
        'f32': 4, 'i32': 4, 'u32': 4, 'float': 4, 'int': 4, 'unsigned': 4,
        'f64': 4, 'i64': 4, 'u64': 4, 'double': 4,
        'glm::vec2': 4, 'glm::uvec2': 4,
        'glm::vec3': 4,
        'glm::vec4': 4, 'glm::quat': 4,
    }

    CPP_TO_PTR_TYPE = {
        'bool': 'bool', 'u8': 'u8', 'i8': 'u8',
        'f32': 'f32', 'float': 'f32',
        'i32': 'i32', 'int': 'i32',
        'u32': 'u32', 'unsigned': 'u32',
        'glm::vec2': 'vec2', 'glm::uvec2': 'vec2',
        'glm::vec3': 'vec3',
        'glm::vec4': 'color', 'glm::quat': 'quat',
    }

    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.types = TypeSystem(enums)
        self.layouts: List[Dict] = []
        self._compute()

    # Sizes/alignments of space-occupying field types that are NOT exposed to
    # JS via the pointer path but still occupy bytes in the struct, so the
    # offset cursor must advance past them. Values are for the wasm32 target
    # (emscripten libc++), verified against the compiler. A field whose space
    # is not accounted for shifts every later field's offset — the exact bug
    # the generated static_asserts in WebBindings.generated.cpp now catch.
    NONPTR_SIZE_ALIGN = {
        'std::string': (12, 4),
        'glm::mat4': (64, 4),
    }

    ENUM_UNDERLYING_SIZE = {
        'u8': 1, 'i8': 1, 'bool': 1,
        'u16': 2, 'i16': 2,
        'u32': 4, 'i32': 4, 'int': 4, 'unsigned': 4,
        'u64': 8, 'i64': 8,
    }

    def _enum_size_align(self, t: str):
        for e in self.types.enums:
            if e.name == t or (e.namespace and f'{e.namespace}::{e.name}' == t):
                sz = self.ENUM_UNDERLYING_SIZE.get(e.underlying_type, 4)
                return (sz, sz)
        return (1, 1)

    def _custom_struct_size_align(self, t: str):
        """(size, align) of a registered POD struct under standard C++ layout —
        members placed in order with per-member alignment, struct size padded to
        its max member alignment. Matches the compiler (the generated
        static_assert(offsetof) on each following field proves it)."""
        offset = 0
        max_align = 1
        for _, member_cpp in self.types.CUSTOM_STRUCTS[t]:
            msize = self.TYPE_SIZES[member_cpp]
            malign = self.TYPE_ALIGNS[member_cpp]
            if offset % malign != 0:
                offset += malign - (offset % malign)
            offset += msize
            max_align = max(max_align, malign)
        if offset % max_align != 0:
            offset += max_align - (offset % max_align)
        return (offset, max_align)

    def _field_size_align(self, cpp_type: str):
        """Return (size, align) for ANY field type so the offset cursor can
        advance past it, or None if the size is genuinely unknown."""
        t = self.types.clean_type(cpp_type)
        if t in self.TYPE_SIZES:
            return (self.TYPE_SIZES[t], self.TYPE_ALIGNS[t])
        if t in self.types.CUSTOM_STRUCTS:
            return self._custom_struct_size_align(t)
        if self.types.is_handle(t):
            return (4, 4)
        if self.types.is_enum(t):
            return self._enum_size_align(t)
        if t in self.NONPTR_SIZE_ALIGN:
            return self.NONPTR_SIZE_ALIGN[t]
        if t.startswith('std::function'):
            return (24, 8)
        if t.startswith('std::vector') or t in self.types.VECTOR_TYPES:
            return (12, 4)
        return None

    def _get_ptr_type(self, cpp_type: str, prop: Property) -> Optional[str]:
        t = self.types.clean_type(cpp_type)
        if t in self.CPP_TO_PTR_TYPE:
            if t == 'glm::vec4':
                return 'color' if is_color_field(prop, self.types) else 'vec4'
            return self.CPP_TO_PTR_TYPE[t]
        if self.types.is_handle(t):
            return 'u32'
        if self.types.is_enum(t):
            return 'u8'
        return None

    def _compute(self):
        import sys
        for comp in self.components:
            fields = []
            offset = 0
            for prop in comp.properties:
                sa = self._field_size_align(prop.cpp_type)
                if sa is None:
                    # Unknown size — every later offset would be unreliable, so
                    # stop emitting accessors for this component rather than ship
                    # wrong offsets. (The static_asserts would catch it anyway.)
                    print(f"  WARNING: {comp.name}.{prop.name}: cannot size type "
                          f"'{prop.cpp_type}' for pointer layout; truncating accessors",
                          file=sys.stderr)
                    break
                size, align = sa
                if offset % align != 0:
                    offset += align - (offset % align)

                ptr_type = self._get_ptr_type(prop.cpp_type, prop)
                if ptr_type is not None:
                    fields.append({
                        'name': prop.name,
                        'type': ptr_type,
                        'offset': offset,
                    })
                offset += size

            if fields:
                full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
                self.layouts.append({
                    'name': comp.name,
                    'cpp_full': full,
                    'ptrFn': f'get{comp.name}Ptr',
                    'fields': fields,
                })

    def generate_layout_asserts(self) -> str:
        """Emit a C++ static_assert(offsetof) for every pointer-accessed field.

        This makes the *compiler* the authority on struct layout: EHT computes
        each offset, and these asserts prove the real compiler layout agrees.
        Any divergence (a reordered/retyped field, a packing surprise EHT's
        model doesn't capture) becomes a BUILD ERROR rather than a silent
        cross-boundary heap-corruption at runtime. Injected into the web-only
        WebBindings.generated.cpp, which already includes every component header.
        """
        lines = [
            '// =============================================================================',
            '// ABI Layout Asserts -- the compiler is the offset authority',
            '// =============================================================================',
            '// EHT computes each pointer-field offset; the asserts below prove the real',
            '// compiler layout matches. A failure here means the TS pointer accessors would',
            '// read the wrong bytes -- fix the struct or regenerate EHT. DO NOT EDIT.',
            '',
        ]
        for layout in self.layouts:
            full = layout['cpp_full']
            for f in layout['fields']:
                msg = f'ABI offset drift: {full}.{f["name"]} (EHT expected {f["offset"]})'
                lines.append(
                    f'static_assert(offsetof({full}, {f["name"]}) == {f["offset"]}, "{msg}");'
                )
        lines.append('')
        return '\n'.join(lines)

    def generate(self) -> str:
        lines = [
            '/**',
            ' * @file    ptrLayouts.generated.ts',
            ' * @brief   Auto-generated component pointer layouts',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            "type PtrFieldType = 'f32' | 'i32' | 'u32' | 'bool' | 'u8' | 'vec2' | 'vec3' | 'vec4' | 'quat' | 'color';",
            '',
            'interface PtrFieldDesc {',
            '    readonly name: string;',
            '    readonly type: PtrFieldType;',
            '    readonly offset: number;',
            '}',
            '',
            'export interface PtrLayout {',
            '    readonly ptrFn: string;',
            '    readonly fields: readonly PtrFieldDesc[];',
            '}',
            '',
            'export const PTR_LAYOUTS: Record<string, PtrLayout> = {',
        ]

        for layout in self.layouts:
            lines.append(f'    {layout["name"]}: {{')
            lines.append(f"        ptrFn: '{layout['ptrFn']}',")
            lines.append('        fields: [')
            for f in layout['fields']:
                lines.append(f"            {{ name: '{f['name']}', type: '{f['type']}', offset: {f['offset']} }},")
            lines.append('        ],')
            lines.append('    },')

        lines.extend(['};', ''])
        return '\n'.join(lines)

    def _ts_type_for(self, ptr_type: str) -> str:
        return {
            'f32': 'number', 'i32': 'number', 'u32': 'number',
            'bool': 'boolean', 'u8': 'number',
            'vec2': 'Vec2', 'vec3': 'Vec3', 'vec4': 'Vec4',
            'quat': 'Vec4', 'color': 'Color',
        }[ptr_type]

    def generate_accessors(self) -> str:
        lines = [
            '/**',
            ' * @file    ptrAccessors.generated.ts',
            ' * @brief   Auto-generated type-safe WASM pointer accessors',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            'interface Vec2 { x: number; y: number; }',
            'interface Vec3 { x: number; y: number; z: number; }',
            'interface Vec4 { x: number; y: number; z: number; w: number; }',
            'interface Color { r: number; g: number; b: number; a: number; }',
            '',
        ]

        accessor_names = []

        for layout in self.layouts:
            name = layout['name']
            fields = layout['fields']

            # Generate data interface
            lines.append(f'export interface {name}PtrData {{')
            for f in fields:
                ts_type = self._ts_type_for(f['type'])
                lines.append(f'    {f["name"]}: {ts_type};')
            lines.append('}')
            lines.append('')

            # Generate fill function (mutates pre-allocated object)
            lines.append(f'export function fill{name}(')
            lines.append(f'    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,')
            lines.append(f'    ptr: number, out: {name}PtrData,')
            lines.append(f'): void {{')
            for f in fields:
                byte_off = f['offset']
                idx_expr = f'(ptr + {byte_off}) >> 2' if byte_off else 'ptr >> 2'
                byte_expr = f'ptr + {byte_off}' if byte_off else 'ptr'
                ft = f['type']
                fn = f['name']
                if ft == 'f32':
                    lines.append(f'    out.{fn} = f32[{idx_expr}];')
                elif ft == 'i32':
                    lines.append(f'    out.{fn} = u32[{idx_expr}] | 0;')
                elif ft == 'u32':
                    lines.append(f'    out.{fn} = u32[{idx_expr}];')
                elif ft == 'bool':
                    lines.append(f'    out.{fn} = u8[{byte_expr}] !== 0;')
                elif ft == 'u8':
                    lines.append(f'    out.{fn} = u8[{byte_expr}];')
                elif ft == 'vec2':
                    lines.append(f'    const {fn}_ = out.{fn}; {fn}_.x = f32[{idx_expr}]; {fn}_.y = f32[({idx_expr}) + 1];')
                elif ft == 'vec3':
                    lines.append(f'    const {fn}_ = out.{fn}; {fn}_.x = f32[{idx_expr}]; {fn}_.y = f32[({idx_expr}) + 1]; {fn}_.z = f32[({idx_expr}) + 2];')
                elif ft in ('vec4', 'quat'):
                    lines.append(f'    const {fn}_ = out.{fn}; {fn}_.x = f32[{idx_expr}]; {fn}_.y = f32[({idx_expr}) + 1]; {fn}_.z = f32[({idx_expr}) + 2]; {fn}_.w = f32[({idx_expr}) + 3];')
                elif ft == 'color':
                    lines.append(f'    const {fn}_ = out.{fn}; {fn}_.r = f32[{idx_expr}]; {fn}_.g = f32[({idx_expr}) + 1]; {fn}_.b = f32[({idx_expr}) + 2]; {fn}_.a = f32[({idx_expr}) + 3];')
            lines.append('}')
            lines.append('')

            # Generate write function
            lines.append(f'export function write{name}(')
            lines.append(f'    f32: Float32Array, u32: Uint32Array, u8: Uint8Array,')
            lines.append(f'    ptr: number, data: {name}PtrData,')
            lines.append(f'): void {{')
            for f in fields:
                byte_off = f['offset']
                idx_expr = f'(ptr + {byte_off}) >> 2' if byte_off else 'ptr >> 2'
                byte_expr = f'ptr + {byte_off}' if byte_off else 'ptr'
                ft = f['type']
                fn = f['name']
                if ft == 'f32':
                    lines.append(f'    f32[{idx_expr}] = data.{fn};')
                elif ft == 'i32':
                    lines.append(f'    u32[{idx_expr}] = data.{fn} | 0;')
                elif ft == 'u32':
                    lines.append(f'    u32[{idx_expr}] = data.{fn};')
                elif ft == 'bool':
                    lines.append(f'    u8[{byte_expr}] = data.{fn} ? 1 : 0;')
                elif ft == 'u8':
                    lines.append(f'    u8[{byte_expr}] = data.{fn};')
                elif ft == 'vec2':
                    lines.append(f'    f32[{idx_expr}] = data.{fn}.x; f32[({idx_expr}) + 1] = data.{fn}.y;')
                elif ft == 'vec3':
                    lines.append(f'    f32[{idx_expr}] = data.{fn}.x; f32[({idx_expr}) + 1] = data.{fn}.y; f32[({idx_expr}) + 2] = data.{fn}.z;')
                elif ft in ('vec4', 'quat'):
                    lines.append(f'    f32[{idx_expr}] = data.{fn}.x; f32[({idx_expr}) + 1] = data.{fn}.y; f32[({idx_expr}) + 2] = data.{fn}.z; f32[({idx_expr}) + 3] = data.{fn}.w;')
                elif ft == 'color':
                    lines.append(f'    f32[{idx_expr}] = data.{fn}.r; f32[({idx_expr}) + 1] = data.{fn}.g; f32[({idx_expr}) + 2] = data.{fn}.b; f32[({idx_expr}) + 3] = data.{fn}.a;')
            lines.append('}')
            lines.append('')

            # Generate preallocate function
            lines.append(f'export function create{name}Data(): {name}PtrData {{')
            lines.append('    return {')
            for f in fields:
                ft = f['type']
                fn = f['name']
                if ft in ('f32', 'i32', 'u32', 'u8'):
                    lines.append(f'        {fn}: 0,')
                elif ft == 'bool':
                    lines.append(f'        {fn}: false,')
                elif ft == 'vec2':
                    lines.append(f'        {fn}: {{ x: 0, y: 0 }},')
                elif ft == 'vec3':
                    lines.append(f'        {fn}: {{ x: 0, y: 0, z: 0 }},')
                elif ft in ('vec4', 'quat'):
                    lines.append(f'        {fn}: {{ x: 0, y: 0, z: 0, w: 0 }},')
                elif ft == 'color':
                    lines.append(f'        {fn}: {{ r: 0, g: 0, b: 0, a: 0 }},')
            lines.append('    };')
            lines.append('}')
            lines.append('')

            accessor_names.append(name)

        # Generate accessor registry type
        lines.append('export interface PtrAccessor<T> {')
        lines.append('    fill: (f32: Float32Array, u32: Uint32Array, u8: Uint8Array, ptr: number, out: T) => void;')
        lines.append('    write: (f32: Float32Array, u32: Uint32Array, u8: Uint8Array, ptr: number, data: T) => void;')
        lines.append('    create: () => T;')
        lines.append('}')
        lines.append('')

        # Generate accessor map
        lines.append('export const PTR_ACCESSORS: Record<string, PtrAccessor<any>> = {')
        for name in accessor_names:
            lines.append(f'    {name}: {{ fill: fill{name}, write: write{name}, create: create{name}Data }},')
        lines.append('};')
        lines.append('')

        return '\n'.join(lines)
