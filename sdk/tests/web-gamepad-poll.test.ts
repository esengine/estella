// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = () => void;

function stubBrowser(pads: () => unknown[]) {
    const listeners = new Map<string, Listener[]>();
    const getGamepads = vi.fn(pads);
    vi.stubGlobal('navigator', { getGamepads });
    vi.stubGlobal('window', {
        addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    });
    return { getGamepads, fire: (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); } };
}

const pad = { index: 0, connected: true, buttons: [{ value: 1 }], axes: [0.5], mapping: 'standard' };

describe('web gamepad poll', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

    it('asks the browser about once a second while no pad is known, and every poll once one is', async () => {
        let plugged: unknown[] = [];
        const browser = stubBrowser(() => plugged);
        const { webAdapter } = await import('../src/platform/web');

        for (let i = 0; i < 120; i++) expect(webAdapter.pollGamepads()).toEqual([]);
        expect(browser.getGamepads).toHaveBeenCalledTimes(2);

        // The browser announces a pad: the very next poll reads it, and every poll after.
        plugged = [pad];
        browser.fire('gamepadconnected');
        expect(webAdapter.pollGamepads()).toEqual([{ index: 0, connected: true, buttons: [1], axes: [0.5], mapping: 'standard' }]);
        const before = browser.getGamepads.mock.calls.length;
        for (let i = 0; i < 10; i++) webAdapter.pollGamepads();
        expect(browser.getGamepads.mock.calls.length - before).toBe(10);

        // Unplugged: the look that finds none puts it back to the slow rate.
        plugged = [];
        webAdapter.pollGamepads();
        const after = browser.getGamepads.mock.calls.length;
        for (let i = 0; i < 30; i++) webAdapter.pollGamepads();
        expect(browser.getGamepads.mock.calls.length - after).toBeLessThanOrEqual(1);
    });

    it('finds a pad that was plugged in before the page listened, without an announcement', async () => {
        const browser = stubBrowser(() => [pad]);
        const { webAdapter } = await import('../src/platform/web');
        expect(webAdapter.pollGamepads()).toHaveLength(1);
        expect(webAdapter.pollGamepads()).toHaveLength(1);
        expect(browser.getGamepads).toHaveBeenCalledTimes(2);
    });
});
