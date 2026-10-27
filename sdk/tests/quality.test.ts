// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { describe, expect, it } from 'vitest';
import { parseQualityConfig, QualityController } from '../src/render/quality';

describe('quality selection', () => {
    it('keeps unconfigured projects at their authored resolution', () => {
        const q = new QualityController({});
        for (let i = 0; i < 100; i++) q.sample(40);
        expect(q.enabled).toBe(false);
        expect(q.renderScale).toBe(1);
    });

    it('requires all rule conditions and takes the first matching device rule', () => {
        const config = { mode: 'auto' as const, deviceRules: [
            { level: 'high' as const, gpuIncludes: 'RTX', maxMemoryGB: 16 },
            { level: 'low' as const, modelIncludes: 'phone', maxCores: 4 },
        ] };
        expect(new QualityController(config, { gpu: 'rtx 4060', memoryGB: 8 })
            .report().level).toBe('high');
        expect(new QualityController(config, { gpu: 'RTX 4060' }).report().level).toBe('medium');
        expect(new QualityController(config, { model: 'Phone 1', cores: 4 })
            .report().level).toBe('low');
    });

    it('keeps profile overrides when switching tiers at runtime', () => {
        const q = new QualityController({ mode: 'low', profiles: {
            high: { renderScale: 0.9 }, low: { renderScale: 0.6, minRenderScale: 0.4 },
        } });
        q.setMode('high');
        expect(q.renderScale).toBe(0.9);
        q.setMode('off');
        expect(q.renderScale).toBe(1);
        q.setMode('low');
        expect(q.renderScale).toBe(0.6);
    });

    it('normalizes malformed manifests and bounds allocation sizes', () => {
        const config = parseQualityConfig({ mode: 'invalid', targetFps: NaN, profiles: {
            low: { renderScale: 0, minRenderScale: 2, shadowAtlasSize: 1024,
                shadowCellSize: 1024, particleLimit: Infinity, shadowCascades: 500, shadowDistance: -100 },
        }, deviceRules: [null, { level: 'high' }, { level: 'low', maxCores: NaN }] });
        const q = new QualityController({ ...config, mode: 'low' });
        expect(config.mode).toBe('off');
        expect(config.targetFps).toBe(60);
        expect(config.deviceRules).toEqual([]);
        expect(q.profile.renderScale).toBe(0.25);
        expect(q.profile.minRenderScale).toBe(0.25);
        expect(q.profile.shadowCellSize).toBe(512);
        expect(q.profile.shadowCascades).toBe(4);
        expect(q.profile.shadowDistance).toBe(0);
        expect(q.profile.particleLimit).toBe(1000);
    });
});

describe('dynamic resolution', () => {
    const make = () => new QualityController({ mode: 'high', dynamicResolution: true });
    const sample = (q: QualityController, frames: number, frameMs: number, gpuMs = -1) => {
        for (let i = 0; i < frames; i++) q.sample(frameMs, gpuMs);
    };

    it('ignores a transient spike, then reduces resolution under sustained pressure', () => {
        const q = make();
        q.sample(40, 40);
        expect(q.renderScale).toBe(1);
        sample(q, 20, 40, 40);
        expect(q.renderScale).toBeLessThan(1);
        expect(q.report().reason).toBe('gpu-pressure');
    });

    it('does not lower resolution for CPU pressure when the GPU has headroom', () => {
        const q = make();
        sample(q, 200, 40, 5);
        expect(q.renderScale).toBe(1);
        expect(q.report().reason).toBe('manual');
    });

    it('bounds the floor and slowly recovers without oscillating near the budget', () => {
        const q = make();
        sample(q, 200, 40, 40);
        expect(q.renderScale).toBe(0.75);
        expect(q.report().reason).toBe('resolution-floor');
        sample(q, 100, 16.67, 16.67);
        expect(q.renderScale).toBe(0.75);
        sample(q, 200, 10, 10);
        expect(q.renderScale).toBe(0.75);
        sample(q, 400, 10, 10);
        expect(q.renderScale).toBeGreaterThan(0.75);
        expect(q.renderScale).toBeLessThanOrEqual(1);
    });

    it('says which post-process effects each level leaves out, and takes an override', () => {
        const levels = (config: object, level: 'low' | 'medium' | 'high') => {
            const q = new QualityController({ mode: level, ...config });
            return q.profile.skipEffects;
        };
        // The expensive effects are left to the devices that can afford them.
        expect(levels({}, 'low')).toContain('ssr');
        expect(levels({}, 'medium')).toContain('ssr');
        expect(levels({}, 'high')).toEqual([]);
        // A project's own list replaces the level's, and what is not a name is dropped.
        expect(levels({ profiles: { low: { skipEffects: ['Bloom', 7, '  ', null, 'ssr'] } } }, 'low'))
            .toEqual(['Bloom', 'ssr']);
    });

    it('does not react to background gaps, invalid clocks or a static tier', () => {
        const q = make();
        for (const ms of [NaN, Infinity, 0, -5, 30000]) q.sample(ms);
        expect(q.renderScale).toBe(1);
        expect(q.report().frameMs).toBe(0);
        const staticQ = new QualityController({ mode: 'low' });
        sample(staticQ, 100, 40);
        expect(staticQ.renderScale).toBe(0.75);
    });
});

