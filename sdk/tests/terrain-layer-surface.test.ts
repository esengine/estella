// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SURFACE_BAKE_SHADER_TEMPLATE } from '../src/terrain/terrainShader';
import { PLANET_SHADER_TEMPLATE } from '../src/terrain/planetShader';
import { LAYER_SURFACE_GLSL, LAYER_SURFACE_WGSL } from '../src/terrain/layerSurfaceShader';

describe('the ground\'s layers are one piece of shader code', () => {
    it('Terrain Layers and Planet both draw their layers with it, in both languages', () => {
        for (const source of [TERRAIN_LAYERS_SHADER_TEMPLATE.source, PLANET_SHADER_TEMPLATE.source]) {
            expect(source).toContain(LAYER_SURFACE_GLSL);
            expect(source).toContain(LAYER_SURFACE_WGSL);
            expect(source).toContain('TnSurface layers = tnLayers(');
            expect(source).toContain('let layers = tnLayers(');
            // One copy of the code each: a layer read written a second time is a second place to change.
            expect(source.split('fn tnHex(').length).toBe(2);
            expect(source.split('TnTap tnHex(').length).toBe(2);
        }
    });

    it('reads the four layers with the most say at a pixel, not all eight', () => {
        for (const code of [LAYER_SURFACE_GLSL, LAYER_SURFACE_WGSL]) {
            expect(code).not.toMatch(/array<vec3f, 8>|vec3 albedo\[8\]/);
            expect(code).toMatch(/array<vec3f, 4>|vec3 albedo\[4\]/);
            // A layer not painted here costs no noise.
            expect(code).toMatch(/if \(raw <= 0\.0\) (\{ )?continue;/);
        }
    });

    it('the Planet keeps its own look by default: no height blend, blend noise or hex tiling', () => {
        const source = PLANET_SHADER_TEMPLATE.source;
        expect(source).toContain('#pragma param u_heightBlend float default(0)');
        expect(source).toContain('#pragma param u_blendNoise float default(0)');
        expect(source).toContain('#pragma param u_antiTile float default(0)');
        expect(source).not.toContain('u_tiles vec4');
        const layers = TERRAIN_LAYERS_SHADER_TEMPLATE.source;
        expect(layers).toContain('#pragma param u_heightBlend float default(0.8)');
        expect(layers).toContain('#pragma param u_blendNoise float default(0.5)');
        expect(layers).toContain('#pragma param u_antiTile float default(0.6)');
    });

    it("the virtual texture's bake takes the ground material's params by their names, and never declares the atlas it draws into", () => {
        const bake = TERRAIN_SURFACE_BAKE_SHADER_TEMPLATE.source;
        const lit = TERRAIN_LAYERS_SHADER_TEMPLATE.source;
        expect(bake).toContain('#pragma domain PostProcess');
        const params = (src: string): string[] => src.split(/\r?\n/).filter((l) => l.startsWith('#pragma param ')).map((l) => l.split(' ')[2]!);
        const theirs = new Set(params(lit));
        for (const name of params(bake).filter((n) => !n.startsWith('u_bake'))) expect(theirs.has(name)).toBe(true);
        // A texture drawn into and bound to be read in one pass is refused on WebGPU.
        expect(params(bake)).not.toContain('u_surfacePages');
        expect(params(lit)).toContain('u_surfacePages');
        // Both languages write the two halves of a page, and Terrain Layers reads them in both.
        expect(bake).toContain('tnOctEncode(g.N)');
        expect(lit.split('tnOctDecode(b.xy)').length).toBe(3);
    });
});
