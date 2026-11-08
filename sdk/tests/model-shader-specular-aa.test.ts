// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Model shader filters roughness by how fast the vertex normal turns, in both languages.
 *
 * The GLSL and WGSL stages are written apart and have to agree: a highlight that is filtered on
 * WebGL2 and sparkles on WebGPU is the same bug in the other backend. This holds the two to one
 * shape — the derivative is taken before any branch (a quad needs every fragment), only where the
 * mesh has normals, and what the lighting reads is the FILTERED roughness.
 */
import { describe, it, expect } from 'vitest';
import { builtinShaderTemplate } from '../src/render/builtinShaders';

const source = builtinShaderTemplate('model')!.source;
const [glsl, wgsl] = [source.slice(0, source.indexOf('#pragma fragment wgsl')), source.slice(source.indexOf('#pragma fragment wgsl'))];

describe('the Model shader filters specular by the normal derivative', () => {
    it('widens the lobe by the variance of the vertex normal, capped, in each language', () => {
        for (const stage of [glsl, wgsl]) {
            expect(stage).toMatch(/specularAA/);
            expect(stage).toMatch(/0\.18/); // the cap: a lobe never widens past a point the art did not ask for
            expect(stage).toMatch(/0\.25 \* \(dot\(dndx, dndx\) \+ dot\(dndy, dndy\)\)/);
        }
    });

    it('takes the derivative of the interpolated vertex normal before the cutout can discard', () => {
        expect(glsl.indexOf('dFdx(v_worldNormal)')).toBeGreaterThan(0);
        expect(glsl.indexOf('dFdx(v_worldNormal)')).toBeLessThan(glsl.indexOf('discard'));
        expect(wgsl.indexOf('dpdx(v.v_worldNormal)')).toBeGreaterThan(0);
        expect(wgsl.indexOf('dpdx(v.v_worldNormal)')).toBeLessThan(wgsl.indexOf('discard'));
    });

    it('lights with the filtered roughness, not the authored one', () => {
        expect(glsl).toMatch(/roughness = specularAA\(dndx, dndy, roughness\)/);
        expect(glsl).toMatch(/float metallic = u_metallic \* mr\.b/);
        expect(glsl).toMatch(/applyLightingSurface\([^;]*metallic, roughness,/);
        expect(glsl).toMatch(/applyLightingSurfaceBRDF\([^;]*roughness,/);
        expect(wgsl).toMatch(/roughness = specularAA\(dndx, dndy, roughness\)/);
        expect(wgsl).toMatch(/let metallic = mc\.u_metallic \* mr\.b/);
        expect(wgsl).toMatch(/applyLightingSurface\([^;]*metallic, roughness,/);
        expect(wgsl).toMatch(/applyLightingSurfaceBRDF\([^;]*roughness,/);
    });
});
