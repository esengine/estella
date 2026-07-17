// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIScrollbarSystem — overlay thumbs appear on scroll, track the offset,
 *        and fade out after idle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createScrollbarSystem } from '../src/ui/behavior/scrollbar';
import { ScrollContainer, ScrollContainerRegistry } from '../src/ui/collection/scroll-container';
import { UINode } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

interface MockWorld {
    _entities: Set<number>;
    _components: Map<number, Map<object, unknown>>;
    spawn(): Entity;
    despawn(e: Entity): void;
    valid(e: Entity): boolean;
    setParent(c: Entity, p: Entity): void;
    has(e: Entity, c: object): boolean;
    get(e: Entity, c: object): unknown;
    insert(e: Entity, c: object, data: unknown): void;
    getEntitiesWithComponents(cs: object[]): Entity[];
    onDespawn(cb: (e: Entity) => void): () => void;
}

function createMockWorld(): MockWorld {
    let nextId = 1;
    const w: MockWorld = {
        _entities: new Set(),
        _components: new Map(),
        spawn() {
            const id = nextId++;
            w._entities.add(id);
            w._components.set(id, new Map());
            return id as Entity;
        },
        despawn(e) {
            w._entities.delete(e as number);
            w._components.delete(e as number);
        },
        valid(e) { return w._entities.has(e as number); },
        setParent() { /* not needed */ },
        has(e, c) { return w._components.get(e as number)?.has(c) ?? false; },
        get(e, c) { return w._components.get(e as number)?.get(c); },
        insert(e, c, d) { w._components.get(e as number)?.set(c, d); },
        getEntitiesWithComponents(cs) {
            return [...w._entities].filter((e) =>
                cs.every((c) => w._components.get(e)?.has(c))) as Entity[];
        },
        onDespawn() { return () => {}; },
    };
    return w;
}

describe('UIScrollbarSystem', () => {
    let world: MockWorld;
    let registry: ScrollContainerRegistry;
    let viewport: Entity;
    let scroll: ScrollContainer;
    let tick: (dt?: number) => void;

    const thumbs = (): Entity[] =>
        [...world._entities].filter((e) =>
            e !== (viewport as number)
            && world.has(e as Entity, UINode) && world.has(e as Entity, UIVisual)) as Entity[];

    beforeEach(() => {
        world = createMockWorld();
        registry = new ScrollContainerRegistry();
        viewport = world.spawn();
        scroll = new ScrollContainer({
            viewportSize: { x: 100, y: 100 },
            contentSize: { x: 100, y: 300 },
        });
        registry.attach(viewport as number, scroll);
        const sys = createScrollbarSystem(world as unknown as World, registry);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tick = (dt = 1 / 60) => (sys as any)._fn({ delta: dt });
    });

    it('spawns a vertical thumb once the offset moves, sized to the visible fraction', () => {
        tick();
        expect(thumbs()).toHaveLength(0); // still — nothing shown

        scroll.scrollBy({ x: 0, y: 100 });
        tick();
        const [thumb] = thumbs();
        expect(thumb).toBeDefined();
        const n = world.get(thumb!, UINode) as { height: { value: number }; insetTop: { value: number } };
        // viewport/content = 1/3 of the 100px track ≈ 33.3px…
        expect(n.height.value).toBeCloseTo(100 * 100 / 300, 1);
        // …placed at offset 100 of max 200 → half the remaining track.
        expect(n.insetTop.value).toBeCloseTo((100 / 200) * (100 - 100 * 100 / 300), 1);
        const vis = world.get(thumb!, UIVisual) as { color: { a: number } };
        expect(vis.color.a).toBeGreaterThan(0.3);
    });

    it('fades the thumb out after the idle delay', () => {
        tick(); // baseline frame before the scroll
        scroll.scrollBy({ x: 0, y: 50 });
        tick();
        const [thumb] = thumbs();
        expect(thumb).toBeDefined();

        for (let i = 0; i < 90; i++) tick(); // 1.5s of stillness > delay + fade
        const vis = world.get(thumb!, UIVisual) as { color: { a: number } };
        expect(vis.color.a).toBe(0);
    });

    it('drops the thumbs when the container detaches', () => {
        tick();
        scroll.scrollBy({ x: 0, y: 50 });
        tick();
        expect(thumbs()).toHaveLength(1);

        registry.detach(viewport as number);
        tick();
        expect(thumbs()).toHaveLength(0);
    });

    it('a horizontal-only container never grows a vertical thumb', () => {
        registry.detach(viewport as number);
        const h = new ScrollContainer({
            viewportSize: { x: 100, y: 100 },
            contentSize: { x: 300, y: 100 },
            direction: 'horizontal',
        });
        registry.attach(viewport as number, h);
        tick();
        h.scrollBy({ x: 60, y: 0 });
        tick();
        const all = thumbs();
        expect(all).toHaveLength(1);
        const n = world.get(all[0]!, UINode) as { width: { value: number } };
        expect(n.width.value).toBeCloseTo(100 * 100 / 300, 1); // horizontal thumb length
    });
});
