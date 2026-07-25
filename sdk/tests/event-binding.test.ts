// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    event-binding.test.ts
 * @brief   Authored event → action wiring: target resolution (nearest-name),
 *          dispatch through the shared aiRegistry, guards/once/enabled, and
 *          bubbling from a child into an ancestor's rows.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EntityEventQueue } from '../src/entityEvents';
import {
    EventBinding,
    createEventBindingRuntime,
    ensureEventBindingActions,
    resolveBindingTarget,
    type EventBindingRow,
} from '../src/eventBinding';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { Children, Name, Parent } from '../src/component';
import type { AnyComponentDef } from '../src/component';
import type { Entity } from '../src/types';

/** A world stub with just the slice EventBinding touches (+ hierarchy helpers). */
function makeWorld() {
    const storage = new Map<AnyComponentDef, Map<Entity, unknown>>();
    const alive = new Set<Entity>();
    let next = 1;
    const storeFor = (c: AnyComponentDef) => {
        let s = storage.get(c);
        if (!s) storage.set(c, (s = new Map()));
        return s;
    };
    const world = {
        spawn: (name?: string) => {
            const e = next++ as Entity;
            alive.add(e);
            if (name !== undefined) storeFor(Name).set(e, { value: name });
            return e;
        },
        despawn: (e: Entity) => alive.delete(e),
        valid: (e: Entity) => alive.has(e),
        has: (e: Entity, c: AnyComponentDef) => storeFor(c).has(e),
        get: (e: Entity, c: AnyComponentDef) => storeFor(c).get(e),
        set: (e: Entity, c: AnyComponentDef, d: unknown) => storeFor(c).set(e, d),
        insert: (e: Entity, c: AnyComponentDef, d: unknown) => storeFor(c).set(e, d),
        getEntitiesWithComponents: (comps: readonly AnyComponentDef[]) =>
            [...storeFor(comps[0]).keys()].filter((e) => alive.has(e)),
        findEntityByName: (name: string) => {
            for (const [e, d] of storeFor(Name)) {
                if ((d as { value: string }).value === name && alive.has(e)) return e;
            }
            return null;
        },
        /** Test helper: attach `child` under `parent`, maintaining both sides. */
        parent: (child: Entity, parent: Entity) => {
            storeFor(Parent).set(child, { entity: parent });
            const kids = (storeFor(Children).get(parent) as { entities: Entity[] } | undefined) ?? { entities: [] };
            kids.entities.push(child);
            storeFor(Children).set(parent, kids);
        },
    };
    return world;
}
type TestWorld = ReturnType<typeof makeWorld>;

function bind(world: TestWorld, entity: Entity, ...rows: EventBindingRow[]): void {
    world.insert(entity, EventBinding, { rows });
}

/** Runtime over a fresh queue, wired to per-entity throwaway blackboards. */
function makeRuntime(world: TestWorld) {
    const events = new EntityEventQueue();
    const boards = new Map<Entity, Blackboard>();
    const runtime = createEventBindingRuntime({
        world: world as never,
        events,
        blackboardOf: (e) => {
            let bb = boards.get(e);
            if (!bb) boards.set(e, (bb = new Blackboard()));
            return bb;
        },
        commands: () => null,
        dt: () => 1 / 60,
    });
    return { events, runtime, boards };
}

/** Records (entity, arg) for every invocation of the test action. */
let calls: Array<{ entity: Entity; arg?: string }> = [];

beforeEach(() => {
    calls = [];
    aiRegistry.registerAction('test.record', (ctx, _bb, arg) => {
        calls.push({ entity: ctx.entity, arg });
    });
    aiRegistry.registerCondition('test.never', () => false);
    aiRegistry.registerCondition('test.always', () => true);
});

describe('resolveBindingTarget — nearest name wins', () => {
    it('empty target is the entity that carries the binding', () => {
        const world = makeWorld();
        const self = world.spawn('Button');
        expect(resolveBindingTarget(world as never, self, '')).toBe(self);
    });

    it('finds a sibling through the shared parent', () => {
        const world = makeWorld();
        const root = world.spawn('Root');
        const button = world.spawn('Button');
        const panel = world.spawn('Panel');
        world.parent(button, root);
        world.parent(panel, root);
        expect(resolveBindingTarget(world as never, button, 'Panel')).toBe(panel);
    });

    it('prefers the match inside its own subtree over an outer one', () => {
        // Two prefab instances, each with a "Panel": a binding inside instance A
        // must not reach into instance B.
        const world = makeWorld();
        const root = world.spawn('Root');
        const instA = world.spawn('Dialog');
        const instB = world.spawn('Dialog');
        world.parent(instA, root);
        world.parent(instB, root);
        const panelA = world.spawn('Panel');
        const panelB = world.spawn('Panel');
        world.parent(panelA, instA);
        world.parent(panelB, instB);
        const buttonA = world.spawn('Close');
        world.parent(buttonA, instA);

        expect(resolveBindingTarget(world as never, buttonA, 'Panel')).toBe(panelA);
    });

    it('falls back to the world name index for an unrelated root', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        const hud = world.spawn('HUD'); // no shared ancestor
        expect(resolveBindingTarget(world as never, button, 'HUD')).toBe(hud);
    });

    it('returns null when nothing is named that', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        expect(resolveBindingTarget(world as never, button, 'Nope')).toBeNull();
    });
});

