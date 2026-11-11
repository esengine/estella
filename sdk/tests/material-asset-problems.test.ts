// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { assetPropertyProblems } from '../src/render/materialProblems';

describe('the properties of a material asset that nothing reads', () => {
    it('accepts what a material is written with', () => {
        expect(assetPropertyProblems({
            u_roughness: 0.4,
            u_tiling: { x: 12, y: 12 },
            u_tint: { r: 1, g: 0.5, b: 0.2 },
            u_range: { x: 1, y: 2, z: 3 },
            mainTex: 'textures/wall.png',
        })).toEqual([]);
    });

    it('names an array, which is what an author writes first, and says what to write instead', () => {
        const [problem] = assetPropertyProblems({ u_tiling: [12, 12] });
        expect(problem).toMatch(/^u_tiling is an array/);
        expect(problem).toContain('"x": ..');
        expect(problem).toContain('"y": ..');
    });

    it('offers a colour for an array of three or four', () => {
        expect(assetPropertyProblems({ u_tint: [1, 0.5, 0.2, 1] })[0]).toContain('"r"');
        expect(assetPropertyProblems({ u_tiling: [12, 12] })[0]).not.toContain('"r"');
    });

    it('names an object of no known shape, a boolean and a null', () => {
        const problems = assetPropertyProblems({ a: { foo: 1 }, b: true, c: null });
        expect(problems).toHaveLength(3);
        expect(problems[0]).toMatch(/^a is an object with none of the keys/);
        expect(problems[1]).toMatch(/^b is boolean/);
        expect(problems[2]).toMatch(/^c is null/);
    });
});
