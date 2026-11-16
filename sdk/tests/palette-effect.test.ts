// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The palette effect: held to a strip image's colours, dithered, the same in both shader languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEffectDef } from '../src/postprocess/effects';
import { basicEffects } from '../src/postprocess/sources/basic';
import { Material } from '../src/render/material';
import { withWgslTwin } from '../src/shaders/wgsl/twin';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'postprocess', 'sources', 'basic.ts'), 'utf8');
const palette = source.slice(source.indexOf('createPalette()'), source.indexOf('registerBasicEffectSources'));

/** The WGSL a device that draws through WebGPU is given for the pass, written from its GLSL as it compiles. */
function paletteWgsl(): string {
    const spy = vi.spyOn(Material, 'compileShader').mockReturnValue(1 as never);
    try {
        basicEffects.createPalette();
        return withWgslTwin(spy.mock.calls[0]![0] as string);
    } finally {
        spy.mockRestore();
    }
}

describe('the palette effect', () => {
    it('is a stylize effect that reads its colours from a strip image', () => {
        const def = getEffectDef('palette');
        expect(def).toBeDefined();
        expect(def!.category).toBe('stylize');
        expect(def!.uniforms.map((u) => u.name)).toEqual(['u_strength', 'u_dither', 'u_ditherScale']);
        expect(def!.textures!.map((t) => t.name)).toEqual(['u_palette']);
        // A scene with no strength changes nothing.
        expect(def!.uniforms[0]!.neutralValue).toBe(0);
    });

    it('reads the strip raw and a texel at a time, so no filter blends two colours, in both languages', () => {
        expect(palette).toContain('texel(data)');
        expect(palette).toContain('texelFetch(u_palette, ivec2(i, 0), 0)');
        expect(paletteWgsl()).toContain('textureLoad(u_palette, vec2i(i, 0), 0)');
    });

    it('leaves the picture alone with a palette of one colour (none was given), and goes through sRGB where the buffer is linear', () => {
        expect(palette).toContain('if (n <= 1) { fragColor = src; return; }');
        expect(paletteWgsl()).toMatch(/if \(n <= 1\) \{\s*fragColor = src;\s*return;\s*\}/);
        expect((palette.match(/#ifdef ES_LINEAR/g) ?? []).length).toBe(2);
    });

    it('spreads the choice with the same ordered dither in both languages', () => {
        expect(palette).toContain('float bayer8(vec2 a) { return (bayer2(0.25 * a) * 0.25 + bayer2(0.5 * a)) * 0.25 + bayer2(a); }');
        expect(paletteWgsl()).toMatch(/fn bayer8\(a : vec2f\) -> f32 \{\s*return \(\(\(bayer2\(0\.25 \* a\) \* 0\.25\) \+ bayer2\(0\.5 \* a\)\) \* 0\.25\) \+ bayer2\(a\);/);
    });
});
