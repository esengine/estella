// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Twin generation for a shader with toggles. WGSL has no preprocessor, so
 *        every permutation has to be in the body and selected at assembly by the
 *        same `#ifdef` the GLSL side gets from a real define.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { needsTwin, permutationsOf, composePermutations, varyingLocations } from '../gen-shader-twins.mjs';

const GLSL_ONLY = '#pragma shader "X"\n#pragma switch USE_GREEN default(off)\n#pragma fragment\nvoid main() {}\n#pragma end\n';

describe('needsTwin', () => {
    it('asks for a twin for a shader with switches', () => {
        expect(needsTwin(GLSL_ONLY)).toBe(true);
    });

    it('leaves a hand-authored twin alone', () => {
        expect(needsTwin('#pragma fragment wgsl\n@fragment fn fs_main() {}\n#pragma end\n')).toBe(false);
    });
});

describe('permutationsOf', () => {
    it('is the empty combination when there is nothing to toggle', () => {
        expect(permutationsOf([])).toEqual([[]]);
    });

    it('covers every on/off combination', () => {
        const got = permutationsOf(['A', 'B']).map((c: string[]) => c.join('') || '-');
        expect(new Set(got)).toEqual(new Set(['-', 'A', 'B', 'AB']));
    });
});

describe('composePermutations', () => {
    it('emits the single body verbatim when nothing toggles', () => {
        expect(composePermutations([], new Map([['', 'BODY']]))).toBe('BODY');
    });

    it('selects one toggle with #ifdef/#else', () => {
        const bodies = new Map([['', 'OFF'], ['A', 'ON']]);
        expect(composePermutations(['A'], bodies)).toBe('#ifdef A\nON\n#else\nOFF\n#endif');
    });

    it('nests two toggles so every combination is reachable', () => {
        const bodies = new Map([['', 'oo'], ['A', 'Ao'], ['B', 'oB'], ['A,B', 'AB']]);
        const out = composePermutations(['A', 'B'], bodies);
        for (const body of ['oo', 'Ao', 'oB', 'AB']) expect(out).toContain(body);
        expect(out.startsWith('#ifdef A')).toBe(true);
        // Balanced: one #endif per #ifdef, or the assembly-time preprocessor
        // silently swallows the rest of the stage.
        expect((out.match(/#ifdef/g) ?? []).length).toBe((out.match(/#endif/g) ?? []).length);
    });
});

describe('varyingLocations', () => {
    it('reads every location of the engine varying struct, flat and conditional ones included', () => {
        const struct = 'struct VSOut {\n    @builtin(position) pos : vec4f,\n    @location(0) v_color : vec4f,\n'
            + '#ifdef MESH_NORMALS\n    @location(3) v_worldNormal : vec3f,\n#endif\n'
            + '    @location(6) @interpolate(flat) v_probeSlot : f32,\n};\n';
        expect([...varyingLocations(struct)]).toEqual([['v_color', 0], ['v_worldNormal', 3], ['v_probeSlot', 6]]);
    });
});
