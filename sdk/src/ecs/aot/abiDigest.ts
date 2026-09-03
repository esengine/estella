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
 *            EHT's struct offsets, the resource shapes, the sizes of the four
 *            ABI structs, the specified trigonometry and the width of an
 *            address. A mismatch means rebuild
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
import { RESOURCE_NAMES, RESOURCE_SHAPES, resourceLayout } from '../resourceShapes';
import { EXACT_CONSTANTS, exact } from '../../math/exact';

/** Sizes of the four ABI structs, in address-wide words. */
export const SYSCTX_WORDS = 6;
export const QUERYROWS_WORDS = 2;
/**
 * The header a system's event queue starts with: buf, cap, count. Here rather
 * than beside either consumer because BOTH the runtime and the differential
 * host lay this block out, and the number was written in each of them: a fourth
 * field appended by one is three words the other keeps stepping over.
 */
export const EVENT_OUT_WORDS = 3;
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
 * Where the digest LOOKS: off the quadrant grid so every branch of the
 * reduction is reached, then the tie, the boundaries, and arguments large
 * enough that Cody-Waite loses digits. Sampling alone does not do — a 1-ulp
 * `S3` moved none of these, which is why the constants go in exactly.
 */
function trigProbes(): number[] {
    const out: number[] = [];
    for (let i = -120; i <= 120; i++) out.push(i * 0.37);
    const HALF_PI = Math.PI / 2;
    for (let q = -4; q <= 4; q++) for (const d of [-1e-9, 0, 1e-9]) out.push(q * HALF_PI + d);
    for (let k = -3; k <= 3; k++) out.push((k + 0.5) * HALF_PI);
    out.push(0, -0, 1, -1, 1e-8, 12345.6789, -98765.4321, 1e10, -1e10);
    return out;
}

/** A double as the bits it is, because one ulp apart is one pixel apart. */
function bitsOf(x: number): string {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    return view.getBigUint64(0).toString(16).padStart(16, '0');
}

/**
 * Two halves because one alone misses: the CONSTANTS exactly, so a coefficient
 * change counts whether or not it moves a sampled answer, and the ANSWERS for
 * what the constants are not — quadrant choice, the reduction's tie, summation
 * order. A parameter so a test can nudge one constant and watch this move.
 *
 * @internal
 */
export function trigDigest(consts_: readonly number[] = EXACT_CONSTANTS): string {
    const consts = consts_.map(bitsOf).join(',');
    const answers = trigProbes().map((x) => `${bitsOf(exact.sin(x))}/${bitsOf(exact.cos(x))}`).join(',');
    return fnv1a64(`${consts}|${answers}`);
}


/**
 * Everything about the engine the module baked in. Recomputable by the SDK from
 * what it ships, which is what makes this the check that can actually run.
 */
export function engineAbiDigest(addressBytes: AddressBytes): string {
    return fnv1a64(engineAbiParts(addressBytes).join('\n'));
}

/**
 * What the digest is taken OF, so a test can ask whether something is covered.
 * A digest can only say two things differ; this says what it was looking at.
 *
 * @internal
 */
export function engineAbiParts(addressBytes: AddressBytes): readonly string[] {
    const parts: string[] = [
        `addr=${addressBytes}`,
        `sysctx=${SYSCTX_WORDS} rows=${QUERYROWS_WORDS} cmd=${CMD_WORDS} eventout=${EVENT_OUT_WORDS}`,
        `cmdkinds=${CMD_DESPAWN},${CMD_REMOVE}`,
        // The module compiled ITS polynomial in, so a host running another makes
        // the same system answer differently depending on whether it was
        // compiled — an ulp, which is a pixel a differential gate calls a bug.
        `trig=${trigDigest()}`,
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
    // The whole layout, not the spec's own keys: a member's OFFSET is what a
    // compiled system reads at, and for a bit set the KEY ORDER is what picks
    // the bit. Either moving under a built module is a read of something else.
    for (const name of RESOURCE_NAMES) {
        const spec = RESOURCE_SHAPES[name]!;
        const members = (resourceLayout(name) ?? []).map((m) => {
            if (m.kind === 'scalar') return `${m.name}@${m.offset}`;
            const how = spec.bits?.[m.name];
            const domain = how?.keys ? how.keys.join('/') : `0..${(how?.count ?? 0) - 1}`;
            return `${m.name}@${m.offset}[${domain}]`;
        });
        const methods = Object.entries(spec.methods ?? {}).map(([m, set]) => `${m}->${set}`);
        parts.push(`res ${name}=${members.join(',')}|${methods.join(',')}`);
    }
    return parts;
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
