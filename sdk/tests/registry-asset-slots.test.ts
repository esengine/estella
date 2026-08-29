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
import { RegistryAssetSlots, type RegistryAssetKind, type RegistryEra } from '../src/asset/registryAssets';
import { AssetScope, type AssetLease } from '../src/asset/AssetLease';

/** A registry, and a kind that publishes into it — the two halves a loader has. */
function fixture() {
    const registry = new Map<string, unknown>();
    const released: string[] = [];
    let era = 0;
    const kind: RegistryAssetKind<{ id: string }> = {
        prepare: async (path: string): Promise<RegistryEra<{ id: string }>> => {
            const name = `${path}#${++era}`;
            const dependencies = new AssetScope();
            dependencies.add(fakeLease(`${name}:texture`, released));
            return { published: { name }, value: { id: path }, dependencies };
        },
        publish: (names, published) => { for (const n of names) registry.set(n, published); },
        unpublish: (names) => { for (const n of names) registry.delete(n); },
    };
    return { registry, released, kind };
}

function fakeLease(key: string, released: string[]): AssetLease {
    const lease: AssetLease = {
        key, generation: 1, value: null,
        release: () => released.push(key),
        retain: () => fakeLease(key, released),
    };
    return lease;
}

describe('a ref-bound asset is owned as a slot', () => {
    it('the last holder takes the publication and its dependencies with it', async () => {
        // The permanent pin this replaces: nothing released a registry-backed
        // asset, so what it had baked in stayed loaded for the life of the app.
        const { registry, released, kind } = fixture();
        const slots = new RegistryAssetSlots();

        const a = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const b = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        expect(slots.size).toBe(1);
        expect(registry.get('walk.esanim')).toEqual({ name: 'walk.esanim#1' });

        a.release();
        expect(registry.has('walk.esanim'), 'published while B still holds it').toBe(true);
        expect(released).toEqual([]);

        b.release();
        expect(registry.has('walk.esanim'), 'the last holder left it published').toBe(false);
        expect(released).toEqual(['walk.esanim#1:texture']);
        expect(slots.size).toBe(0);
    });

    it('a republish swaps what every name resolves to, and retires only the old era', async () => {
        const { registry, released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const held = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim', 'assets/walk.esanim']);

        expect(await slots.republish(kind, 'anim-clip', 'assets/walk.esanim')).toBe(true);
        // Both names, one slot, one era.
        expect(registry.get('walk.esanim')).toEqual({ name: 'walk.esanim#2' });
        expect(registry.get('assets/walk.esanim')).toEqual({ name: 'walk.esanim#2' });
        expect(released, 'the era it replaced gave back what it held').toEqual(['walk.esanim#1:texture']);

        // The holder never named an era, so it holds the slot exactly as before.
        held.release();
        expect(registry.size).toBe(0);
        expect(released).toEqual(['walk.esanim#1:texture', 'walk.esanim#2:texture']);
    });

    it('a retiring era cannot unpublish the era that replaced it', async () => {
        // The bug a per-loader `unregister(path)` on unload would have written:
        // gen1's cleanup deleting the entry gen2 had just published under the
        // same name. Publication is the slot's, so an era has no way to.
        const { registry, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const first = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const second = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        await slots.republish(kind, 'anim-clip', 'walk.esanim');

        first.release();
        expect(registry.get('walk.esanim'), 'gen1 leaving took gen2 out').toEqual({ name: 'walk.esanim#2' });
        second.release();
        expect(registry.has('walk.esanim')).toBe(false);
    });

    it('every alias resolves to one slot, not to a copy of the object', async () => {
        const { registry, kind } = fixture();
        const slots = new RegistryAssetSlots();
        await slots.acquire(kind, 'anim-clip', 'http://cdn/walk.esanim',
            ['http://cdn/walk.esanim', 'assets/walk.esanim', '@uuid:1']);

        expect(slots.size, 'three names, one asset').toBe(1);
        const published = registry.get('http://cdn/walk.esanim');
        expect(registry.get('assets/walk.esanim')).toBe(published);
        expect(registry.get('@uuid:1')).toBe(published);

        await slots.republish(kind, 'anim-clip', '@uuid:1');
        const next = registry.get('@uuid:1');
        expect(next).not.toBe(published);
        // The stale-alias split brain: one name still answering with the old era.
        expect(registry.get('assets/walk.esanim')).toBe(next);
        expect(registry.get('http://cdn/walk.esanim')).toBe(next);
    });

    it('a failed republish leaves the holders exactly what they had', async () => {
        const { registry, released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const held = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const broken = { ...kind, prepare: async () => { throw new Error('no bytes'); } };

        await expect(slots.republish(broken, 'anim-clip', 'walk.esanim')).rejects.toThrow('no bytes');
        expect(registry.get('walk.esanim')).toEqual({ name: 'walk.esanim#1' });
        expect(released, 'it gave back what a failed update never replaced').toEqual([]);

        // And the slot still knows WHICH era it is holding: a failure that left
        // it with none would strand that era's dependencies at the last release.
        held.release();
        expect(released).toEqual(['walk.esanim#1:texture']);
    });

    it('a retained claim is on the same slot, and the last one still ends it', async () => {
        const { registry, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const scene = await slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']);
        const entity = scene.retain()!;
        expect(entity.generation).toBe(scene.generation);   // the same slot

        scene.release();
        expect(registry.has('walk.esanim'), 'the entity still uses it').toBe(true);
        entity.release();
        expect(registry.has('walk.esanim')).toBe(false);
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
        const { registry, released, kind } = fixture();
        const slots = new RegistryAssetSlots();
        const [a, b] = await Promise.all([
            slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']),
            slots.acquire(kind, 'anim-clip', 'walk.esanim', ['walk.esanim']),
        ]);
        expect(registry.get('walk.esanim')).toEqual({ name: 'walk.esanim#1' });
        expect(released, 'a second era was prepared and stranded').toEqual([]);
        a.release();
        b.release();
        expect(slots.size).toBe(0);
    });
});
