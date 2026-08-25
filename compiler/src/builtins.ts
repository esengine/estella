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
import { BOOL, F64, storageBits, type CompShape, type EirType, type FieldSpec, type Storage } from './eir';

/** Leaf member names per composite field, in memory order. */
const MEMBERS: Record<string, readonly string[]> = {
    vec2: ['x', 'y'],
    vec3: ['x', 'y', 'z'],
    vec4: ['x', 'y', 'z', 'w'],
    quat: ['x', 'y', 'z', 'w'],
    color: ['r', 'g', 'b', 'a'],
};

function leafSpec(t: string, storage: Storage): FieldSpec {
    return { type: t === 'bool' ? BOOL : F64, bits: storageBits(storage) };
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
                for (const m of members) fields.set(`${f.name}.${m}`, leafSpec('f32', 'engine'));
            } else if (f.type === 'struct') {
                for (const m of f.members ?? []) fields.set(`${f.name}.${m.name}`, leafSpec(m.type, 'engine'));
            } else {
                fields.set(f.name, leafSpec(f.type, 'engine'));
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
            .map((k) => [k, { type: F64, bits: 64 }] as const)),
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
