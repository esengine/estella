// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { QualityController, defaultQualityMode, defaultQualityProfile } from '../src/render/quality';
import { browserIsHandheld } from '../src/platform/web';
import { withReducedDynamicGI, withTemporalAntialiasing } from '../src/postprocess/volumeSystem';
import type { PostProcessAPI } from '../src/postprocess/PostProcessAPI';

describe('the level a project gets that names none', () => {
    it('is medium on a phone or tablet and nothing managed elsewhere', () => {
        expect(defaultQualityMode(true)).toBe('medium');
        expect(defaultQualityMode(false)).toBe('off');
        expect(new QualityController({ mode: defaultQualityMode(true) }).report().level).toBe('medium');
        expect(new QualityController({ mode: defaultQualityMode(false) }).enabled).toBe(false);
    });

    it('tells a handheld browser, an iPad that says it is a Mac among them', () => {
        const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
        expect(browserIsHandheld('Mozilla/5.0 (Linux; Android 15; 24129PN74C) Chrome/120.0 Mobile', 5)).toBe(true);
        expect(browserIsHandheld('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', 5)).toBe(true);
        expect(browserIsHandheld(mac, 5)).toBe(true);
        expect(browserIsHandheld(mac, 0)).toBe(false);
        expect(browserIsHandheld('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0', 10)).toBe(false);
    });
});

describe('the temporal smoothing a level asks for', () => {
    const asking = { antialiasing: defaultQualityProfile('medium').antialiasing } as unknown as PostProcessAPI;

    it('goes on a camera with depth', () => {
        expect(withTemporalAntialiasing(asking, new Map(), true).has('taa')).toBe(true);
    });

    it('leaves an orthographic camera as authored: jittered, sprites and text go soft', () => {
        expect(withTemporalAntialiasing(asking, new Map(), false).size).toBe(0);
    });

    it('still gives an orthographic camera the pass its author listed', () => {
        const listed = new Map([['taa', { enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() }]]);
        expect(withTemporalAntialiasing(asking, listed, false).has('taa')).toBe(true);
    });
});

describe('the cheaper dynamic GI a level asks for', () => {
    const effect = (uniforms: Array<[string, number]>) => new Map([['dynamicGI', { enabled: true, uniforms: new Map(uniforms), textures: new Map(), colors: new Map() }]]);
    const asking = { dynamicGIReduced: true } as unknown as PostProcessAPI;
    const full = { dynamicGIReduced: false } as unknown as PostProcessAPI;

    it('is written on the effects, so a level put in force after the stack was built still reaches it', () => {
        const u = withReducedDynamicGI(asking, effect([])).get('dynamicGI')!.uniforms;
        expect([u.get('u_halfRes'), u.get('u_probeStride'), u.get('u_cardSlices')]).toEqual([1, 4, 8]);
        expect(u.get('u_probeDensity')).toBeCloseTo(2 / 3);
    });

    it('never makes what the volume set dearer, and leaves the volume itself alone', () => {
        const authored = effect([['u_probeStride', 8], ['u_cardSlices', 2], ['u_probeDensity', 0.5]]);
        const u = withReducedDynamicGI(asking, authored).get('dynamicGI')!.uniforms;
        expect([u.get('u_probeStride'), u.get('u_cardSlices'), u.get('u_probeDensity')]).toEqual([8, 8, 0.5]);
        expect(authored.get('dynamicGI')!.uniforms.has('u_halfRes')).toBe(false);
    });

    it('does nothing at a level that runs it whole, or with no dynamic GI listed', () => {
        const authored = effect([]);
        expect(withReducedDynamicGI(full, authored)).toBe(authored);
        expect(withReducedDynamicGI(asking, new Map()).size).toBe(0);
    });
});
