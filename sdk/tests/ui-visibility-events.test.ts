// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `shown` / `hidden`, both halves: the listener count the watcher gates on
 *        (EntityEventQueue) and the watcher itself, driven through a mock-wasm App
 *        whose `getUINodeHiddenInTree` answers what a test says the layout pass
 *        resolved. The gating is the design — a UI nobody is listening to, or one
 *        that did not move, must not be scanned — so it is asserted by counting the
 *        reads the watcher makes, not just the events it emits.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPendingSystems } from '../src/app/app';
import type { App } from '../src/app/app';
import { EntityEventQueue } from '../src/ecs/entityEvents';
import { UIEvents, UIEventQueue, UIEventType } from '../src/ui/core/events';
import { UINode } from '../src/ui/core/ui-node';
import { uiVisibilityPlugin } from '../src/ui/core/visibility';
import { bootMockApp } from './helpers/mockApp';
import type { MockModule } from './mocks/wasm';
import type { Entity } from '../src/types';

describe('EntityEventQueue.hasListenersFor', () => {
    it('is false until someone subscribes and false again once they all leave', () => {
        const events = new EntityEventQueue();
        expect(events.hasListenersFor('shown')).toBe(false);

        const offGlobal = events.on('shown', () => {});
        expect(events.hasListenersFor('shown')).toBe(true);

        const offEntity = events.on(7 as never, 'shown', () => {});
        offGlobal();
        expect(events.hasListenersFor('shown')).toBe(true); // the entity one is still there

        offEntity();
        expect(events.hasListenersFor('shown')).toBe(false);
    });

    it('counts each handler once, so unsubscribing twice cannot make it negative', () => {
        const events = new EntityEventQueue();
        const handler = () => {};
        const off = events.on(1 as never, 'hidden', handler);
        events.on(1 as never, 'hidden', handler); // same handler: the Set holds one

        off();
        expect(events.hasListenersFor('hidden')).toBe(false);
        off();
        expect(events.hasListenersFor('hidden')).toBe(false);
    });

    it('removeAll(entity) takes that entity\'s handlers out of the count', () => {
        const events = new EntityEventQueue();
        events.on(3 as never, 'shown', () => {});
        events.on(3 as never, 'hidden', () => {});
        expect(events.hasListenersFor('shown')).toBe(true);

        events.removeAll(3 as never);
        expect(events.hasListenersFor('shown')).toBe(false);
        expect(events.hasListenersFor('hidden')).toBe(false);
    });

    it('an event with no listeners still reaches drain() — this gates WATCHING, not emitting', () => {
        const events = new EntityEventQueue();
        events.emit(5 as never, 'shown');
        expect(events.drain().map((e) => e.type)).toEqual(['shown']);
    });

    it('a listener still gets its events after the count has been through zero', () => {
        const events = new EntityEventQueue();
        const seen = vi.fn();
        events.on('shown', () => {})();
        events.on('shown', seen);
        events.emit(2 as never, 'shown');
        expect(seen).toHaveBeenCalledTimes(1);
    });
});

describe('UIVisibilityPlugin', () => {
    let app: App;
    let module: MockModule;
    let events: UIEventQueue;
    /** How many times the watcher asked the engine for a node's resolved bit. */
    let reads: number;

    beforeEach(() => {
        const booted = bootMockApp();
        app = booted.app;
        module = booted.module;

        reads = 0;
        const answer = module.getUINodeHiddenInTree!.bind(module);
        module.getUINodeHiddenInTree = (registry, entity) => {
            reads++;
            return answer(registry, entity);
        };

        events = new UIEventQueue();
        app.insertResource(UIEvents, events);
        uiVisibilityPlugin.build(app);
        flushPendingSystems(app);
    });

    /** A UI node, on screen unless told otherwise. */
    const addNode = (): Entity => {
        const e = app.world.spawn();
        app.world.insert(e, UINode, {});
        return e;
    };

    /** What the layout pass resolved for `e` this frame. */
    const resolve = (e: Entity, hidden: boolean): void => {
        module.setUINodeHiddenInTree(e, hidden);
        // A display edit is a UINode write; that is the signal the watcher gates on.
        app.world.insert(e, UINode, { display: hidden ? 1 : 0 });
    };

    const tick = async (): Promise<string[]> => {
        await app.tick(1 / 60);
        return events.drain().map((ev) => `${ev.type}:${ev.target}`);
    };

    const listen = (): void => { events.on(UIEventType.Shown, () => {}); };

    it('says nothing about the nodes it finds on the first look — those are not changes', async () => {
        listen();
        const a = addNode();
        module.setUINodeHiddenInTree(a, true);
        expect(await tick()).toEqual([]);
    });

    it('emits `hidden` when a node leaves the screen and `shown` when it comes back', async () => {
        listen();
        const panel = addNode();
        await tick(); // baseline: on screen

        resolve(panel, true);
        expect(await tick()).toEqual([`${UIEventType.Hidden}:${panel}`]);

        resolve(panel, false);
        expect(await tick()).toEqual([`${UIEventType.Shown}:${panel}`]);
    });

    it('reports a node hidden by an ANCESTOR, which is the case that has no local edit', async () => {
        listen();
        const panel = addNode();
        const label = addNode();
        app.world.setParent(label, panel);
        await tick();

        // The parent's display changed; the child's own UINode was never written, and
        // the engine resolved the whole subtree as hidden.
        module.setUINodeHiddenInTree(label, true);
        resolve(panel, true);

        expect((await tick()).sort()).toEqual(
            [`${UIEventType.Hidden}:${label}`, `${UIEventType.Hidden}:${panel}`].sort(),
        );
    });

    it('does not scan while nobody is listening, and never reports what changed then', async () => {
        const panel = addNode();
        await tick();
        expect(reads).toBe(0); // no listener ⇒ the engine was not asked anything

        resolve(panel, true);
        expect(await tick()).toEqual([]);

        // Subscribing starts from what is on screen NOW: the node is already hidden,
        // so there is no change to announce — and no stale `hidden` from before.
        listen();
        expect(await tick()).toEqual([]);
        resolve(panel, false);
        expect(await tick()).toEqual([`${UIEventType.Shown}:${panel}`]);
    });

    it('does not scan a frame in which nothing moved', async () => {
        listen();
        addNode();
        await tick();

        const settled = reads;
        await tick();
        await tick();
        expect(reads).toBe(settled); // steady frames cost no engine reads at all
    });

    it('scans again after a reparent, which touches no UINode', async () => {
        listen();
        const panel = addNode();
        const label = addNode();
        await tick();
        await tick(); // let the change watermark settle

        const settled = reads;
        app.world.setParent(label, panel);
        module.setUINodeHiddenInTree(label, true);
        expect(await tick()).toEqual([`${UIEventType.Hidden}:${label}`]);
        expect(reads).toBeGreaterThan(settled);
    });

    it('forgets a despawned entity, so a recycled id does not inherit its state', async () => {
        listen();
        const panel = addNode();
        resolve(panel, true);
        await tick();

        app.world.despawn(panel);
        await tick();
        expect(events.drain()).toEqual([]);
    });
});
