// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { applyTimelineEvent, TimelineEventType } from '../src/timeline/TimelineRuntime';
// Importing the component modules is what puts them in the builtin registry, which is
// where `applyTimelineEvent` looks them up by name.
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { Sprite } from '../src/ecs/component';

const ENTITY = 7;

/** The slice of World the event dispatcher touches, with a write counter per component. */
function mockWorld(initial: Array<[object, Record<string, unknown>]>) {
    const store = new Map<object, Record<string, unknown>>(initial);
    const writes = new Map<object, number>();
    return {
        writes,
        store,
        has: (_e: number, def: object) => store.has(def),
        get: (_e: number, def: object) => ({ ...store.get(def)! }),
        set: (_e: number, def: object, data: Record<string, unknown>) => {
            store.set(def, data);
            writes.set(def, (writes.get(def) ?? 0) + 1);
        },
        insert: (_e: number, def: object, data: Record<string, unknown>) => {
            store.set(def, data);
            writes.set(def, (writes.get(def) ?? 0) + 1);
        },
    };
}

const activate = (world: ReturnType<typeof mockWorld>, active: boolean) =>
    applyTimelineEvent(world, null, TimelineEventType.ActivationSet, ENTITY, active ? 1 : 0, 0, '');

describe('applyTimelineEvent — ActivationSet', () => {
    it('drives a UI node through `display`, the only show/hide that takes the subtree', () => {
        const world = mockWorld([[UINode, { display: UIDisplay.Flex, opacity: 1 }]]);

        activate(world, false);
        expect(world.store.get(UINode)!.display).toBe(UIDisplay.None);

        activate(world, true);
        expect(world.store.get(UINode)!.display).toBe(UIDisplay.Flex);
        // The rest of the node is untouched — activation is not a component reset.
        expect(world.store.get(UINode)!.opacity).toBe(1);
    });

    it('writes only when the state flips: it fires every frame the track is evaluated', () => {
        const world = mockWorld([[UINode, { display: UIDisplay.Flex }]]);

        activate(world, true);
        activate(world, true);
        expect(world.writes.get(UINode) ?? 0).toBe(0);

        activate(world, false);
        activate(world, false);
        expect(world.writes.get(UINode)).toBe(1);
    });

    it('still drives a plain sprite through `enabled`, and both when an entity has both', () => {
        const world = mockWorld([
            [Sprite, { enabled: true }],
            [UINode, { display: UIDisplay.Flex }],
        ]);

        activate(world, false);
        expect(world.store.get(Sprite)!.enabled).toBe(false);
        expect(world.store.get(UINode)!.display).toBe(UIDisplay.None);
    });
});
