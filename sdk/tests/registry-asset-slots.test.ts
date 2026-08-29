// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry-asset-slots.test.ts
 * @brief   What a holder of a ref-bound asset owns: the slot, not an era.
 *
 * @details A component holding `clip = "walk.esanim"` asks the registry what
 *          that name means on every lookup, so it follows a republish without
 *          being told. Owning an era instead would put ownership one generation
 *          behind what is actually on screen the moment a hot update landed.
 */
import { describe, it, expect } from 'vitest';
import { RegistryAssetSlots, type RegistryAssetKind } from '../src/asset/registryAssets';
import { AssetScope, type AssetLease } from '../src/asset/AssetLease';

/** A kind whose every era is a distinguishable object owning one dependency. */
function fixture() {
    const released: string[] = [];
    let era = 0;
    const kind: RegistryAssetKind<{ id: string }> = {
        prepare: async (path: string) => {
            const name = `${path}#${++era}`;
            const dependencies = new AssetScope();
            dependencies.add(fakeLease(`${name}:texture`, released));
            return { published: { name }, value: { id: path }, dependencies, edges: [] };
        },
    };
    return { released, kind };
}

function fakeLease(key: string, released: string[]): AssetLease {
    const lease: AssetLease = {
        key, generation: 1, value: null,
        release: () => released.push(key),
        retain: () => fakeLease(key, released),
    };
    return lease;
}

/** The same, with every preparation held open until the test lets it finish. */
function gated() {
    const released: string[] = [];
    const pending = new Map<number, () => void>();
    let era = 0;
    const kind: RegistryAssetKind<{ id: string }> = {
        prepare: async (path: string) => {
            const name = `${path}#${++era}`;
            await new Promise<void>((resolve) => pending.set(era, resolve));
            const dependencies = new AssetScope();
            dependencies.add(fakeLease(`${name}:texture`, released));
            return { published: { name }, value: { id: path }, dependencies, edges: [] };
        },
    };
    /** Let preparation `n` finish, once whatever starts it has had its turn. */
    const finish = async (n: number): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        pending.get(n)!();
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { released, kind, finish };
}

describe('a refresh publishes only if it is still the current one', () => {
    it('a preparation that started earlier cannot land on top of a newer one', async () => {
        // Two updates in flight is what propagation makes ordinary: a change to
        // one texture re-prepares every parent that took it, twice in a row if
        // the file is saved twice. Whichever finishes last would win.
        const { released, kind, finish } = gated();
        const slots = new RegistryAssetSlots();
        const acquiring = slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        await finish(1);
        await acquiring;

        const older = slots.republish(kind, 'anim-clip', 'walk.esanim');
        const newer = slots.republish(kind, 'anim-clip', 'walk.esanim');
        await finish(3);
        expect(await newer).toBe(true);
        await finish(2);

        expect(await older, 'the stale preparation published itself').toBe(false);
        expect(slots.published('anim-clip', 'walk.esanim')).toEqual({ name: 'walk.esanim#3' });
        expect(released, 'the stale era kept what it had acquired')
            .toContain('walk.esanim#2:texture');
    });

    it('an acquire that lands after the realm let go has no owner to hand to', async () => {
        // Publishing it would put an era under a name the realm no longer keeps,
        // and hand a lease on it to a caller whose world is already gone. The
        // texture path answers a teardown-during-load the same way.
        const { released, kind, finish } = gated();
        const slots = new RegistryAssetSlots();
        const acquiring = slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        // Watched before the gate opens: the acquire rejects the moment the
        // preparation lands, and a rejection nobody is holding yet is an
        // unhandled one — which would then be indistinguishable from a real leak.
        const rejects = expect(acquiring).rejects.toThrow(/released while it was loading/);

        slots.releaseAll();
        await finish(1);

        await rejects;
        expect(released, 'the era nobody could own kept what it took')
            .toEqual(['walk.esanim#1:texture']);
        expect(slots.size).toBe(0);
    });

    it('a slot whose last holder left while it prepared stays gone', async () => {
        // Publishing into it would put an era under a name nothing resolves to
        // any more: no holder can ever release it, so nothing it took comes back.
        const { released, kind, finish } = gated();
        const slots = new RegistryAssetSlots();
        const acquiring = slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        await finish(1);
        const held = await acquiring;

        const refresh = slots.republish(kind, 'anim-clip', 'walk.esanim');
        held.release();
        await finish(2);

        expect(await refresh).toBe(false);
        expect(slots.size).toBe(0);
        expect(slots.published('anim-clip', 'walk.esanim')).toBeUndefined();
        expect(released).toEqual(['walk.esanim#1:texture', 'walk.esanim#2:texture']);
    });
});

