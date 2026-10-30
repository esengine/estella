// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Twin generation for a shader with toggles. WGSL has no preprocessor, so
 *        every permutation has to be in the body and selected at assembly by the
 *        same `#ifdef` the GLSL side gets from a real define.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { needsTwin, permutationsOf, composePermutations, varyingLocations, liveAt } from '../gen-shader-twins.mjs';

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

describe('liveAt', () => {
    const lines = ['in vec2 a;', '#ifdef MESH_TANGENTS', 'in vec4 b;', '#else', 'in vec4 c;', '#endif', '#ifndef OTHER', 'in vec4 d;', '#endif', 'in vec4 e;', ''];
    const src = lines.join('\n');
    const at = (name: string) => src.indexOf(` ${name};`);

    it('reads a declaration under an #ifdef as not there when the permutation does not define it', () => {
        const live = liveAt(src, new Set());
        expect(live(at('a'))).toBe(true);
        expect(live(at('b'))).toBe(false);
        expect(live(at('c'))).toBe(true);
        expect(live(at('d'))).toBe(true);
        expect(live(at('e'))).toBe(true);
    });

    it('reads it as there when the permutation switches that name on, and the #else as not', () => {
        const live = liveAt(src, new Set(['MESH_TANGENTS', 'OTHER']));
        expect(live(at('b'))).toBe(true);
        expect(live(at('c'))).toBe(false);
        expect(live(at('d'))).toBe(false);
        expect(live(at('e'))).toBe(true);
    });

    it('counts nested conditionals together', () => {
        const nested = ['#ifdef A', '#ifdef B', 'in vec4 x;', '#endif', 'in vec4 y;', '#endif', ''].join('\n');
        const x = nested.indexOf(' x;'), y = nested.indexOf(' y;');
        expect(liveAt(nested, new Set(['A']))(x)).toBe(false);
        expect(liveAt(nested, new Set(['A']))(y)).toBe(true);
        expect(liveAt(nested, new Set(['A', 'B']))(x)).toBe(true);
        expect(liveAt(nested, new Set(['B']))(y)).toBe(false);
    });

    it('reads an #if expression, and the #endif that closes it does not close the one around it', () => {
        const src = ['#ifdef OUTER', '#if defined(MESH_TANGENTS) && defined(LIT)', 'in vec4 t;', '#endif', 'in vec4 after;', '#endif', 'in vec4 tail;', ''].join('\n');
        const t = src.indexOf(' t;'), after = src.indexOf(' after;'), tail = src.indexOf(' tail;');
        expect(liveAt(src, new Set(['MESH_TANGENTS']))(t)).toBe(false);
        expect(liveAt(src, new Set(['OUTER', 'MESH_TANGENTS', 'LIT']))(t)).toBe(true);
        expect(liveAt(src, new Set())(after)).toBe(false);
        expect(liveAt(src, new Set())(tail)).toBe(true);
    });

    it('takes the first #elif that holds, and the #else only when none did', () => {
        const src = ['#if !defined(A)', 'in vec4 x;', '#elif defined(B) || C', 'in vec4 y;', '#else', 'in vec4 z;', '#endif', ''].join('\n');
        const live = (on: string[], name: string) => liveAt(src, new Set(on))(src.indexOf(` ${name};`));
        expect([live([], 'x'), live([], 'y'), live([], 'z')]).toEqual([true, false, false]);
        expect([live(['A', 'C'], 'x'), live(['A', 'C'], 'y'), live(['A', 'C'], 'z')]).toEqual([false, true, false]);
        expect([live(['A'], 'x'), live(['A'], 'y'), live(['A'], 'z')]).toEqual([false, false, true]);
    });

    it('counts a condition it cannot read as live, with every branch of its chain', () => {
        const src = ['#if VERSION >= 300', 'in vec4 x;', '#else', 'in vec4 y;', '#endif', ''].join('\n');
        expect(liveAt(src, new Set())(src.indexOf(' x;'))).toBe(true);
        expect(liveAt(src, new Set())(src.indexOf(' y;'))).toBe(true);
    });
});
