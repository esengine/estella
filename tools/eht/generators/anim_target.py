from typing import Dict, List, Set
from ..data import Component, Enum
from ..type_system import TypeSystem
from ..field_utils import is_color_field, COLOR_FIELD_PATTERNS


class AnimTargetGenerator:
    """Generates animation target enum, apply function, and TS mappings."""

    # Sub-component expansions per GLM type
    VEC2_SUBS = [('x', 'x'), ('y', 'y')]
    VEC3_SUBS = [('x', 'x'), ('y', 'y'), ('z', 'z')]
    VEC4_COLOR_SUBS = [('r', 'r'), ('g', 'g'), ('b', 'b'), ('a', 'a')]
    QUAT_SUBS = [('z', 'z')]

    # UIRect anim_override flags per sub-component label
    OVERRIDE_FLAGS = {
        'position': {'x': 'ANIM_POS_X', 'y': 'ANIM_POS_Y'},
        'scale': {'x': 'ANIM_SCALE_X', 'y': 'ANIM_SCALE_Y'},
        'rotation': {'z': 'ANIM_ROT_Z'},
    }

    def __init__(self, components: List[Component], enums: List[Enum]):
        self.components = components
        self.types = TypeSystem(enums)
        self.entries: List[Dict] = []
        self._collect()

    def _collect(self):
        for comp in self.components:
            for prop in comp.properties:
                if 'animatable' not in prop.annotations:
                    continue
                t = self.types.clean_type(prop.cpp_type)
                has_override = 'anim_override' in prop.annotations
                is_color = any(pat in prop.name for pat in COLOR_FIELD_PATTERNS)

                if t == 'glm::vec2':
                    subs = self.VEC2_SUBS
                elif t == 'glm::vec3':
                    subs = self.VEC3_SUBS
                elif t == 'glm::vec4':
                    subs = self.VEC4_COLOR_SUBS if is_color else [('x', 'x'), ('y', 'y'), ('z', 'z'), ('w', 'w')]
                elif t == 'glm::quat':
                    subs = self.QUAT_SUBS
                else:
                    subs = [('', '')]

                for sub_label, sub_member in subs:
                    enum_name = self._make_enum_name(comp.name, prop.name, sub_label)
                    field_path = f'{prop.name}.{sub_label}' if sub_label else prop.name
                    cpp_member = f'{prop.name}.{sub_member}' if sub_member else prop.name

                    override_flag = None
                    if has_override:
                        flags = self.OVERRIDE_FLAGS.get(prop.name, {})
                        override_flag = flags.get(sub_label)

                    self.entries.append({
                        'enum_name': enum_name,
                        'comp_name': comp.name,
                        'field_path': field_path,
                        'cpp_member': cpp_member,
                        'cpp_type': t,
                        'is_quat_z': t == 'glm::quat' and sub_label == 'z',
                        'override_flag': override_flag,
                    })

    @staticmethod
    def _make_enum_name(comp: str, field: str, sub: str) -> str:
        parts = [comp, field[0].upper() + field[1:]]
        if sub:
            parts.append(sub.upper())
        return ''.join(parts)

    def generate_hpp(self) -> str:
        lines = [
            '#pragma once',
            '',
            '#include "../core/Types.hpp"',
            '#include "../ecs/Registry.hpp"',
        ]

        includes = set()
        for e in self.entries:
            includes.add(e['comp_name'])
        for comp in self.components:
            if comp.name in includes:
                lines.append(f'#include "../ecs/components/{comp.name}.hpp"')
        has_override = any(e['override_flag'] for e in self.entries)
        if has_override:
            lines.append('#include "../ecs/components/UIRect.hpp"')

        lines.extend([
            '',
            '#include <glm/glm.hpp>',
            '#include <cmath>',
            '',
            'namespace esengine::animation {',
            '',
        ])

        comp_names = []
        seen_comps: Set[str] = set()
        for e in self.entries:
            if e['comp_name'] not in seen_comps:
                seen_comps.add(e['comp_name'])
                comp_names.append(e['comp_name'])

        lines.append('enum class AnimTargetComponent : u8 {')
        for i, name in enumerate(comp_names):
            lines.append(f'    {name} = {i},')
        lines.extend([
            f'    Custom = {len(comp_names)},',
            '    COUNT',
            '};',
            '',
            'enum class AnimTargetField : u8 {',
        ])

        for i, e in enumerate(self.entries):
            lines.append(f'    {e["enum_name"]} = {i},')

        lines.extend([
            f'    CustomField = {len(self.entries)},',
            '    COUNT',
            '};',
            '',
            'inline void applyAnimatedValue(',
            '    ecs::Registry& registry, Entity entity,',
            '    AnimTargetField field, f32 value)',
            '{',
            '    switch (field) {',
        ])

        for e in self.entries:
            lines.append(f'        case AnimTargetField::{e["enum_name"]}:')
            comp_cpp = f'ecs::{e["comp_name"]}'
            if e['is_quat_z']:
                lines.append(f'            if (auto* c = registry.tryGet<{comp_cpp}>(entity)) {{')
                lines.append('                f32 h = value * 0.5f;')
                lines.append(f'                c->{e["cpp_member"].rsplit(".", 1)[0]} = glm::quat(std::cos(h), 0.0f, 0.0f, std::sin(h));')
                if e['override_flag']:
                    lines.append(f'                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::{e["override_flag"]};')
                lines.append('            }')
            else:
                lines.append(f'            if (auto* c = registry.tryGet<{comp_cpp}>(entity)) {{')
                lines.append(f'                c->{e["cpp_member"]} = value;')
                if e['override_flag']:
                    lines.append(f'                if (auto* r = registry.tryGet<ecs::UIRect>(entity)) r->anim_override_ |= ecs::UIRect::{e["override_flag"]};')
                lines.append('            }')
            lines.append('            break;')

        lines.extend([
            '        case AnimTargetField::CustomField:',
            '        default:',
            '            break;',
            '    }',
            '}',
            '',
            '}  // namespace esengine::animation',
            '',
        ])
        return '\n'.join(lines)

    def generate_ts(self) -> str:
        lines = [
            '/**',
            ' * @file    animTargets.generated.ts',
            ' * @brief   Auto-generated animation target mappings',
            ' * @details Generated by EHT - DO NOT EDIT',
            ' */',
            '',
            'export enum AnimTargetField {',
        ]

        for i, e in enumerate(self.entries):
            lines.append(f'    {e["enum_name"]} = {i},')

        lines.extend([
            f'    CustomField = {len(self.entries)},',
            '}',
            '',
            'export enum AnimTargetComponent {',
        ])

        comp_names = []
        seen = set()
        for e in self.entries:
            if e['comp_name'] not in seen:
                seen.add(e['comp_name'])
                comp_names.append(e['comp_name'])
        for i, name in enumerate(comp_names):
            lines.append(f'    {name} = {i},')
        lines.extend([
            f'    Custom = {len(comp_names)},',
            '}',
            '',
            'export const FIELD_MAP: Record<string, Record<string, AnimTargetField>> = {',
        ])

        by_comp: Dict[str, List[Dict]] = {}
        for e in self.entries:
            by_comp.setdefault(e['comp_name'], []).append(e)

        for comp_name, entries in by_comp.items():
            lines.append(f'    {comp_name}: {{')
            for e in entries:
                lines.append(f"        '{e['field_path']}': AnimTargetField.{e['enum_name']},")
            lines.append('    },')

        lines.extend([
            '};',
            '',
            'export const COMPONENT_MAP: Record<string, AnimTargetComponent> = {',
        ])
        for name in comp_names:
            lines.append(f'    {name}: AnimTargetComponent.{name},')
        lines.extend([
            '};',
            '',
        ])
        return '\n'.join(lines)
