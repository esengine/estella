// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The power policy at run time: the frame cap and the level ceiling go on when the device says it is short, and come off only as far as they were put on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import { Quality, installQuality } from '../src/render/qualityRuntime';
import type { QualityController } from '../src/render/quality';
import type { PowerState } from '../src/device/types';

const { device } = vi.hoisted(() => ({ device: { state: { level: null, charging: null, thermal: null } as PowerState, reads: 0 } }));

vi.mock('../src/platform', () => ({
    getPlatform: () => ({ deviceName: () => 'phone', deviceQualityInfo: () => ({ memoryGB: 8, cores: 8 }), device: () => ({ power: () => { device.reads++; return device.state; } }) }),
    platformNow: () => 1,
    platformOnAppHide: () => () => {}, platformOnAppShow: () => () => {},
}));
vi.mock('../src/ecs/bridge/engineApi', () => ({ engineApi: () => ({}) }));

function fakeApp(cap: number) {
    let controller: QualityController | null = null;
    const app = {
        wasmModule: null, cap,
        insertResource: (resource: unknown, value: QualityController) => { if (resource === Quality) controller = value; },
        pipeline: { setQuality: () => {} }, addPlugin: vi.fn(), onFrameEnd: () => () => {},
        getTargetFrameRate() { return app.cap; },
        setTargetFrameRate(fps: number) { app.cap = fps; },
    };
    return { app, app_: app as unknown as App, controller: () => controller! };
}

beforeEach(() => { vi.useFakeTimers(); device.state = { level: null, charging: null, thermal: null }; device.reads = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('saving power at run time', () => {
    it('caps the frame rate and the level while the battery is low, and puts both back when it recovers', () => {
        const { app, app_, controller } = fakeApp(0);
        installQuality(app_, { mode: 'high', power: {} }, 4);
        expect(app.cap).toBe(0);
        expect(controller().report().level).toBe('high');
        device.state = { level: 0.1, charging: false, thermal: null };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(30);
        expect(controller().report().level).toBe('medium');
        expect(controller().report().limitations).toContain('power-saver');
        device.state = { level: 0.1, charging: true, thermal: null };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(0);
        expect(controller().report().level).toBe('high');
        expect(controller().report().limitations).not.toContain('power-saver');
    });

    it('never raises a cap the game set lower, and puts back the cap it found', () => {
        const { app, app_ } = fakeApp(24);
        installQuality(app_, { mode: 'high', power: { fps: 30 } }, 4);
        device.state = { level: 0.05, charging: false, thermal: null };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(24);
        const sixty = fakeApp(60);
        installQuality(sixty.app_, { mode: 'high', power: { fps: 30 } }, 4);
        vi.advanceTimersByTime(5000);
        expect(sixty.app.cap).toBe(30);
        device.state = { level: 0.9, charging: false, thermal: null };
        vi.advanceTimersByTime(5000);
        expect(sixty.app.cap).toBe(60);
    });

    it('leaves a cap the game changed while saving to the game, and halves it at critical heat', () => {
        const { app, app_, controller } = fakeApp(60);
        installQuality(app_, { mode: 'high', power: { fps: 30 } }, 4);
        device.state = { level: null, charging: null, thermal: 'serious' };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(30);
        device.state = { level: null, charging: null, thermal: 'critical' };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(15);
        expect(controller().report().level).toBe('low');
        // The game takes the cap itself: recovery does not overwrite it.
        app.cap = 45;
        device.state = { level: null, charging: null, thermal: 'nominal' };
        vi.advanceTimersByTime(5000);
        expect(app.cap).toBe(45);
        expect(controller().report().level).toBe('high');
    });

    it('does not look at the device at all without a policy', () => {
        const { app, app_ } = fakeApp(0);
        device.state = { level: 0.01, charging: false, thermal: 'critical' };
        installQuality(app_, { mode: 'high' }, 4);
        vi.advanceTimersByTime(20000);
        expect(app.cap).toBe(0);
        expect(device.reads).toBe(0);
    });
});
