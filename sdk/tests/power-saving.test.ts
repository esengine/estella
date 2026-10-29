// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Drawing less when the device is short of power or hot: when the policy says saving, what it takes, and that the device says so honestly.
 */
import { describe, expect, it } from 'vitest';
import { decidePower } from '../src/render/power';
import { QualityController, parsePowerPolicy, parseQualityConfig } from '../src/render/quality';
import { WebDevice } from '../src/device/web';
import { NO_POWER_STATE, type PowerState } from '../src/device/types';

const state = (over: Partial<PowerState>): PowerState => ({ ...NO_POWER_STATE, ...over });

describe('when the policy saves', () => {
    it('saves on a low battery that is not charging, and not on a charging one or a full one', () => {
        expect(decidePower(state({ level: 0.1, charging: false }), {})).toMatchObject({ saving: true, fps: 30, ceiling: 'medium', reason: 'battery' });
        expect(decidePower(state({ level: 0.1, charging: true }), {}).saving).toBe(false);
        expect(decidePower(state({ level: 0.9, charging: false }), {}).saving).toBe(false);
        expect(decidePower(state({ level: 0.19, charging: false }), { lowBattery: 0.15 }).saving).toBe(false);
        expect(decidePower(state({ level: 0.01, charging: false }), { lowBattery: 0 }).saving).toBe(false);
    });

    it('saves under serious thermal pressure, and halves the cap and holds the level low at critical', () => {
        expect(decidePower(state({ thermal: 'fair' }), {}).saving).toBe(false);
        expect(decidePower(state({ thermal: 'serious' }), {})).toMatchObject({ saving: true, fps: 30, ceiling: 'medium', reason: 'thermal' });
        expect(decidePower(state({ thermal: 'critical' }), {})).toMatchObject({ saving: true, fps: 15, ceiling: 'low', reason: 'critical' });
        expect(decidePower(state({ thermal: 'serious' }), { thermal: 'critical' }).saving).toBe(false);
        expect(decidePower(state({ thermal: 'critical' }), { thermal: 'never' }).saving).toBe(false);
        expect(decidePower(state({ thermal: 'critical' }), { severe: 'never' })).toMatchObject({ fps: 30, ceiling: 'medium' });
    });

    it('takes the policy\'s own cap and ceiling, never a cap under 15 from halving', () => {
        expect(decidePower(state({ level: 0.05, charging: false }), { fps: 24, ceiling: 'low' })).toMatchObject({ fps: 24, ceiling: 'low' });
        expect(decidePower(state({ thermal: 'critical' }), { fps: 20 }).fps).toBe(15);
    });

    it('never saves for what the platform does not say: a null is not a reason', () => {
        expect(decidePower(NO_POWER_STATE, {})).toEqual({ saving: false, fps: 0, ceiling: null, reason: 'none' });
        expect(decidePower(state({ level: 0.01, charging: null }), {}).saving).toBe(false);
    });
});

describe('the quality ceiling', () => {
    it('lowers a level above it and leaves one at or under it, and goes away when it is taken off', () => {
        const q = new QualityController({ mode: 'high' });
        expect(q.report().level).toBe('high');
        q.setCeiling('medium');
        expect(q.report().level).toBe('medium');
        expect(q.report().limitations).toContain('power-saver');
        expect(q.report().reason).toBe('power-saver');
        q.setCeiling(null);
        expect(q.report().level).toBe('high');
        expect(q.report().limitations).not.toContain('power-saver');
        const low = new QualityController({ mode: 'low' });
        low.setCeiling('medium');
        expect(low.report().level).toBe('low');
        expect(low.report().limitations).not.toContain('power-saver');
    });

    it('keeps a ceiling across a change of mode', () => {
        const q = new QualityController({ mode: 'low' });
        q.setCeiling('medium');
        q.setMode('high');
        expect(q.report().level).toBe('medium');
    });
});

describe('the power policy as a project states it', () => {
    it('keeps what is usable, clamps what is out of range, and drops what is not a name', () => {
        expect(parsePowerPolicy({ lowBattery: 3, fps: 5, ceiling: 'ultra', thermal: 'critical', severe: 'never' }))
            .toEqual({ lowBattery: 1, fps: 10, thermal: 'critical', severe: 'never' });
        expect(parsePowerPolicy(true)).toEqual({});
        expect(parseQualityConfig({ mode: 'auto', power: { fps: 24 } }).power).toEqual({ fps: 24 });
        expect(parseQualityConfig({ mode: 'auto' }).power).toBeUndefined();
        expect(parseQualityConfig({ mode: 'auto', power: false }).power).toBeUndefined();
    });
});

describe('what a browser says of the device', () => {
    const win = () => ({ addEventListener() {}, removeEventListener() {} }) as unknown as Window;
    const doc = () => ({ addEventListener() {}, removeEventListener() {}, hidden: false, documentElement: {} }) as unknown as Document;

    it('says nothing before the browser has answered, then the battery it reported', async () => {
        const battery = { level: 0.4, charging: false, addEventListener() {}, removeEventListener() {} };
        const nav = { getBattery: () => Promise.resolve(battery) } as never;
        const device = new WebDevice(win(), doc(), nav);
        expect(device.power()).toEqual({ level: null, charging: null, thermal: null });
        await Promise.resolve();
        await Promise.resolve();
        expect(device.power()).toEqual({ level: 0.4, charging: false, thermal: null });
        battery.level = 0.1;
        expect(device.power().level).toBe(0.1);
        device.dispose();
    });

    it('says nothing for a browser with no battery API and no pressure observer', () => {
        const device = new WebDevice(win(), doc(), {} as never);
        expect(device.power()).toEqual({ level: null, charging: null, thermal: null });
        device.dispose();
    });

    it('takes the processor pressure a PressureObserver reports', async () => {
        let deliver: ((records: { state: PowerState['thermal'] }[]) => void) | null = null;
        const w = win() as unknown as { PressureObserver: unknown };
        w.PressureObserver = class { constructor(cb: typeof deliver) { deliver = cb; } observe() { return Promise.resolve(); } disconnect() {} };
        const device = new WebDevice(w as unknown as Window, doc(), {} as never);
        expect(device.power().thermal).toBeNull();
        deliver!([{ state: 'fair' }, { state: 'serious' }]);
        expect(device.power().thermal).toBe('serious');
        device.dispose();
    });
});
