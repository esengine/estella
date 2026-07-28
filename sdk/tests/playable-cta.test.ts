// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The playable CTA seam: game code calls one function, the exported page
 *        supplies the network's own API through the injected bridge. A build with
 *        no bridge must stay playable rather than throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playableCta, hasPlayableCta } from '../src/runtime/playableCta';

const KEY = '__ESTELLA_PLAYABLE__';
const g = globalThis as Record<string, unknown>;

describe('playableCta', () => {
    beforeEach(() => { delete g[KEY]; });
    afterEach(() => { delete g[KEY]; vi.restoreAllMocks(); });

    it('dispatches to the injected bridge', () => {
        const cta = vi.fn();
        g[KEY] = { cta };
        expect(hasPlayableCta()).toBe(true);
        playableCta();
        expect(cta).toHaveBeenCalledTimes(1);
    });

    it('is a no-op with no bridge, so the same scene runs on the web', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(hasPlayableCta()).toBe(false);
        expect(() => playableCta()).not.toThrow();
        // Warned about, but only ever once — a CTA can sit on a per-frame handler.
        playableCta();
        playableCta();
        expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('treats a bridge without a cta method as absent', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        g[KEY] = {};
        expect(hasPlayableCta()).toBe(false);
        expect(() => playableCta()).not.toThrow();
    });
});
