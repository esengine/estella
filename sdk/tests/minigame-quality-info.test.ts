// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';
import { QualityController } from '../src/render/quality';

const adapter = (global: Partial<MiniGameGlobal>) => new MiniGamePlatformAdapter({
    id: 'wx', global,
} as MiniGameProfile);

describe('mini-game device quality facts', () => {
    it('uses device information and normalizes MB into the quality rules unit', () => {
        const info = adapter({ getDeviceInfo: () => ({ model: 'iPhone 13<iPhone14,5>', memorySize: '2048' }) })
            .deviceQualityInfo();
        expect(info).toEqual({ model: 'iPhone 13', memoryGB: 2 });
        expect(new QualityController({ mode: 'auto' }, info).report().level).toBe('low');
    });

    it('accepts numeric memory from older vendor system information', () => {
        expect(adapter({ getSystemInfoSync: () => ({ memorySize: 4096 }) }).deviceQualityInfo().memoryGB)
            .toBe(4);
    });

    it('keeps unavailable or malformed facts unknown rather than inventing a device tier', () => {
        for (const memorySize of [undefined, 'unknown', '', 0, -1, Infinity]) {
            const info = adapter({ getDeviceInfo: () => ({ memorySize }) }).deviceQualityInfo();
            expect(info.memoryGB).toBeUndefined();
            expect(new QualityController({ mode: 'auto' }, info).report().level).toBe('medium');
        }
        expect(adapter({ getDeviceInfo: () => { throw new Error('unavailable'); } }).deviceQualityInfo())
            .toEqual({});
    });
});
