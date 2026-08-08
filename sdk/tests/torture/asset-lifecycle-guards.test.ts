// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Proof that the torture harness tortures, and that its claims can fail.
 *
 * A generated property that passes in eight milliseconds is either watching an
 * engine with no bugs or watching nothing, and the two look identical from the
 * outside. So: the harness is asserted to actually drive loads and observe the
 * pool, the invariants are asserted to go red on a leak injected by hand, and
 * the counterexample the property found the first time it ran is kept here as
 * an ordinary regression test — spelled out, so it fails for one reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeAssetHarness, withoutLoadTimeout, textureRefs } from './assetHarness';

const KEY = 'tex/a.png';

/** A loader whose settling this test controls, without a fast-check scheduler. */
function manualHarness() {
    const gates: Array<() => void> = [];
    const h = makeAssetHarness(
        (key) => new Promise((resolve) => { gates.push(() => resolve(key as never)); }),
    );
    return {
        ...h,
        /** Let the Nth outstanding load through (0 = oldest). */
        settle(index = 0) {
            const gate = gates.splice(index, 1)[0];
            if (!gate) throw new Error(`no outstanding load at index ${index}`);
            gate();
            return new Promise<void>((r) => setTimeout(r, 0));
        },
        outstanding: () => gates.length,
    };
}

describe('the torture harness', () => {
    it('actually drives the loader and sees the pool', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const load = h.assets.loadTexture(KEY);
                expect(h.loaderCalls, 'the patched loader was never called — I1 would be vacuous').toHaveLength(1);
                expect(h.outstanding(), 'the load settled on its own; nothing is schedulable').toBe(1);

                await h.settle();
                const result = await load;
                expect(h.gpu.created, 'no handle was minted — the GPU ledger sees nothing').toContain(result.handle);

                h.assets.releaseTexture(KEY);
                expect(h.gpu.refs.get(result.handle), 'release never reached the ResourceManager').toBe(0);
            } finally {
                h.dispose();
            }
        });
    });

    it('joins a second request to the load already in flight', async () => {
        // I1's premise. If two concurrent loads produced two fetches, the
        // invariant's budget arithmetic would be measuring the wrong thing.
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const a = h.assets.loadTexture(KEY);
                const b = h.assets.loadTexture(KEY);
                expect(h.loaderCalls).toHaveLength(1);
                await h.settle();
                expect((await a).handle).toBe((await b).handle);
            } finally {
                h.dispose();
            }
        });
    });

    it('revives a released texture from the pool instead of re-fetching', async () => {
        // I4's premise. With no revive there is nothing that could hand back a
        // destroyed handle, and "a disposed resource never comes back" would be
        // a claim about a path the property never takes.
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const first = h.assets.loadTexture(KEY);
                await h.settle();
                const handle = (await first).handle;
                h.assets.releaseTexture(KEY);
                expect(h.gpu.freed, 'the pool destroyed it instead of retaining it').not.toContain(handle);

                const second = h.assets.loadTexture(KEY);
                await new Promise((r) => setTimeout(r, 0));
                expect((await second).handle, 'the reload did not revive').toBe(handle);
                expect(h.gpu.revived).toContain(handle);
                expect(h.loaderCalls, 'a revive must not re-fetch').toHaveLength(1);
            } finally {
                h.dispose();
            }
        });
    });

    it('never revives across an invalidate', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const first = h.assets.loadTexture(KEY);
                await h.settle();
                const stale = (await first).handle;
                h.assets.releaseTexture(KEY);      // retained as evictable
                h.assets.invalidate(KEY);          // bytes changed -> residency severed

                expect(h.gpu.freed, 'severing must destroy the retained texture').toContain(stale);

                const second = h.assets.loadTexture(KEY);
                await h.settle();
                expect((await second).handle, 'a severed key served stale bytes').not.toBe(stale);
                expect(h.gpu.revived).toEqual([]);
            } finally {
                h.dispose();
            }
        });
    });

    it('goes red when a leak is injected', async () => {
        // The sabotage: a pool that quietly ignores releases. If the teardown
        // claim cannot fail here, it cannot fail anywhere.
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const load = h.assets.loadTexture(KEY);
                await h.settle();
                const { handle } = await load;

                const swallow = vi.spyOn(h.gpu.refs, 'set').mockReturnValue(h.gpu.refs);
                h.assets.releaseTexture(KEY);
                swallow.mockRestore();

                const owed = h.gpu.created.filter((c) => (h.gpu.refs.get(c) ?? 0) > 0);
                expect(owed, 'a swallowed release left no trace — the leak check is blind').toEqual([handle]);
            } finally {
                h.dispose();
            }
        });
    });
});

