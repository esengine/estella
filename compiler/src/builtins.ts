// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtins.ts
 * @brief   Engine component shapes, from EHT's table rather than a second copy.
 *
 * @details PTR_LAYOUTS is generated from the C++ structs and is what the SDK's
 *          accessors and the ABI hash already agree on. The compiler consumes it
 *          for the same reason: a component's fields must have exactly one
 *          author (docs/REARCH_AOT.md §1.2).
 *
 *          Resources have no such table yet — `Time` is spelled out below and
 *          marked, because a shape with no generator is exactly the drift this
 *          file exists to avoid.
 */
import { PTR_LAYOUTS } from '../../sdk/src/wasm/ptrLayouts.generated';
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
    out.set('Time', TIME);
    return out;
}

// NOT generated. Resources have no EHT table, so this is a hand-written shape and
// will drift the moment Time gains a field. Generating it is owed before the
// compiler reads any resource beyond this one.
const TIME: CompShape = {
    name: 'Time',
    storage: 'host',
    fields: new Map<string, FieldSpec>(
        ['delta', 'elapsed', 'frameCount', 'fixedDelta', 'fixedAlpha', 'fixedTick', 'scale', 'unscaledDelta']
            .map((k) => [k, { type: F64, enc: HOST_ENC, offset: null }] as const)),
};

/**
 * EHT's table, flattened for the §2.5 handshake. It stamps the OFFSETS rather
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
