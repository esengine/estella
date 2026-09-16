// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fingerprint.ts
 * @brief   What a bake was OF, as one short string.
 *
 * @details Two collectors fill in the same shape — one from a document, one from
 *          a world — and the rule for reducing it lives here, so they cannot
 *          disagree about whether a scene has changed since it was lit. Order
 *          does not count: the two walk their sources differently, and a scene
 *          whose entities were reordered is the same scene to light.
 */

import type { BakeLight } from './solve';
import type { BakeOptions } from './bake';
import { BAKE_DEFAULTS } from './bake';

/** Everything a bake reads, at the grain a fingerprint is taken of. */
export interface BakeInputs {
    surfaces: ReadonlyArray<{
        /** The mesh's project path, or its `builtin:` ref — its identity, not its bytes. */
        mesh: string;
        /** Column-major 4x4 world transform. */
        transform: ArrayLike<number>;
        albedo?: readonly [number, number, number];
        /** The base colour texture's project path, where it has one. */
        texture?: string;
        /** False where the simulation moves it. */
        holdsStill?: boolean;
    }>;
    lights: readonly BakeLight[];
    volumes: ReadonlyArray<{
        center: readonly [number, number, number];
        halfExtents: readonly [number, number, number];
        spacing: number;
    }>;
    /** Where each reflection probe stands. A capture is a function of the POINT,
     *  so that is the whole of what one contributes to a bake. */
    reflections?: ReadonlyArray<readonly [number, number, number]>;
    ambient?: readonly [number, number, number];
    options?: BakeOptions;
}

/** FNV-1a over UTF-16 code units. Two seeds, so the result is 64 bits wide. */
function fnv1a(text: string, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h = (h ^ text.charCodeAt(i)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

const num = (v: number | undefined): string => (v === undefined ? '' : String(v));
const nums = (v: ArrayLike<number> | undefined): string =>
    (v === undefined ? '' : Array.from(v).join(','));

/**
 * The fingerprint of one bake's inputs.
 *
 * Every value a bake reads reaches this; nothing else does. A mesh is named by
 * its PATH rather than its bytes — a reimport that changes the geometry changes
 * the file, and the gate that rebakes byte for byte is what answers for that.
 */
export function bakeFingerprint(inputs: BakeInputs): string {
    const opts = { ...BAKE_DEFAULTS, ...inputs.options };
    const lines: string[] = [];
    for (const s of inputs.surfaces) {
        lines.push(`s|${s.mesh}|${nums(s.transform)}|${nums(s.albedo)}|${s.texture ?? ''}`
            + `|${s.holdsStill === false ? 0 : 1}`);
    }
    for (const l of inputs.lights) {
        lines.push(`l|${l.kind}|${nums(l.position)}|${nums(l.direction)}|${nums(l.color)}`
            + `|${num(l.intensity)}|${num(l.radius)}|${num(l.innerCos)}|${num(l.outerCos)}`);
    }
    for (const v of inputs.volumes) {
        lines.push(`v|${nums(v.center)}|${nums(v.halfExtents)}|${num(v.spacing)}`);
    }
    for (const r of inputs.reflections ?? []) lines.push(`r|${nums(r)}`);
    lines.sort();
    lines.push(`o|${opts.atlasSize}|${opts.texelsPerUnit}|${opts.bounces}|${opts.samples}`
        + `|${opts.probeSamples}|${opts.dilate}|${nums(inputs.ambient ?? opts.ambient)}`);
    const text = lines.join('\n');
    const hex = (v: number): string => v.toString(16).padStart(8, '0');
    return hex(fnv1a(text, 0x811c9dc5)) + hex(fnv1a(text, 0x9e3779b9));
}
