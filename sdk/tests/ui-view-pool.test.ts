/**
 * Unit tests for sdk/src/ui2/collection/view-pool.ts.
 * Uses a minimal mock World — enough to exercise onDespawn + valid.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViewPool } from '../src/ui/collection/view-pool';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

// ---- Mock World (minimal surface ViewPool actually uses) ----

interface MockWorld {
    spawn(): Entity;
    despawn(entity: Entity): void;
    valid(entity: Entity): boolean;
    onDespawn(cb: (entity: Entity) => void): () => void;
    _entities: Set<number>;
    _nextId: number;
    _despawnCallbacks: Array<(e: Entity) => void>;
}

function createMockWorld(): MockWorld {
    const w: MockWorld = {
        _entities: new Set<number>(),
        _nextId: 1,
        _despawnCallbacks: [],
        spawn() {
            const id = w._nextId++;
            w._entities.add(id);
            return id as Entity;
        },
        despawn(entity: Entity) {
            for (const cb of w._despawnCallbacks) cb(entity);
            w._entities.delete(entity as number);
        },
        valid(entity: Entity) {
            return w._entities.has(entity as number);
        },
        onDespawn(cb) {
            w._despawnCallbacks.push(cb);
            return () => {
                const idx = w._despawnCallbacks.indexOf(cb);
                if (idx !== -1) w._despawnCallbacks.splice(idx, 1);
            };
        },
    };
    return w;
}

describe('ViewPool', () => {
    let world: MockWorld;
    let pool: ViewPool;
    let setVisible: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        world = createMockWorld();
        setVisible = vi.fn();
        pool = new ViewPool({
            world: world as unknown as World,
            setVisible: (w, e, v) => setVisible(w, e, v),
        });

        pool.setTemplate<{ name: string }>('default', {
            factory: (w) => (w as unknown as MockWorld).spawn(),
            binder: () => { /* noop for test */ },
        });
    });

    describe('acquire / release', () => {
        it('acquire creates a fresh entity when pool is empty', () => {
            const parent = world.spawn();
            const e = pool.acquire('default', parent);
            expect(world.valid(e)).toBe(true);
            expect(pool.freeCount('default')).toBe(0);
        });

        it('acquire does not call setVisible for fresh entities', () => {
            const parent = world.spawn();
            pool.acquire('default', parent);
            expect(setVisible).not.toHaveBeenCalled();
        });

        it('release marks entity invisible and increments free count', () => {
            const parent = world.spawn();
            const e = pool.acquire('default', parent);
            pool.release('default', e);

            expect(setVisible).toHaveBeenCalledWith(
                expect.anything(), e, false,
            );
            expect(pool.freeCount('default')).toBe(1);
        });

        it('acquire reuses a released entity (LIFO) and marks visible', () => {
            const parent = world.spawn();
            const first = pool.acquire('default', parent);
            pool.release('default', first);

            const second = pool.acquire('default', parent);
            expect(second).toBe(first);
            expect(setVisible).toHaveBeenLastCalledWith(
                expect.anything(), first, true,
            );
            expect(pool.freeCount('default')).toBe(0);
        });

        it('throws if acquire is called without a template', () => {
            const parent = world.spawn();
            expect(() => pool.acquire('missing', parent)).toThrow(/No template/);
        });
    });

    describe('bind', () => {
        it('invokes the registered binder', () => {
            const binder = vi.fn();
            pool.setTemplate('typed', {
                factory: () => world.spawn(),
                binder,
            });
            const parent = world.spawn();
            const e = pool.acquire('typed', parent);
            pool.bind('typed', e, { name: 'hi' }, 7);

            expect(binder).toHaveBeenCalledWith(e, { name: 'hi' }, 7);
        });
    });

    describe('warmup', () => {
        it('pre-creates N entities and parks them hidden', () => {
            const parent = world.spawn();
            pool.warmup('default', 5, parent);

            expect(pool.freeCount('default')).toBe(5);
            expect(setVisible).toHaveBeenCalledTimes(5);
            // All calls with visible=false
            for (const call of setVisible.mock.calls) {
                expect(call[2]).toBe(false);
            }
        });

        it('acquire after warmup draws from pool (no new factory call)', () => {
            const parent = world.spawn();
            const factorySpy = vi.fn((w: World, p: Entity) => {
                void p;
                return (w as unknown as MockWorld).spawn();
            });
            pool.setTemplate('spy', { factory: factorySpy, binder: () => {} });

            pool.warmup('spy', 3, parent);
            expect(factorySpy).toHaveBeenCalledTimes(3);

            pool.acquire('spy', parent);
            pool.acquire('spy', parent);
            expect(factorySpy).toHaveBeenCalledTimes(3);   // still 3, not 5
        });
    });

    describe('auto-eviction on external despawn', () => {
        it('removes despawned entities from the free list', () => {
            const parent = world.spawn();
            const e1 = pool.acquire('default', parent);
            const e2 = pool.acquire('default', parent);
            pool.release('default', e1);
            pool.release('default', e2);
            expect(pool.freeCount('default')).toBe(2);

            world.despawn(e1);   // cascading despawn style
            expect(pool.freeCount('default')).toBe(1);

            // Next acquire should return e2 (the remaining valid one)
            const next = pool.acquire('default', parent);
            expect(next).toBe(e2);
        });

        it('ignores release of already-despawned entity', () => {
            const parent = world.spawn();
            const e = pool.acquire('default', parent);
            world.despawn(e);
            pool.release('default', e);

            expect(pool.freeCount('default')).toBe(0);
            expect(setVisible).not.toHaveBeenCalled();
        });
    });

    describe('dispose', () => {
        it('throws on further operations after dispose', () => {
            const parent = world.spawn();
            pool.dispose();
            expect(() => pool.acquire('default', parent)).toThrow(/disposed/);
        });

        it('dispose is idempotent', () => {
            pool.dispose();
            expect(() => pool.dispose()).not.toThrow();
        });

        it('dispose unsubscribes from onDespawn', () => {
            pool.dispose();
            // Creating a new pool should work fine afterwards
            const pool2 = new ViewPool({ world: world as unknown as World });
            pool2.setTemplate('a', {
                factory: () => world.spawn(),
                binder: () => {},
            });
            const parent = world.spawn();
            expect(() => pool2.acquire('a', parent)).not.toThrow();
        });
    });
});