describe('regression: the interleaving the property found', () => {
    /**
     * load(k) → invalidate(k) → the superseded load resolves → release(k).
     *
     * One ledger slot per key put the resolving load's acquire on the generation
     * invalidate had just minted, and release() — finding no cache entry — freed
     * nothing. One texture stranded per hot reload.
     */
    it('releases the handle a superseded load handed out', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const load = h.assets.loadTexture(KEY);
                h.assets.invalidate(KEY);
                await h.settle();
                const { handle } = await load;

                h.assets.releaseTexture(KEY);

                expect(h.gpu.refs.get(handle), `handle ${handle} was stranded by the invalidate`).toBe(0);
                expect(h.gpu.freed, 'a severed key must destroy its texture, not retain it').toContain(handle);
                expect([...textureRefs(h.assets).keys()], 'an orphan refcount survived').toEqual([]);
            } finally {
                h.dispose();
            }
        });
    });

    it('releases both generations when a reload happens under a live holder', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const first = h.assets.loadTexture(KEY);
                await h.settle();
                const older = (await first).handle;

                h.assets.invalidate(KEY);            // bytes changed on disk

                const second = h.assets.loadTexture(KEY);
                await h.settle();
                const newer = (await second).handle;
                expect(newer).not.toBe(older);

                h.assets.releaseTexture(KEY);        // the first holder lets go
                h.assets.releaseTexture(KEY);        // the second holder lets go

                expect(h.gpu.refs.get(older)).toBe(0);
                expect(h.gpu.refs.get(newer)).toBe(0);
                expect(h.gpu.doubleReleased).toEqual([]);
                expect([...textureRefs(h.assets).keys()]).toEqual([]);
            } finally {
                h.dispose();
            }
        });
    });
});

describe('findings the property surfaced but does not assert', () => {
    /**
     * A CALLER bug the engine survives: no count goes negative, nothing is
     * freed twice. It does consume the reference an undelivered load holds, so
     * that caller's `await` resolves with a destroyed handle.
     * @remarks Recorded, not asserted away; a safer engine would ignore it.
     */
    it('an over-release consumes an undelivered load\'s reservation', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const load = h.assets.loadTexture(KEY);
                await h.settle();
                await new Promise((r) => setTimeout(r, 0));   // the SDK has its ref

                h.assets.releaseTexture(KEY);                 // nobody was handed anything yet
                const { handle } = await load;

                expect(h.gpu.refs.get(handle), 'the reservation was consumed').toBe(0);
                expect(h.gpu.doubleReleased, 'but never below zero — I3 holds').toEqual([]);
                expect([...textureRefs(h.assets).keys()], 'and the ledger is clean').toEqual([]);
            } finally {
                h.dispose();
            }
        });
    });

    /**
     * One release, two references: the flipped and unflipped variants are
     * separate cache keys and releaseTexture drains one from each. Two loads of
     * the same file therefore need only ONE release between them — an asymmetry
     * with load*() that is easy to write a leak against.
     */
    it('one releaseTexture drops a reference from BOTH flip variants', async () => {
        await withoutLoadTimeout(async () => {
            const h = manualHarness();
            try {
                const flipped = h.assets.loadTexture(KEY);
                await h.settle();
                const raw = h.assets.loadTextureRaw(KEY);
                await h.settle();
                const a = (await flipped).handle;
                const b = (await raw).handle;
                expect(a).not.toBe(b);

                h.assets.releaseTexture(KEY);

                expect(h.gpu.refs.get(a), 'the flipped variant was released').toBe(0);
                expect(h.gpu.refs.get(b), 'and so was the unflipped one, by the same call').toBe(0);
            } finally {
                h.dispose();
            }
        });
    });
});