describe('what a quality level lets the chain run', () => {
    const level = (skipEffects: string[], extra: object = {}) => new QualityController({
        mode: 'low', profiles: { low: { skipEffects, ...extra } },
    }).profile;

    it('removes every pass of a multi-pass effect, however its passes are named', async () => {
        const { qualityPassAllowed } = await import('../src/postprocess/qualityFilter');
        const profile = level(['autoExposure', 'ssao']);
        for (const pass of ['ae_measure', 'ae_adapt', 'ae_apply', 'ssao_ao', 'ssao_blur_x', 'ssao_composite']) {
            expect(qualityPassAllowed(profile, pass), pass).toBe(false);
        }
        expect(qualityPassAllowed(profile, 'bloom'), 'bloom').toBe(true);
        expect(qualityPassAllowed(profile, 'ssr'), 'ssr').toBe(true);
    });

    it('keeps the old prefix reading for a name no effect answers to, and the ssao and post-process switches', async () => {
        const { qualityPassAllowed } = await import('../src/postprocess/qualityFilter');
        expect(qualityPassAllowed(level(['custom']), 'custom_pass')).toBe(false);
        expect(qualityPassAllowed(level([], { ssao: false }), 'ssao_blur_y')).toBe(false);
        expect(qualityPassAllowed(level([], { postProcess: false }), 'bloom')).toBe(false);
        expect(qualityPassAllowed(null, 'anything')).toBe(true);
    });

    it('names the effects a level leaves out by type, ignoring case', async () => {
        const { qualityPassAllowed } = await import('../src/postprocess/qualityFilter');
        // Depth of field is three passes now, and a level that leaves it out leaves out all of them.
        for (const pass of ['dof_focus', 'dof_coc', 'dof_gather']) {
            expect(qualityPassAllowed(level(['DepthOfField']), pass), pass).toBe(false);
        }
    });
});

describe('temporal anti-aliasing as the smoothing of a level', () => {
    const temporal = (level: 'low' | 'medium' | 'high') => new QualityController({
        mode: level, profiles: { [level]: { antialiasing: 'temporal' } },
    }).profile;

    it('is the smoothing of medium and a choice elsewhere, and parses only the two names', () => {
        expect(new QualityController({ mode: 'medium' }).profile.antialiasing).toBe('temporal');
        for (const level of ['low', 'high'] as const) {
            expect(new QualityController({ mode: level }).profile.antialiasing, level).toBe('msaa');
        }
        const odd = new QualityController({ mode: 'high', profiles: { high: { antialiasing: 'fxaa' as never } } }).profile;
        expect(odd.antialiasing).toBe('msaa');
        expect(temporal('medium').antialiasing).toBe('temporal');
    });

    it('runs the taa pass even where the level skips it, and leaves fxaa out', async () => {
        const { qualityPassAllowed } = await import('../src/postprocess/qualityFilter');
        // Low skips `taa` for the cost of everything that needs it: a project that asks for temporal smoothing there has said it wants it.
        expect(qualityPassAllowed(new QualityController({ mode: 'low' }).profile, 'taa')).toBe(false);
        expect(qualityPassAllowed(temporal('low'), 'taa')).toBe(true);
        expect(qualityPassAllowed(temporal('medium'), 'fxaa')).toBe(false);
        expect(qualityPassAllowed(new QualityController({ mode: 'medium', profiles: { medium: { antialiasing: 'msaa' } } }).profile, 'fxaa')).toBe(true);
        // Nothing else changes.
        expect(qualityPassAllowed(temporal('medium'), 'bloom_extract')).toBe(true);
    });
});

describe('how far plants keep their detail', () => {
    it('is a share of a plant\'s distances that falls with the level, and a project may set it', () => {
        const share = (mode: 'low' | 'medium' | 'high', detailScale?: unknown) =>
            new QualityController(parseQualityConfig({ mode, profiles: detailScale === undefined ? undefined : { [mode]: { detailScale } } })).profile.detailScale;
        expect([share('low'), share('medium'), share('high')]).toEqual([0.5, 0.8, 1]);
        expect(share('low', 0.3)).toBe(0.3);
        expect(share('low', 0)).toBe(0.25);
        expect(share('low', 7)).toBe(1);
    });
});
