// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * An App's signal is how work that outlives a call learns its App was let go: a
 * runtime still loading when its game was stopped went on to start the loop, and
 * the music with it, on an App nothing held any more (issue #227).
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';

describe('App.signal', () => {
    it('is aborted when the App quits, with an AbortError', () => {
        const app = App.new();
        const signal = app.signal;
        expect(signal.aborted).toBe(false);
        app.quit();
        expect(signal.aborted).toBe(true);
        expect(() => signal.throwIfAborted()).toThrow(expect.objectContaining({ name: 'AbortError' }));
    });

    it('tells a listener after the plugins are released, not before', () => {
        const app = App.new();
        const order: string[] = [];
        app.addPlugin({ name: 'probe', build() {}, cleanup() { order.push('cleanup'); } });
        app.signal.addEventListener('abort', () => order.push('abort'));
        app.quit();
        expect(order).toEqual(['cleanup', 'abort']);
    });

    it('is a fresh one for an App used again after quit', () => {
        const app = App.new();
        const first = app.signal;
        app.quit();
        expect(app.signal).not.toBe(first);
        expect(app.signal.aborted).toBe(false);
        app.quit();
        expect(first.aborted).toBe(true);
    });
});
