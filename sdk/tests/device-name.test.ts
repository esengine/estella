// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A connected build says what device it is on, so two of them in the
 *        editor's lists are not the same line twice.
 */
import { describe, it, expect } from 'vitest';
import { browserDeviceName } from '../src/platform/web';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';

describe('a browser names itself by browser and system', () => {
    it.each([
        ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'Chrome · Mac'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0', 'Edge · Windows'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Estella/0.72.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36', 'Electron · Mac'],
    ])('%s', (ua, name) => {
        expect(browserDeviceName(ua)).toBe(name);
    });
});

describe('a mini-game names its device by the model the host reports', () => {
    const named = (model?: string) => new MiniGamePlatformAdapter({
        id: 'wechat', hostLabel: 'x',
        global: { getSystemInfoSync: () => ({ model }) } as unknown as MiniGameGlobal,
    } as MiniGameProfile).deviceName();

    it('without the hardware id WeChat appends', () => {
        expect(named('iPhone 13<iPhone14,5>')).toBe('iPhone 13');
        expect(named('V2203A')).toBe('V2203A');
    });

    it('as nothing when the host reports none', () => {
        expect(named()).toBe('');
    });
});
