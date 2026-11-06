// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { QualityController, defaultQualityMode, defaultQualityProfile } from '../src/render/quality';
import { browserIsHandheld } from '../src/platform/web';
import { withTemporalAntialiasing } from '../src/postprocess/volumeSystem';
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
