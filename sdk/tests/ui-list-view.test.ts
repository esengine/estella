import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    ListView,
    LinearLayoutProvider,
    arrayDataSource,
    type DataSource,
} from '../src/ui';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

// ---- Minimal World stub: enough surface for ListView + ViewPool ----

interface MockWorld {
    _entities: Set<number>;
    _components: Map<number, Map<object, unknown>>;
    _despawnListeners: Array<(e: Entity) => void>;
    _nextId: number;

    spawn(): Entity;
    despawn(entity: Entity): void;
    valid(entity: Entity): boolean;
    onDespawn(cb: (e: Entity) => void): () => void;

    has(entity: Entity, comp: object): boolean;
    get(entity: Entity, comp: object): unknown;
    insert(entity: Entity, comp: object, data: unknown): void;
}

function createWorld(): MockWorld {
    const w: MockWorld = {
        _entities: new Set<number>(),
        _components: new Map(),
        _despawnListeners: [],
        _nextId: 1,

        spawn() {
            const id = w._nextId++;
            w._entities.add(id);
            w._components.set(id, new Map());
            return id as Entity;
        },
        despawn(entity: Entity) {
            for (const cb of w._despawnListeners) cb(entity);
            w._entities.delete(entity as number);
            w._components.delete(entity as number);
        },
        valid(entity: Entity) {
            return w._entities.has(entity as number);
        },
        onDespawn(cb) {
            w._despawnListeners.push(cb);
            return () => {
                const idx = w._despawnListeners.indexOf(cb);
                if (idx !== -1) w._despawnListeners.splice(idx, 1);
            };
        },
        has(entity, comp) {
            return w._components.get(entity as number)?.has(comp) ?? false;
        },
        get(entity, comp) {
            return w._components.get(entity as number)?.get(comp);
        },
        insert(entity, comp, data) {
            const map = w._components.get(entity as number);
            if (map) map.set(comp, data);
        },
    };
    return w;
}

const factory = (world: World) => (world as unknown as MockWorld).spawn();

describe('ListView', () => {
    let world: MockWorld;
    let parent: Entity;

    beforeEach(() => {
        world = createWorld();
        parent = world.spawn();
    });

    it('mounts visible items + buffer on first update', () => {
        const data = arrayDataSource(Array.from({ length: 100 }, (_, i) => i));
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 160 },   // 4 visible items
            templates: { default: { factory, binder: () => {} } },
            recycleBuffer: 2,
        });

        list.update();

        // 4 visible + 2 buffer = 6 (no lead buffer at top since scroll=0)
        // visible range [0,4); bufferedEnd = min(100, 4+2)=6; bufferedStart=max(0,0-2)=0; → 6 items
        expect(list.getMountedCount()).toBe(6);
    });

    it('virtualization: 10000-item list mounts only items near viewport', () => {
        const data = arrayDataSource(Array.from({ length: 10000 }, (_, i) => i));
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 400 },   // 10 visible
            templates: { default: { factory, binder: () => {} } },
            recycleBuffer: 3,
        });

        list.update();
        // 10 visible + 3 trailing (no lead since scroll=0) = 13
        expect(list.getMountedCount()).toBe(13);

        list.setScrollOffset({ x: 0, y: 1000 });   // mid-list
        list.update();
        // 10 visible + 3 lead + 3 trail = 16
        expect(list.getMountedCount()).toBe(16);

        // Never near 10000
        expect(list.getMountedCount()).toBeLessThanOrEqual(20);
    });

    it('reuses released entities from the pool on scroll', () => {
        const data = arrayDataSource(Array.from({ length: 100 }, (_, i) => i));
        const spawnSpy = vi.fn(factory);
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 80 },    // 2 visible
            templates: { default: { factory: spawnSpy, binder: () => {} } },
            recycleBuffer: 0,
        });

        list.update();                  // mounts items 0,1 → 2 spawn calls
        expect(spawnSpy).toHaveBeenCalledTimes(2);

        // Scroll past them; released items should be reused for new mounts.
        list.setScrollOffset({ x: 0, y: 400 });   // items 10, 11 visible
        list.update();

        // Zero new spawn calls — pool reuse.
        expect(spawnSpy).toHaveBeenCalledTimes(2);
        expect(list.getMountedCount()).toBe(2);
    });

    it('binder is called with (entity, data, index) for each mounted item', () => {
        const data = arrayDataSource(['a', 'b', 'c', 'd']);
        const binder = vi.fn<(entity: Entity, item: string, index: number) => void>();
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 160 },
            templates: { default: { factory, binder } },
            recycleBuffer: 0,
        });

        list.update();

        expect(binder).toHaveBeenCalledTimes(4);
        const args = binder.mock.calls.map((c) => [c[1], c[2]]);
        expect(args).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    });

    it('datasource change marks the list dirty and re-mounts on next update', () => {
        const data = arrayDataSource([1, 2]);
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 200 },
            templates: { default: { factory, binder: () => {} } },
            recycleBuffer: 0,
        });

        list.update();
        expect(list.getMountedCount()).toBe(2);

        data.append([3, 4, 5]);
        list.update();

        expect(list.getMountedCount()).toBe(5);
    });

    it('update is a no-op when clean', () => {
        const data = arrayDataSource([1, 2]);
        const spawnSpy = vi.fn(factory);
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 200 },
            templates: { default: { factory: spawnSpy, binder: () => {} } },
            recycleBuffer: 0,
        });

        list.update();
        const countAfterFirst = spawnSpy.mock.calls.length;

        list.update();
        list.update();

        expect(spawnSpy.mock.calls.length).toBe(countAfterFirst);
    });

    it('dispose unsubscribes and releases all mounted items', () => {
        const data = arrayDataSource([1, 2, 3]);
        const list = new ListView({
            world: world as unknown as World,
            parent,
            dataSource: data,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 200 },
            templates: { default: { factory, binder: () => {} } },
        });

        list.update();
        expect(list.getMountedCount()).toBeGreaterThan(0);

        list.dispose();
        expect(list.getMountedCount()).toBe(0);

        // After dispose, further data-source events shouldn't reach the list.
        data.append([4, 5]);
        list.update();    // should be a no-op (disposed guard)
        expect(list.getMountedCount()).toBe(0);
    });

    it('heterogeneous item types route to matching templates', () => {
        interface Row {
            kind: 'header' | 'body';
            text: string;
        }
        const data = arrayDataSource<Row>([
            { kind: 'header', text: 'A' },
            { kind: 'body', text: 'a' },
            { kind: 'body', text: 'b' },
        ]);

        const headerFactory = vi.fn(factory);
        const bodyFactory = vi.fn(factory);

        const list = new ListView<Row>({
            world: world as unknown as World,
            parent,
            dataSource: {
                getCount: () => data.getCount(),
                getItem: (i) => data.getItem(i),
                getItemType: (i) => data.getItem(i).kind,
                subscribe: (l) => data.subscribe(l),
            } as DataSource<Row>,
            layout: new LinearLayoutProvider({ itemSize: { x: 100, y: 40 } }),
            viewportSize: { x: 100, y: 160 },
            templates: {
                header: { factory: headerFactory, binder: () => {} },
                body:   { factory: bodyFactory,   binder: () => {} },
            },
            recycleBuffer: 0,
        });

        list.update();

        expect(headerFactory).toHaveBeenCalledTimes(1);
        expect(bodyFactory).toHaveBeenCalledTimes(2);
    });
});
