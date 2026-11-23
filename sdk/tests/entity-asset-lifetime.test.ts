// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetScope, ownedAssetLease } from '../src/asset/AssetLease';
import { EmbeddedBackend } from '../src/asset/Backend';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';
import { MeshRenderer, Sprite } from '../src/ecs/component';
import { flushEngineStamps } from '../src/ecs/engineStamps';
import { World } from '../src/ecs/world';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const receipt = (dispose: () => void) => ownedAssetLease('resource', 1, 7, dispose, 'texture');

describe.skipIf(!HAS_WASM)('entity ownership across registry bindings', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    for (const component of [Sprite, MeshRenderer] as const) {
        it.each(['disconnect', 'replace'])('retires ' + component._name + ' before another registry reuses the id (%s)', action => {
            const first = new core.Registry(), second = new core.Registry(), world = new World(), scopes = new EntityAssetScopes();
            const other = new World(), otherReg = new core.Registry();
            try {
                world.connectCpp(first, core); other.connectCpp(otherReg, core);
                const entity = world.spawn(), otherEntity = other.spawn();
                expect(entity).toBe(otherEntity);
                const disposed = vi.fn(), another = vi.fn();
                world.insert(entity, component, { texture: 7 });
                const held = scopes.ensure(world, entity), sibling = scopes.ensure(other, otherEntity);
                held.add(receipt(disposed)); sibling.add(receipt(another));
                world.connectCpp(first, core, { strict: true });
                expect(scopes.scopeFor(entity, world)).toBe(held);
                expect(world.get(entity, component).texture).toBe(7); expect(disposed).not.toHaveBeenCalled();
                if (action === 'disconnect') world.disconnectCpp();
                world.connectCpp(second, core);
                const next = world.spawn();
                expect(next).toBe(entity); expect(held.size).toBe(0);
                expect(scopes.scopeFor(next, world)).toBeNull();
                expect(scopes.scopeFor(otherEntity, other)).toBe(sibling);
                expect(disposed).toHaveBeenCalledTimes(1); expect(another).not.toHaveBeenCalled();
                expect(first.valid(entity)).toBe(true);
                const replacement = vi.fn(); scopes.ensure(world, next).add(receipt(replacement));
                world.despawn(next); expect(replacement).toHaveBeenCalledTimes(1);
                expect(disposed).toHaveBeenCalledTimes(1);
                other.despawn(otherEntity); expect(another).toHaveBeenCalledTimes(1);
                expect(scopes.size).toBe(0);
                expect(world.getStorageSizes()).toMatchObject({ coreDisconnectCallbacks: 0, despawnCallbacks: 0 });
            } finally { world.disconnectCpp(); other.disconnectCpp(); first.delete(); second.delete(); otherReg.delete(); }
        });
    }

    it('closes every scope while the departing registry is still bound and refuses reentrant ownership', () => {
        const first = new core.Registry(), second = new core.Registry(), world = new World(), scopes = new EntityAssetScopes();
        try {
            world.connectCpp(first, core);
            const a = world.spawn(), b = world.spawn(), released = vi.fn();
            const aScope = scopes.ensure(world, a), bScope = scopes.ensure(world, b);
            const events: unknown[] = [];
            aScope.add(receipt(() => {
                events.push(world.getCppRegistry() === first, world.isDestructionPending(b), scopes.scopeFor(b, world) === null);
                try { scopes.ensure(world, b); events.push(false); } catch { events.push(true); }
                world.disconnectCpp();
                throw Error('failed cleanup');
            }));
            bScope.add(receipt(released));
            let recovered = false;
            const stop = world.onCoreDisconnect(() => {
                try { scopes.ensure(world, a); } catch { recovered = true; }
            });
            world.connectCpp(second, core); stop();
            expect(events).toEqual([true, true, true, true]); expect(recovered).toBe(true);
            expect(world.getCppRegistry()).toBe(second); expect(released).toHaveBeenCalledTimes(1);
            expect(scopes.size).toBe(0); expect(aScope.size + bScope.size).toBe(0);
        } finally { world.disconnectCpp(); first.delete(); second.delete(); }
    });

    it('finishes writes in their original registry and detaches its stamp callback', () => {
        const first = new core.Registry(), second = new core.Registry(), world = new World();
        try {
            world.connectCpp(first, core); const a = world.spawn(); world.insert(a, Sprite);
            world.flushEngineStamps(); const type = first.componentTypeId!('Sprite'), before = first.beginChangeRead();
            const stop = world.onCoreDisconnect(() => world.markChanged(a, Sprite));
            world.connectCpp(second, core); stop();
            expect(first.componentChangedSince(type, a, before)).toBe(true);
            const b = world.spawn(); world.insert(b, Sprite); world.flushEngineStamps();
            const next = second.beginChangeRead(); world.markChanged(b, Sprite);
            flushEngineStamps(first);
            expect(second.componentChangedSince(type, b, next)).toBe(false);
            flushEngineStamps(second);
            expect(second.componentChangedSince(type, b, next)).toBe(true);
        } finally { world.disconnectCpp(); first.delete(); second.delete(); }
    });

    it('releases an established binding during failed revalidation and leaves the World usable', () => {
        const registry = new core.Registry(), world = new World(), scopes = new EntityAssetScopes();
        try {
            world.connectCpp(registry, core); const entity = world.spawn(), observed: boolean[] = [];
            scopes.ensure(world, entity).add(receipt(() => observed.push(world.getCppRegistry() === registry)));
            const addSprite = registry.addSprite;
            Object.defineProperty(registry, 'addSprite', { configurable: true, writable: true, value: undefined });
            expect(() => world.connectCpp(registry, core, { strict: true })).toThrow(/Sprite/);
            expect(observed).toEqual([true]); expect(world.hasCpp).toBe(false); expect(scopes.size).toBe(0);
            registry.addSprite = addSprite;
            world.connectCpp(registry, core, { strict: true }); expect(world.hasCpp).toBe(true);
        } finally { world.disconnectCpp(); registry.delete(); }
    });

    it('retires JS-only entity ownership when its World binds a registry', () => {
        const world = new World(), registry = new core.Registry(), scopes = new EntityAssetScopes(), release = vi.fn();
        try {
            const entity = world.spawn(); scopes.ensure(world, entity).add(receipt(release));
            world.connectCpp(registry, core);
            expect(release).toHaveBeenCalledTimes(1); expect(scopes.scopeFor(entity, world)).toBeNull();
        } finally { world.disconnectCpp(); registry.delete(); }
    });
});

