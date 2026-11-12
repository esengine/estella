import { describe, it, expect } from 'vitest';
import { decodeSkyCapture, skyEffectSource, defineSkyEffect, isCustomSky, CUSTOM_SKY_RANGE } from '../src/postprocess/customSky';
import { getEffectDef } from '../src/postprocess/effects';

describe('custom sky', () => {
    it('decodes the RGBM capture and turns the readback\'s bottom-up rows over', () => {
        // Two rows of one texel: the readback's first row is the panorama's LAST (the ground), its second the zenith.
        const rgba = new Uint8Array([255, 0, 0, 128, /* bottom */ 0, 0, 255, 255 /* top */]);
        const p = decodeSkyCapture(rgba, 1, 2);
        expect(p.rgb[2]).toBeCloseTo(CUSTOM_SKY_RANGE, 3); // zenith first: blue at the full range
        expect(p.rgb[0]).toBeCloseTo(0);
        expect(p.rgb[3]).toBeCloseTo(CUSTOM_SKY_RANGE * 128 / 255, 3); // then the ground: red at half
    });

    it('wraps the author\'s function in both languages, with the capture switch and the coverage marker', () => {
        const src = skyEffectSource({
            type: 't', label: 'T',
            uniforms: [{ name: 'u_glow', label: 'Glow', min: 0, max: 2, step: 0.1, defaultValue: 1 }],
            textures: { tNoise: () => ({ width: 1, height: 1, pixels: new Uint8Array(4), wrap: 'repeat' }) },
            glsl: 'vec3 skyRadiance(vec3 d, vec3 s, vec3 c, float e) { return vec3(u_glow); }',
            wgsl: 'fn skyRadiance(d : vec3f, s : vec3f, c : vec3f, e : f32) -> vec3f { return vec3f(mc.u_glow); }',
        });
        for (const line of ['#pragma domain PostProcess', '#pragma lights', '#pragma param u_skyCapture', '#pragma param u_sceneCoverage',
                            '#pragma param u_glow float default(1) range(0,2)', '#pragma param tNoise texture', '#pragma fragment wgsl']) {
            expect(src).toContain(line);
        }
        expect(src.match(/skyRadiance\(/g)!.length).toBeGreaterThanOrEqual(6);
    });

    it('multiplies the surfaces it finds by the shadow the sky gives, at their world place, only when the sky has one', () => {
        const sky = { type: 't', label: 'T', glsl: '', wgsl: '' };
        expect(skyEffectSource(sky)).not.toContain('skyShadow');
        const src = skyEffectSource({ ...sky, groundShadow: true });
        expect(src).toContain('src.rgb * clamp(skyShadow(worldFromDepth(v_texCoord, depth) + u_renderOrigin.xyz, sun), 0.0, 1.0)');
        expect(src).toContain('src.rgb * clamp(skyShadow(worldFromDepth(v.v_texCoord, depth) + frame.renderOrigin.xyz, sun), 0.0, 1.0)');
        // The sun is found before the surface is left, in both languages.
        expect(src.indexOf('findSun(lightDir')).toBeLessThan(src.indexOf('skyShadow('));
        expect(src.indexOf('let found = findSun()')).toBeLessThan(src.lastIndexOf('skyShadow('));
    });

    it('registers an effect that can light the scene', () => {
        defineSkyEffect({ type: 'unitSky', label: 'Unit Sky', glsl: '', wgsl: '' });
        expect(isCustomSky('unitSky')).toBe(true);
        expect(isCustomSky('skyAtmosphere')).toBe(false);
        const names = getEffectDef('unitSky')!.uniforms.map((u) => u.name);
        expect(names).toEqual(expect.arrayContaining(['u_intensity', 'u_lightScene']));
    });
});
