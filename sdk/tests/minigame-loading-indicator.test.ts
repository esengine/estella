// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The host's loading indicator comes down once the game starts, even on a
 *        host that carries out its calls later and in another order (vivo).
 */
import { describe, it, expect } from 'vitest';
import { hostProgress } from '../src/runtime/miniGameRuntime';

/** A host that queues each call and carries it out when told, in any order. */
function deferredHost() {
    let showing: string | null = null;
    const queue: Array<{ kind: 'show' | 'hide'; run: () => void }> = [];
    return {
        host: {
            showLoading: (o: { title: string; complete?: () => void }) =>
                queue.push({ kind: 'show', run: () => { showing = o.title; o.complete?.(); } }),
            hideLoading: () => queue.push({ kind: 'hide', run: () => { showing = null; } }),
        },
        queue,
        showing: () => showing,
    };
}

describe('the loading indicator', () => {
    it('is gone after a hide that the host carried out before the last show', () => {
        const h = deferredHost();
        const progress = hostProgress(h.host);
        progress.reach('config');
        progress.finish();
        // What vivo did: the hide first, then the shows queued before it.
        const issued = h.queue.splice(0);
        for (const c of [...issued.filter((c) => c.kind === 'hide'), ...issued.filter((c) => c.kind === 'show')]) c.run();
        for (const c of h.queue.splice(0)) c.run();
        expect(h.showing()).toBeNull();
    });

    it('is gone on a host that never says a show landed', () => {
        let hidden = false;
        const progress = hostProgress({ showLoading: () => {}, hideLoading: () => { hidden = true; } });
        progress.finish();
        expect(hidden).toBe(true);
    });
});
