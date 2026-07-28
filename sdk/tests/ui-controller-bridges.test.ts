// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-controller-bridges.test.ts
 * @brief   The data-driven bridges into a controller: the `ui.setPage` .esfsm
 *          action and the reactive bindControllerPage(signal) binding.
 */
import { describe, expect, it } from 'vitest';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { UIController, controllerState, getControllerPage } from '../src/ui/controller/ui-controller';
import { ensureControllerAiRegistrations } from '../src/ui/controller/ai-builtins';
import { bindControllerPage } from '../src/ui/controller/bind-page';
import { signal } from '../src/ui/binding/signal';
import type { Entity } from '../src/types';
import type { AnyComponentDef } from '../src/ecs/component';

function makeMockWorld() {
    const storage = new Map<AnyComponentDef, Map<Entity, unknown>>();
    const alive = new Set<Entity>();
    const despawnSubs = new Set<(e: Entity) => void>();
    let next = 1;
    const storeFor = (c: AnyComponentDef) => {
        let s = storage.get(c);
        if (!s) { s = new Map(); storage.set(c, s); }
        return s;
    };
    return {
        spawn: () => { const e = next++ as Entity; alive.add(e); return e; },
        despawn: (e: Entity) => { alive.delete(e); for (const fn of [...despawnSubs]) fn(e); },
        valid: (e: Entity) => alive.has(e),
        has: (e: Entity, c: AnyComponentDef) => storeFor(c).has(e),
        get: (e: Entity, c: AnyComponentDef) => storeFor(c).get(e),
        insert: (e: Entity, c: AnyComponentDef, d: unknown) => { storeFor(c).set(e, d); },
        onDespawn: (fn: (e: Entity) => void) => { despawnSubs.add(fn); return () => despawnSubs.delete(fn); },
    };
}
type MockWorld = ReturnType<typeof makeMockWorld>;

function withController(world: MockWorld, current = 'home'): Entity {
    const e = world.spawn();
    world.insert(e, UIController, { controllers: [controllerState('tab', ['home', 'shop', 'info'], current)] });
    return e;
}

describe('ui.setPage — the .esfsm/.esbt bridge', () => {
    it('registers on the shared AI registry (idempotent)', () => {
        ensureControllerAiRegistrations();
        ensureControllerAiRegistrations(); // second call is a no-op
        expect(aiRegistry.hasAction('ui.setPage')).toBe(true);
    });

    it('switches the nearest controller to "controller:page"', () => {
        ensureControllerAiRegistrations();
        const action = aiRegistry.getAction('ui.setPage')!;
        const world = makeMockWorld();
        const e = withController(world);
        action({ world, entity: e } as never, {} as never, 'tab:shop');
        expect(getControllerPage(world as never, e, 'tab')).toBe('shop');
    });

    it('ignores an unknown page, unknown controller, or malformed arg', () => {
        ensureControllerAiRegistrations();
        const action = aiRegistry.getAction('ui.setPage')!;
        const world = makeMockWorld();
        const e = withController(world, 'shop');
        action({ world, entity: e } as never, {} as never, 'tab:zzz');   // unknown page
        action({ world, entity: e } as never, {} as never, 'nope:home'); // unknown controller
        action({ world, entity: e } as never, {} as never, 'noSeparator');
        action({ world, entity: e } as never, {} as never, undefined);
        expect(getControllerPage(world as never, e, 'tab')).toBe('shop');
    });
});

describe('bindControllerPage — the reactive (signal) bridge', () => {
    it('seeds the controller from the signal, then tracks changes', () => {
        const world = makeMockWorld();
        const e = withController(world, 'home');
        const page = signal('shop');
        bindControllerPage(world as never, e, 'tab', page);
        expect(getControllerPage(world as never, e, 'tab')).toBe('shop'); // seeded

        page.set('info');
        expect(getControllerPage(world as never, e, 'tab')).toBe('info');
    });

    it('stops tracking after dispose', () => {
        const world = makeMockWorld();
        const e = withController(world, 'home');
        const page = signal('shop');
        const dispose = bindControllerPage(world as never, e, 'tab', page);
        dispose();
        page.set('info');
        expect(getControllerPage(world as never, e, 'tab')).toBe('shop'); // frozen at dispose-time value
    });

    it('auto-disposes when the entity despawns', () => {
        const world = makeMockWorld();
        const e = withController(world, 'home');
        const page = signal('shop');
        bindControllerPage(world as never, e, 'tab', page);
        world.despawn(e);
        page.set('info'); // entity gone → guarded, no throw
        expect(world.valid(e)).toBe(false);
    });
});
