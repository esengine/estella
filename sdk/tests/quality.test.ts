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
