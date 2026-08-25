// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtins.ts
 * @brief   Engine component shapes, from EHT's table rather than a second copy.
 *
 * @details PTR_LAYOUTS is generated from the C++ structs and is what the SDK's
 *          accessors and the ABI hash already agree on. The compiler consumes it
 *          for the same reason: a component's fields must have exactly one
 *          author.
 *
 *          Resources have no such table yet — `Time` is spelled out below and
 *          marked, because a shape with no generator is exactly the drift this
 *          file exists to avoid.
 */
import { PTR_LAYOUTS } from '../../sdk/src/wasm/ptrLayouts.generated';
import { RESOURCE_NAMES, RESOURCE_SHAPES } from '../../sdk/src/ecs/resourceShapes';
import { BOOL, F64, HOST_ENC, type CompShape, type FieldSpec, type LeafEnc } from './eir';

/** Leaf member names per composite field, in memory order. Every one is f32. */
const MEMBERS: Record<string, readonly string[]> = {
    vec2: ['x', 'y'],
    vec3: ['x', 'y', 'z'],
    vec4: ['x', 'y', 'z', 'w'],
    quat: ['x', 'y', 'z', 'w'],
    color: ['r', 'g', 'b', 'a'],
};

/** EHT's field type -> how those bytes are encoded. */
const ENC: Record<string, LeafEnc> = {
    f32: 'f32', bool: 'bool8', i32: 'i32', u32: 'u32', u8: 'u8',
};

function engineLeaf(t: string, offset: number): FieldSpec {
    const enc = ENC[t] ?? 'f32';
    return { type: enc === 'bool8' ? BOOL : F64, enc, offset };
}

/**
 * Every engine component EHT emits a layout for, flattened to leaf paths.
 * `Transform` becomes `position.x`, `position.y`, … so a place's path is the
 * key, which is what lets a later pass fold it to a constant offset.
 */
export function builtinShapes(): Map<string, CompShape> {
    const out = new Map<string, CompShape>();
    for (const [name, layout] of Object.entries(PTR_LAYOUTS)) {
        const fields = new Map<string, FieldSpec>();
        for (const f of layout.fields) {
            const members = MEMBERS[f.type];
            if (members) {
                // A composite is four-byte members laid end to end from the
                // field's own offset — the same arithmetic ptrAccessors does.
                members.forEach((m, i) => fields.set(`${f.name}.${m}`, engineLeaf('f32', f.offset + i * 4)));
            } else if (f.type === 'struct') {
                for (const m of f.members ?? []) {
                    fields.set(`${f.name}.${m.name}`, engineLeaf(m.type, f.offset + m.offset));
                }
            } else {
                fields.set(f.name, engineLeaf(f.type, f.offset));
            }
        }
        // EHT's table IS the engine's flat pools, so everything from it is
        // engine-stored. Nothing downstream has to ask by name.
        out.set(name, { name, storage: 'engine', fields });
    }
    for (const [name, shape] of Object.entries(RESOURCE_SHAPES)) {
        out.set(name, resourceShape(name, shape));
    }
    return out;
}

/**
 * A resource's shape, from the SDK's own declaration: a host record, so f64
 * throughout and laid out by the ABI rather than by EHT. The field ORDER is the
 * declaration order, and it IS the layout.
 */
function resourceShape(name: string, shape: Readonly<Record<string, number | boolean>>): CompShape {
    const fields = new Map<string, FieldSpec>();
    for (const [field, value] of Object.entries(shape)) {
        fields.set(field, {
            type: typeof value === 'boolean' ? BOOL : F64,
            enc: HOST_ENC,
            offset: null,
        });
    }
    return { name, storage: 'host', fields };
}

/** Which host-stored shapes are resources; see `abi.ts`, which asks. */
export function resourceNames(): readonly string[] {
    return RESOURCE_NAMES;
}

/**
 * EHT's table, flattened for the handshake. It stamps the OFFSETS rather
 * than importing `ABI_LAYOUT_HASH`: that constant lives in
 * `component.generated.ts`, whose imports reach the whole SDK runtime. The raw
 * table is more information than a hash of it, and changes for the same reason.
 */
export function ehtStamp(): string {
    const parts: string[] = [];
    for (const [name, layout] of Object.entries(PTR_LAYOUTS)) {
        const fields = layout.fields
            .map((f) => `${f.name}:${f.type}@${f.offset}`
                + (f.members ? `{${f.members.map((m) => `${m.name}:${m.type}@${m.offset}`).join(',')}}` : ''))
            .join(',');
        parts.push(`${name}(${layout.ptrFn})=${fields}`);
    }
    return parts.join(';');
}