describe('a ref-bound asset is owned as a slot', () => {
    it('the last holder takes the publication and its dependencies with it', async () => {
        // The permanent pin this replaces: nothing released a registry-backed
        // asset, so what it had baked in stayed loaded for the life of the app.
        const { released, kind } = fixture();
        const slots = new RegistryAssetSlots();

        const a = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const b = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        expect(slots.size).toBe(1);
        expect(slots.published('anim-clip', 'walk.esanim')).toEqual({ name: 'walk.esanim#1' });

        a.release();
        expect(slots.published('anim-clip', 'walk.esanim'), 'published while B still holds it').toBeDefined();
        expect(released).toEqual([]);

        b.release();
        expect(slots.published('anim-clip', 'walk.esanim'), 'the last holder left it published').toBeUndefined();
        expect(released).toEqual(['walk.esanim#1:texture']);
        expect(slots.size).toBe(0);
    });

    it('a republish swaps what every name resolves to, and retires only the old era', async () => {
        const { released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const held = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim', 'assets/walk.esanim']);

        expect(await slots.republish(kind, 'anim-clip', 'assets/walk.esanim')).toBe(true);
        // Both names, one slot, one era.
        expect(slots.published('anim-clip', 'walk.esanim')).toEqual({ name: 'walk.esanim#2' });
        expect(slots.published('anim-clip', 'assets/walk.esanim')).toEqual({ name: 'walk.esanim#2' });
        expect(released, 'the era it replaced gave back what it held').toEqual(['walk.esanim#1:texture']);

        // The holder never named an era, so it holds the slot exactly as before.
        held.release();
        expect(slots.size).toBe(0);
        expect(released).toEqual(['walk.esanim#1:texture', 'walk.esanim#2:texture']);
    });

    it('a retiring era cannot unpublish the era that replaced it', async () => {
        // The bug a per-loader `unregister(path)` on unload would have written:
        // gen1's cleanup deleting the entry gen2 had just published under the
        // same name. Publication is the slot's, so an era has no way to.
        const { kind } = fixture();
        const slots = new RegistryAssetSlots();
        const first = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const second = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        await slots.republish(kind, 'anim-clip', 'walk.esanim');

        first.release();
        expect(slots.published('anim-clip', 'walk.esanim'), 'gen1 leaving took gen2 out').toEqual({ name: 'walk.esanim#2' });
        second.release();
        expect(slots.published('anim-clip', 'walk.esanim')).toBeUndefined();
    });

    it('every alias resolves to one slot, not to a copy of the object', async () => {
        const { kind } = fixture();
        const slots = new RegistryAssetSlots();
        await slots.acquire(kind, 'anim-clip', 'http://cdn/walk.esanim',
            ['http://cdn/walk.esanim', 'assets/walk.esanim', '@uuid:1']);

        expect(slots.size, 'three names, one asset').toBe(1);
        const published = slots.published('anim-clip', 'http://cdn/walk.esanim');
        expect(slots.published('anim-clip', 'assets/walk.esanim')).toBe(published);
        expect(slots.published('anim-clip', '@uuid:1')).toBe(published);

        await slots.republish(kind, 'anim-clip', '@uuid:1');
        const next = slots.published('anim-clip', '@uuid:1');
        expect(next).not.toBe(published);
        // The stale-alias split brain: one name still answering with the old era.
        expect(slots.published('anim-clip', 'assets/walk.esanim')).toBe(next);
        expect(slots.published('anim-clip', 'http://cdn/walk.esanim')).toBe(next);
    });

    it('a failed republish leaves the holders exactly what they had', async () => {
        const { released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const held = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const broken = { ...kind, prepare: async () => { throw new Error('no bytes'); } };

        await expect(slots.republish(broken, 'anim-clip', 'walk.esanim')).rejects.toThrow('no bytes');
        expect(slots.published('anim-clip', 'walk.esanim')).toEqual({ name: 'walk.esanim#1' });
        expect(released, 'it gave back what a failed update never replaced').toEqual([]);

        // And the slot still knows WHICH era it is holding: a failure that left
        // it with none would strand that era's dependencies at the last release.
        held.release();
        expect(released).toEqual(['walk.esanim#1:texture']);
    });

    it('a retained claim is on the same slot, and the last one still ends it', async () => {
        const { kind } = fixture();
        const slots = new RegistryAssetSlots();
        const scene = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const entity = scene.retain()!;
        expect(entity.generation).toBe(scene.generation);   // the same slot

        scene.release();
        expect(slots.published('anim-clip', 'walk.esanim'), 'the entity still uses it').toBeDefined();
        entity.release();
        expect(slots.published('anim-clip', 'walk.esanim')).toBeUndefined();
    });

    it('one name under two asset types is two slots', async () => {
        // Lookup identity is (type, name). Bare names would have a project's own
        // registry-backed type share an entry with an engine one the moment they
        // answered to the same name — today only the extensions keep them apart.
        const { kind } = fixture();
        const slots = new RegistryAssetSlots();
        const clip = await slots.acquire(kind, 'anim-clip', 'same', ['same']);
        const timeline = await slots.acquire(kind, 'timeline', 'same', ['same']);

        expect(slots.size).toBe(2);
        expect(clip.generation).not.toBe(timeline.generation);
        expect(slots.published('anim-clip', 'same')).not.toBe(slots.published('timeline', 'same'));

        clip.release();
        expect(slots.published('anim-clip', 'same')).toBeUndefined();
        expect(slots.published('timeline', 'same'), 'one type took the other out').toBeDefined();
        timeline.release();
        expect(slots.size).toBe(0);
    });

    it('two acquires racing the first load publish one era, not two', async () => {
        const { released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const [a, b] = await Promise.all([
            slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']),
            slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']),
        ]);
        expect(slots.published('anim-clip', 'walk.esanim')).toEqual({ name: 'walk.esanim#1' });
        expect(released, 'a second era was prepared and stranded').toEqual([]);
        a.release();
        b.release();
        expect(slots.size).toBe(0);
    });
});
