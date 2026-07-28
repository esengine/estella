// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ai-builtin-verbs.test.ts
 * @brief   The engine verbs an authored wire can reach with no game code:
 *          `property.set` (the generic reflection write) and `ui.setVisible`
 *          (show/hide, on the switch the renderer actually honours).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import { ensureControllerAiRegistrations } from '../src/ui/controller/ai-builtins';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { UINode } from '../src/ui/core/ui-node';
import { UIDisplay } from '../src/wasm/wasm.generated';
import { registerComponent, defineComponent } from '../src/ecs/component';
import type { AnyComponentDef } from '../src/ecs/component';
import type { Entity } from '../src/types';

const Score = defineComponent<{ points: number; label: string }>('TestScore', { points: 0, label: '' });

function makeWorld() {
    const storage = new Map<AnyComponentDef, Map<Entity, unknown>>();
    const storeFor = (c: AnyComponentDef) => {
        let s = storage.get(c);
        if (!s) storage.set(c, (s = new Map()));
        return s;
    };
    return {
        has: (e: Entity, c: AnyComponentDef) => storeFor(c).has(e),
        get: (e: Entity, c: AnyComponentDef) => storeFor(c).get(e),
        set: (e: Entity, c: AnyComponentDef, d: unknown) => storeFor(c).set(e, d),
        insert: (e: Entity, c: AnyComponentDef, d: unknown) => storeFor(c).set(e, d),
        valid: () => true,
    };
}

const E = 1 as Entity;

function ctxFor(world: ReturnType<typeof makeWorld>, entity = E) {
    return {
        entity,
        world,
        dt: 0,
        get: (c: AnyComponentDef) => world.get(entity, c),
        set: (c: AnyComponentDef, d: unknown) => world.set(entity, c, d),
        has: (c: AnyComponentDef) => world.has(entity, c),
    } as never;
}

beforeEach(() => {
    aiRegistry.clear();
    ensureBuiltinAiRegistrations();
    ensureControllerAiRegistrations();
    registerComponent('TestScore', Score);
});

describe('property.set', () => {
    it('writes a component field addressed by Component.path', () => {
        const world = makeWorld();
        world.insert(E, Score, { points: 0, label: '' });

        aiRegistry.getAction('property.set')!(ctxFor(world), new Blackboard(), 'TestScore.points=7');

        expect(world.get(E, Score)).toEqual({ points: 7, label: '' });
    });

    it('keeps a bare word a string, and reads JSON when there is one', () => {
        const world = makeWorld();
        world.insert(E, Score, { points: 0, label: '' });
        const bb = new Blackboard();

        aiRegistry.getAction('property.set')!(ctxFor(world), bb, 'TestScore.label=ready');
        expect(world.get(E, Score)).toMatchObject({ label: 'ready' });

        aiRegistry.getAction('property.set')!(ctxFor(world), bb, 'TestScore.points=12');
        expect(world.get(E, Score)).toMatchObject({ points: 12 });
    });

    it('reaches a nested path (a colour channel)', () => {
        const Tint = defineComponent<{ color: { r: number; g: number; b: number; a: number } }>(
            'TestTint', { color: { r: 1, g: 1, b: 1, a: 1 } },
        );
        registerComponent('TestTint', Tint);
        const world = makeWorld();
        world.insert(E, Tint, { color: { r: 1, g: 1, b: 1, a: 1 } });

        aiRegistry.getAction('property.set')!(ctxFor(world), new Blackboard(), 'TestTint.color.a=0.25');

        expect(world.get(E, Tint)).toEqual({ color: { r: 1, g: 1, b: 1, a: 0.25 } });
    });

    it('is a no-op for a missing component, path or value — never a throw', () => {
        const world = makeWorld();
        const run = aiRegistry.getAction('property.set')!;
        expect(() => run(ctxFor(world), new Blackboard(), 'Nope.field=1')).not.toThrow();
        expect(() => run(ctxFor(world), new Blackboard(), '')).not.toThrow();
        expect(() => run(ctxFor(world), new Blackboard(), 'TestScore.points')).not.toThrow();
    });
});

describe('ui.setVisible', () => {
    it('drives UINode.display, the switch layout and rendering honour', () => {
        const world = makeWorld();
        world.insert(E, UINode, { display: UIDisplay.Flex });

        aiRegistry.getAction('ui.setVisible')!(ctxFor(world), new Blackboard(), 'false');
        expect((world.get(E, UINode) as { display: number }).display).toBe(UIDisplay.None);

        aiRegistry.getAction('ui.setVisible')!(ctxFor(world), new Blackboard(), 'true');
        expect((world.get(E, UINode) as { display: number }).display).toBe(UIDisplay.Flex);
    });

    it('does nothing on an entity without a UINode', () => {
        const world = makeWorld();
        expect(() => aiRegistry.getAction('ui.setVisible')!(ctxFor(world), new Blackboard(), 'false')).not.toThrow();
    });

    it('declares a bool parameter, so the inspector renders a checkbox', () => {
        expect(aiRegistry.getActionParams('ui.setVisible')).toEqual([{ name: 'visible', type: 'bool' }]);
    });
});
