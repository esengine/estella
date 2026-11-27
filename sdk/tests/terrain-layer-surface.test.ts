// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { TERRAIN_SHADER_TEMPLATE, TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SURFACE_BAKE_SHADER_TEMPLATE } from '../src/terrain/terrainShader';
import { PLANET_SHADER_TEMPLATE } from '../src/terrain/planetShader';
import { LAYER_SURFACE_GLSL, LAYER_SURFACE_WGSL } from '../src/terrain/layerSurfaceShader';
import { withWgslTwin } from '../src/shaders/wgsl/twin';

describe('the ground\'s layers are one piece of shader code', () => {
    it('projects the brush on the lit ground in both shader languages and leaves baked surface pages clean', () => {
        for (const shader of [TERRAIN_SHADER_TEMPLATE, TERRAIN_LAYERS_SHADER_TEMPLATE]) {
            const code = withWgslTwin(shader.source);
            expect(code).toContain('vec3 tnBrush(');
            expect(code).toContain('fn tnBrush(');
            expect(code).toMatch(/tnBrush\([^;]+Pw\.xz\)/);
            expect(code.split('#pragma fragment wgsl')[1]).toMatch(/tnBrush\([^;]+Pw\.xz\)/);
        }
        expect(TERRAIN_SURFACE_BAKE_SHADER_TEMPLATE.source).not.toContain('u_sculptBrush');
    });

    it('Terrain Layers and Planet both draw their layers with it, in both languages', () => {
        for (const source of [TERRAIN_LAYERS_SHADER_TEMPLATE.source, PLANET_SHADER_TEMPLATE.source]) {
            expect(source).toContain(LAYER_SURFACE_GLSL);
            expect(source).toContain('TnSurface layers = tnLayers(');
            // One copy of the code each: a layer read written a second time is a second place to change.
            expect(source.split('TnTap tnHex(').length).toBe(2);
            // Its own WGSL, or the one written from its GLSL as it compiles on WebGPU.
            const wgsl = withWgslTwin(source);
            expect(wgsl).toContain('let layers = tnLayers(');
            expect(wgsl.split('fn tnHex(').length).toBe(2);
        }
        // The Planet keeps its hand-written WGSL, which takes the layer code from the shared piece.
        expect(PLANET_SHADER_TEMPLATE.source).toContain(LAYER_SURFACE_WGSL);
    });

    it('reads the four layers with the most say at a pixel, not all eight', () => {
        for (const code of [LAYER_SURFACE_GLSL, LAYER_SURFACE_WGSL]) {
            expect(code).not.toMatch(/array<vec3f, 8>|vec3 albedo\[8\]/);
            expect(code).toMatch(/array<vec3f, 4>|vec3 albedo\[4\]/);
            // A layer not painted here costs no noise.
            expect(code).toMatch(/if \(raw <= 0\.0\) (\{ )?continue;/);
        }
    });

    it('decodes a resident render page and its surface bake against the same stored height range', () => {
        const ground = TERRAIN_SHADER_TEMPLATE.source;
        const layers = TERRAIN_LAYERS_SHADER_TEMPLATE.source;
        const bake = TERRAIN_SURFACE_BAKE_SHADER_TEMPLATE.source;
        const decoder = ground.match(/float tnRangeFloat[\s\S]+?float tnPageHeight[\s\S]+?\n\}/)![0];
        expect(decoder).toContain('uintBitsToFloat');
        expect(layers).toContain(decoder);
        expect(bake).toContain(decoder);
        expect(bake).toContain('tnPageHeight(texel, tnPageRange(u_bakeB.xy))');
        const wgsl = withWgslTwin(bake);
        expect(wgsl).toContain('bitcast<f32>');
        expect(wgsl).toContain('tnPageRange(mc.u_bakeB.xy)');
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
        // Older authored layer materials bind their upper four weights separately; the bake accepts both layouts.
        for (const name of params(bake).filter((n) => !n.startsWith('u_bake') && n !== 'u_paintPages2')) expect(theirs.has(name)).toBe(true);
        expect(theirs.has('u_pairedPaint')).toBe(true);
        expect(theirs.has('u_paintPages2')).toBe(false);
        expect(params(bake)).toContain('u_paintPages2');
        // A texture drawn into and bound to be read in one pass is refused on WebGPU.
        expect(params(bake)).not.toContain('u_surfacePages');
        expect(params(lit)).toContain('u_surfacePages');
        // Both languages write the two halves of a page, and Terrain Layers reads them in both.
        expect(bake).toContain('tnOctEncode(g.N)');
        expect(lit.split('tnOctDecode(b.xy)').length).toBe(2);
        expect(withWgslTwin(lit).split('tnOctDecode(b.xy)').length).toBe(3);
    });
});