describe('entity ownership at asset reset', () => {
    it('detaches worlds before invoking unloaders and starts the next realm with fresh owners', () => {
        const assets = Assets.create({ backend: new EmbeddedBackend({}), module: null }), first = new World(), second = new World();
        const a = first.spawn(), b = second.spawn(), former = assets.entityScopes;
        const firstScope = former.ensure(first, a), secondScope = former.ensure(second, b);
        const failure = new Error('custom unloader failed'), later = vi.fn(), events: unknown[] = [];
        firstScope.add(receipt(() => {
            events.push(former.size, former.scopeFor(b, second), assets.entityScopes === former);
            try { assets.entityScopes.ensure(second, b); events.push(false); } catch { events.push(true); }
            assets.releaseAll();
            throw failure;
        }));
        secondScope.add(receipt(later));
        expect(() => assets.releaseAll()).toThrow(failure);
        expect(events).toEqual([0, null, true, true]);
        expect(later).toHaveBeenCalledTimes(1); expect(firstScope.size + secondScope.size).toBe(0);
        for (const world of [first, second]) expect(world.getStorageSizes()).toMatchObject({ despawnCallbacks: 0, coreDisconnectCallbacks: 0 });
        expect(() => former.ensure(first, a)).toThrow();
        const fresh = assets.entityScopes.ensure(first, a), next = vi.fn();
        fresh.add(receipt(next)); first.despawn(a); expect(next).toHaveBeenCalledTimes(1);
        second.despawn(b); assets.releaseAll();
    });

    it('disposes late acquisitions handed to a retired entity and leaves a failed transfer with its source', async () => {
        const world = new World(), owners = new EntityAssetScopes(), entity = world.spawn(), held = owners.ensure(world, entity);
        const direct = vi.fn(), transferred = vi.fn(), source = new AssetScope();
        const late = Promise.resolve().then(() => held.add(receipt(direct)));
        world.despawn(entity); source.add(receipt(transferred));
        await expect(late).rejects.toThrow(); expect(direct).toHaveBeenCalledTimes(1);
        expect(() => held.absorb(source)).toThrow(); expect(held.size).toBe(0);
        expect(source.size).toBe(1); source.releaseAll(); expect(transferred).toHaveBeenCalledTimes(1);
    });
});
