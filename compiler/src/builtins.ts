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
import { BOOL, F64, type CompShape, type EirType } from './eir';

/** Leaf member names per composite field, in memory order. */
const MEMBERS: Record<string, readonly string[]> = {
    vec2: ['x', 'y'],
    vec3: ['x', 'y', 'z'],
    vec4: ['x', 'y', 'z', 'w'],
    quat: ['x', 'y', 'z', 'w'],
    color: ['r', 'g', 'b', 'a'],
};

function leafType(t: string): EirType {
    return t === 'bool' ? BOOL : F64;
}

/**
 * Every engine component EHT emits a layout for, flattened to leaf paths.
 * `Transform` becomes `position.x`, `position.y`, … so a place's path is the
 * key, which is what lets a later pass fold it to a constant offset.
 */
export function builtinShapes(): Map<string, CompShape> {
    const out = new Map<string, CompShape>();
    for (const [name, layout] of Object.entries(PTR_LAYOUTS)) {
        const fields = new Map<string, EirType>();
        for (const f of layout.fields) {
            const members = MEMBERS[f.type];
            if (members) {
                for (const m of members) fields.set(`${f.name}.${m}`, F64);
            } else if (f.type === 'struct') {
                for (const m of f.members ?? []) fields.set(`${f.name}.${m.name}`, leafType(m.type));
            } else {
                fields.set(f.name, leafType(f.type));
            }
        }
        out.set(name, { name, fields });
    }
    out.set('Time', TIME);
    return out;
}

// NOT generated. Resources have no EHT table, so this is a hand-written shape and
// will drift the moment Time gains a field. Generating it is owed before the
// compiler reads any resource beyond this one.
const TIME: CompShape = {
    name: 'Time',
    fields: new Map<string, EirType>([
        ['delta', F64], ['elapsed', F64], ['frameCount', F64],
        ['fixedDelta', F64], ['fixedAlpha', F64], ['fixedTick', F64],
        ['scale', F64], ['unscaledDelta', F64],
    ]),
};
