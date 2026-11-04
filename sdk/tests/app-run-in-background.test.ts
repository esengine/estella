// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A hidden document gets no requestAnimationFrame. A game that asked to run in
 * the background (an editor's Play) keeps ticking on a timer; one that did not
 * holds still, which is what a shipped game wants.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { defineSystem } from '../src/ecs/system';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;
const realDocument = (globalThis as { document?: unknown }).document;

function hiddenPage(): { fire: () => void } {
    const listeners = new Set<() => void>();
    const doc = {
        visibilityState: 'visible' as 'visible' | 'hidden',
        addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
    };
    (globalThis as { document?: unknown }).document = doc;
    return { fire: () => { doc.visibilityState = 'hidden'; for (const fn of listeners) fn(); } };
}

afterEach(() => {
    vi.useRealTimers();
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    (globalThis as { document?: unknown }).document = realDocument;
});

describe('App.setRunInBackground', () => {
    for (const on of [true, false]) {
        it(on ? 'keeps ticking while the page is hidden' : 'holds still while the page is hidden, by default', async () => {
            vi.useFakeTimers();
            // rAF never fires: the page is hidden.
            globalThis.requestAnimationFrame = () => 1;
            globalThis.cancelAnimationFrame = () => undefined;
            let now = 1000;
            setPlatform({ now: () => now } as unknown as PlatformAdapter);
            const page = hiddenPage();
            const app = App.new();
            let frames = 0;
            app.addSystem(defineSystem([], () => { frames++; }, { name: 'Count' }));
            if (on) app.setRunInBackground(true);
            await app.run();
            for (let i = 0; i < 50; i++) await Promise.resolve();
            const started = frames;
            page.fire();
            for (let i = 0; i < 10; i++) { now += 17; await vi.advanceTimersByTimeAsync(17); }
            if (on) expect(frames - started).toBeGreaterThanOrEqual(8);
            else expect(frames).toBe(started);
            app.quit();
        });
    }
});
