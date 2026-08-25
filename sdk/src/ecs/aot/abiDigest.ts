// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abiDigest.ts
 * @brief   What a compiled module baked in, as two numbers it can be asked for.
 *
 * @details A compiled system reads memory at offsets fixed when it was built. It
 *          reads the WRONG THING — not an error, a different field — if anything
 *          those offsets came from has changed since. So a loader compares.
 *
 *          Two digests, not one, because the mismatches have different fixes:
 *
 *          - `engineAbi` is everything about the ENGINE the module baked in:
 *            EHT's struct offsets, the resource shapes, the sizes of the three
 *            ABI structs and the width of an address. A mismatch means rebuild
 *            the module against this engine.
 *          - `projectShapes` is the `defineComponent` shapes it compiled
 *            against, scoped to the components it actually names. A mismatch
 *            means the project's components changed — rebuild the project.
 *
 *          A system's PARAMETER ORDER is deliberately in neither. It cannot
 *          drift: the manifest is what drives the layout at run time, so it is
 *          the instruction being followed rather than an input to compare.
 *
 *          This file is the ONE author, imported by the SDK that checks and by
 *          the compiler that writes. It has only leaf imports for that reason —
 *          a build tool reads it without pulling in the engine.
 */

import { PTR_LAYOUTS } from '../../wasm/ptrLayouts.generated';
import { RESOURCE_SHAPES } from '../resourceShapes';

/** Sizes of the three ABI structs, in address-wide words. */
export const SYSCTX_WORDS = 6;
export const QUERYROWS_WORDS = 2;
/** A command is four u32 at every address width. */
export const CMD_WORDS = 4;

export const CMD_DESPAWN = 1;
export const CMD_REMOVE = 2;

/** How wide an address is where the module runs: 4 on wasm32, 8 on a 64-bit host. */
export type AddressBytes = 4 | 8;

/** One component's flat shape, in the form both sides can produce. */
export interface ShapeDigestInput {
    readonly name: string;
    /** Field names in DECLARATION order, which is the layout. */
    readonly fields: readonly string[];
}

/**
 * Everything about the engine the module baked in. Recomputable by the SDK from
 * what it ships, which is what makes this the check that can actually run.
 */
export function engineAbiDigest(addressBytes: AddressBytes): string {
    const parts: string[] = [
        `addr=${addressBytes}`,
        `sysctx=${SYSCTX_WORDS} rows=${QUERYROWS_WORDS} cmd=${CMD_WORDS}`,
        `cmdkinds=${CMD_DESPAWN},${CMD_REMOVE}`,
    ];
    // EHT's table: every field of every engine component, at the offset the C++
    // struct puts it. This is the half that changes when the engine is rebuilt.
    for (const [name, layout] of Object.entries(PTR_LAYOUTS)) {
        const fields = layout.fields.map((f) => {
            const members = f.members
                ? `{${f.members.map((m) => `${m.name}:${m.type}@${m.offset}`).join(',')}}`
                : '';
            return `${f.name}:${f.type}@${f.offset}${members}`;
        });
        parts.push(`comp ${name}=${fields.join(',')}`);
    }
    for (const [name, shape] of Object.entries(RESOURCE_SHAPES)) {
        parts.push(`res ${name}=${Object.keys(shape).join(',')}`);
    }
    return fnv1a64(parts.join('\n'));
}

/**
 * The project's own component shapes, scoped to the ones a module names. Scoped
 * on purpose: adding an unrelated component to a project must not invalidate a
 * module that never reads it.
 */
export function projectShapeDigest(shapes: readonly ShapeDigestInput[]): string {
    const sorted = [...shapes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return fnv1a64(sorted.map((s) => `${s.name}=${s.fields.join(',')}`).join('\n'));
}

/** FNV-1a, as `mkbc` and the asset hashes already use; not a new mechanism. */
export function fnv1a64(text: string): string {
    const MASK = (1n << 64n) - 1n;
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < text.length; i++) {
        h = (h ^ BigInt(text.charCodeAt(i) & 0xff)) & MASK;
        h = (h * 0x100000001b3n) & MASK;
    }
    return h.toString(16).padStart(16, '0');
}
