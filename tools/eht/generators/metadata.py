"""Component metadata generator (component.generated.ts)."""

import json
from typing import Dict, List, Optional, Tuple
from ..data import Component, Enum, Property
from ..type_system import TypeSystem
from ..field_utils import (
    is_color_field, build_enum_value_map, convert_default_ts, format_number,
)


class MetadataGenerator:
    """Generates component.generated.ts with defaults and metadata."""

    def __init__(self, components: List[Component], enums: List[Enum],
                 abi_hash: str = ''):
        self.components = components
        self.enums = enums
        self.types = TypeSystem(enums)
        self._enum_values = build_enum_value_map(enums)
        self.abi_hash = abi_hash

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
        return [p.name for p in comp.properties if is_color_field(p, self.types)]

    def _get_field_meta(self, comp: Component) -> List[Tuple[str, List[Tuple[str, str]]]]:
        """Build per-field editor-presentation metadata (the FieldMeta shape) from
        ES_PROPERTY annotations. `enum`/`flags`/`gradient`/`curve` are intentionally
        absent — they carry runtime TS constants (e.g. enumOptions(...)) and stay as
        TS-side defineBuiltin overrides; everything expressible as a static annotation
        is authored at the C++ site. Returns [(field, [(metaKey, jsLiteral), ...])].
        """
        out: List[Tuple[str, List[Tuple[str, str]]]] = []
        for prop in comp.properties:
            a = prop.annotations
            entries: List[Tuple[str, str]] = []
            if 'min' in a:
                entries.append(('min', format_number(a['min'])))
            if 'max' in a:
                entries.append(('max', format_number(a['max'])))
            if 'step' in a:
                entries.append(('step', format_number(a['step'])))
            if 'slider' in a:
                entries.append(('slider', 'true'))
            if 'unit' in a:
                entries.append(('unit', json.dumps(a['unit'], ensure_ascii=False)))
            if 'label' in a:
                entries.append(('label', json.dumps(a['label'], ensure_ascii=False)))
            if 'tooltip' in a:
                entries.append(('tooltip', json.dumps(a['tooltip'], ensure_ascii=False)))
            if 'category' in a:
                entries.append(('category', json.dumps(a['category'], ensure_ascii=False)))
            if 'advanced' in a:
                entries.append(('advanced', 'true'))
            if 'enum_source' in a:
                entries.append(('enumSource', json.dumps(a['enum_source'], ensure_ascii=False)))
            if 'bitmask_source' in a:
                entries.append(('bitmask', '{ source: ' + json.dumps(a['bitmask_source'], ensure_ascii=False) + ' }'))
            if entries:
                out.append((prop.name, entries))
        return out

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
                if is_color_field(prop, self.types):
                    fields.extend([f'{prop.name}.r', f'{prop.name}.g', f'{prop.name}.b', f'{prop.name}.a'])
                else:
                    fields.extend([f'{prop.name}.x', f'{prop.name}.y', f'{prop.name}.z', f'{prop.name}.w'])
            elif t == 'glm::quat':
                fields.append(f'{prop.name}.z')
            else:
                fields.append(prop.name)
        return fields

    # TS helper types a generated data interface field may reference (imported from
    # './types'); custom-struct names (Padding/Dimension/VisualState) come instead
    # from './wasm.generated'.
    _BASE_TS_TYPES = {'Entity', 'Vec2', 'Vec3', 'Vec4', 'Quat', 'Color'}

    def _data_ts_type(self, prop: Property) -> str:
        """TS type for a component-DATA field — the plain serialized shape, not the
        embind/Registry shape `TypeSystem.to_typescript` produces (which maps vectors
        to emscripten wrappers and is color-blind). A color vec4 -> Color, an entity
        ref -> Entity, an Entity vector -> Entity[], glm vecs -> their {x,y,..} types,
        a registered custom struct -> its own interface name."""
        t = self.types.clean_type(prop.cpp_type)
        if is_color_field(prop, self.types):
            return 'Color'
        # Vectors before the scalar entity check: `entity_ref` also tags
        # `std::vector<Entity>` (Children.entities), which must stay an array.
        if self.types.is_entity_vector(t):
            return 'Entity[]'
        if self.types.is_struct_vector(t):
            return f'{self.types.vector_elem(t)}[]'
        if self.types.is_handle(t):
            return 'number'
        if 'entity_ref' in prop.annotations or self.types.is_entity(t):
            return 'Entity'
        if self.types.is_enum(t):
            return 'number'
        if t in self.types.CUSTOM_STRUCTS:
            return t
        if t in ('glm::vec2', 'glm::uvec2'):
            return 'Vec2'
        if t == 'glm::vec3':
            return 'Vec3'
        if t == 'glm::vec4':
            return 'Vec4'
        if t == 'glm::quat':
            return 'Quat'
        if t == 'std::string':
            return 'string'
        if t == 'bool':
            return 'boolean'
        return 'number'

    def _gen_interfaces(self):
        """Emit one `export interface <Name>Data` per component (the C++ field shape),
        and report which './types' and './wasm.generated' helper types are referenced
        so generate() can import exactly those. The skip rule matches the defaults
        loop so each interface lists exactly the fields its defaults object carries."""
        lines: List[str] = [
            '// C++-backed builtin component data shapes — the ES_COMPONENT struct fields,',
            '// generated so the TS field types cannot drift from the C++ structs. A consumer',
            '// adds any TS-only authoring field (e.g. Camera.showFrustum) by extending these.',
            '',
        ]
        used_base: set = set()
        used_struct: set = set()
        for comp in self.components:
            if not comp.properties:
                continue
            field_lines: List[str] = []
            for prop in comp.properties:
                if self.types.is_skip(prop.cpp_type) and prop.cpp_type not in self.types.VECTOR_TYPES:
                    continue
                ts = self._data_ts_type(prop)
                base = ts[:-2] if ts.endswith('[]') else ts
                if base in self._BASE_TS_TYPES:
                    used_base.add(base)
                elif base in self.types.CUSTOM_STRUCTS:
                    used_struct.add(base)
                field_lines.append(f'    {prop.name}: {ts};')
            lines.append(f'export interface {comp.name}Data {{')
            lines.extend(field_lines)
            lines.append('}')
            lines.append('')
        return lines, used_base, used_struct

    def generate(self) -> str:
        # Build the data interfaces first so we know which helper types to import.
        iface_lines, used_base, used_struct = self._gen_interfaces()

        lines = [
            '/**',
            ' * @file    component.generated.ts',
            ' * @brief   Auto-generated component metadata',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            "import type { AssetFieldType } from './scene';",
            "import type { FieldMeta } from './component';",
        ]
        if used_base:
            lines.append(f"import type {{ {', '.join(sorted(used_base))} }} from './types';")
        if used_struct:
            lines.append(f"import type {{ {', '.join(sorted(used_struct))} }} from './wasm.generated';")
        lines.append('')
        lines += [
            '/**',
            ' * Single-source-of-truth hash of the C++/TS boundary ABI (component',
            ' * schema + pointer layouts). The WASM module exposes the same digest via',
            ' * getAbiLayoutHash(); BuiltinBridge.connect() compares them and refuses to',
            ' * run on mismatch, because mismatched offsets read the wrong heap bytes.',
            ' */',
            f"export const ABI_LAYOUT_HASH = '{self.abi_hash}';",
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
            '    fields?: Record<string, FieldMeta>;',
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
                val = convert_default_ts(prop, self.types, self._enum_values)
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

            field_meta = self._get_field_meta(comp)
            if field_meta:
                lines.append('        fields: {')
                for fname, entries in field_meta:
                    parts = ', '.join(f'{k}: {v}' for k, v in entries)
                    lines.append(f'            {fname}: {{ {parts} }},')
                lines.append('        },')

            lines.append('    },')

        lines.append('};')
        lines.append('')
        lines.extend(iface_lines)
        return '\n'.join(lines)