describe('dispatch', () => {
    it('runs the row action on click, with the row arg', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(world, button, { event: 'click', action: 'test.record', arg: 'tabs:settings' });

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');

        expect(calls).toEqual([{ entity: button, arg: 'tabs:settings' }]);
    });

    it('runs the action on the NAMED target, not on the emitter', () => {
        const world = makeWorld();
        const root = world.spawn('Root');
        const button = world.spawn('Button');
        const dialog = world.spawn('Dialog');
        world.parent(button, root);
        world.parent(dialog, root);
        bind(world, button, { event: 'click', action: 'test.record', target: 'Dialog' });

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');

        expect(calls).toEqual([{ entity: dialog, arg: undefined }]);
    });

    it('ignores events of other types and rows that are disabled', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(
            world,
            button,
            { event: 'click', action: 'test.record', arg: 'on' },
            { event: 'click', action: 'test.record', arg: 'off', enabled: false },
        );

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'hover_enter');
        events.emit(button, 'click');

        expect(calls.map((c) => c.arg)).toEqual(['on']);
    });

    it('honours a guard condition', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(
            world,
            button,
            { event: 'click', action: 'test.record', arg: 'blocked', guard: 'test.never' },
            { event: 'click', action: 'test.record', arg: 'allowed', guard: 'test.always' },
        );

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');

        expect(calls.map((c) => c.arg)).toEqual(['allowed']);
    });

    it('a `once` row fires exactly once', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(world, button, { event: 'click', action: 'test.record', once: true });

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');
        events.emit(button, 'click');

        expect(calls).toHaveLength(1);
    });

    it('an ancestor row hears a bubbled child event', () => {
        const world = makeWorld();
        const panel = world.spawn('Panel');
        const button = world.spawn('Button');
        world.parent(button, panel);
        bind(world, panel, { event: 'click', action: 'test.record', arg: 'from-panel' });

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        const root = events.emit(button, 'click'); // the child has no rows
        events.emitBubbled(panel, root);           // the interaction layer bubbles

        expect(calls.map((c) => c.arg)).toEqual(['from-panel']);
    });

    it('picks up rows authored after the last sync only once re-synced', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        const { events, runtime } = makeRuntime(world);
        runtime.sync(); // nothing authored yet

        bind(world, button, { event: 'click', action: 'test.record' });
        events.emit(button, 'click');
        expect(calls).toHaveLength(0);

        runtime.sync(); // the per-frame pass the plugin runs
        events.emit(button, 'click');
        expect(calls).toHaveLength(1);
    });

    it('stops dispatching after dispose', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(world, button, { event: 'click', action: 'test.record' });

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        runtime.dispose();
        events.emit(button, 'click');

        expect(calls).toHaveLength(0);
    });

    it('survives an unknown action / missing target without throwing', () => {
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(
            world,
            button,
            { event: 'click', action: 'no.such.action' },
            { event: 'click', action: 'test.record', target: 'Ghost' },
        );

        const { events, runtime } = makeRuntime(world);
        runtime.sync();
        expect(() => events.emit(button, 'click')).not.toThrow();
        expect(calls).toHaveLength(0);
    });
});

describe('the actions events unlock', () => {
    it('fsm.fire raises a trigger on the target blackboard', () => {
        ensureEventBindingActions();
        const world = makeWorld();
        const root = world.spawn('Root');
        const button = world.spawn('Button');
        const hero = world.spawn('Hero');
        world.parent(button, root);
        world.parent(hero, root);
        bind(world, button, { event: 'click', action: 'fsm.fire', arg: 'start', target: 'Hero' });

        const { events, runtime, boards } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');

        expect(boards.get(hero)?.isFired('start')).toBe(true);
    });

    it('blackboard.set parses JSON values, keeps bare words', () => {
        ensureEventBindingActions();
        const world = makeWorld();
        const button = world.spawn('Button');
        bind(
            world,
            button,
            { event: 'click', action: 'blackboard.set', arg: 'lives=3' },
            { event: 'click', action: 'blackboard.set', arg: 'mode=hard' },
        );

        const { events, runtime, boards } = makeRuntime(world);
        runtime.sync();
        events.emit(button, 'click');

        expect(boards.get(button)?.get('lives')).toBe(3);
        expect(boards.get(button)?.get('mode')).toBe('hard');
    });
});
