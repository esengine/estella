import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World, computeQueryCacheKey } from '../src/world';
import { defineComponent, defineTag, defineBuiltin } from '../src/component';
import { createMockModule } from './mocks/wasm';

describe('World', () => {
    let world: World;

    const Position = defineComponent('TestPosition', { x: 0, y: 0 });
    const Velocity = defineComponent('TestVelocity', { dx: 0, dy: 0 });
    const Health = defineComponent('TestHealth', { value: 100 });
    const Player = defineTag('TestPlayer');

    beforeEach(() => {
        const mod = createMockModule();
        world = new World();
        world.connectCpp(mod.getRegistry(), mod);
    });

    describe('entity lifecycle', () => {
        it('should spawn a new entity', () => {
            const entity = world.spawn();
            expect(entity).toBeGreaterThan(0);
        });

        it('should spawn multiple entities', () => {
            const e1 = world.spawn();
            const e2 = world.spawn();
            const e3 = world.spawn();

            expect(e1).not.toBe(e2);
            expect(e2).not.toBe(e3);
            expect(e1).not.toBe(e3);
        });

        it('should despawn an entity', () => {
            const entity = world.spawn();
            world.despawn(entity);

            expect(() => world.get(entity, Position)).toThrow();
        });
    });

    describe('component operations', () => {
        it('should insert component with data', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 10, y: 20 });

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(10);
            expect(pos.y).toBe(20);
        });

        it('should insert component with defaults', () => {
            const entity = world.spawn();
            world.insert(entity, Position);

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
        });

        it('should insert component with partial data', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 5 });

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(5);
            expect(pos.y).toBe(0);
        });

        it('should get component data', () => {
            const entity = world.spawn();
            world.insert(entity, Health, { value: 75 });

            const health = world.get(entity, Health);
            expect(health.value).toBe(75);
        });

        it('should throw when getting non-existent component', () => {
            const entity = world.spawn();

            expect(() => world.get(entity, Position)).toThrow();
        });

        it('should check if entity has component', () => {
            const entity = world.spawn();
            world.insert(entity, Position);

            expect(world.has(entity, Position)).toBe(true);
            expect(world.has(entity, Velocity)).toBe(false);
        });

        it('should remove component', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 1, y: 1 });
            world.insert(entity, Velocity, { dx: 1, dy: 1 });

            world.remove(entity, Position);

            expect(world.has(entity, Position)).toBe(false);
            expect(world.has(entity, Velocity)).toBe(true);
        });
    });

    describe('tag components', () => {
        it('should insert tag component', () => {
            const entity = world.spawn();
            world.insert(entity, Player);

            expect(world.has(entity, Player)).toBe(true);
        });

        it('should remove tag component', () => {
            const entity = world.spawn();
            world.insert(entity, Player);
            world.remove(entity, Player);

            expect(world.has(entity, Player)).toBe(false);
        });
    });

    describe('multiple components', () => {
        it('should add multiple components to one entity', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 1, y: 2 });
            world.insert(entity, Velocity, { dx: 3, dy: 4 });
            world.insert(entity, Health, { value: 100 });

            expect(world.has(entity, Position)).toBe(true);
            expect(world.has(entity, Velocity)).toBe(true);
            expect(world.has(entity, Health)).toBe(true);
        });

        it('should remove specific components while keeping others', () => {
            const entity = world.spawn();
            world.insert(entity, Position);
            world.insert(entity, Velocity);
            world.insert(entity, Health);

            world.remove(entity, Velocity);

            expect(world.has(entity, Position)).toBe(true);
            expect(world.has(entity, Velocity)).toBe(false);
            expect(world.has(entity, Health)).toBe(true);
        });
    });

    describe('getEntitiesWithComponents', () => {
        it('should find entities with single component', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const e2 = world.spawn();
            world.insert(e2, Velocity);

            const e3 = world.spawn();
            world.insert(e3, Position);

            const entities = world.getEntitiesWithComponents([Position]);

            expect(entities).toHaveLength(2);
            expect(entities).toContain(e1);
            expect(entities).toContain(e3);
        });

        it('should find entities with multiple components', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);
            world.insert(e1, Velocity);

            const e2 = world.spawn();
            world.insert(e2, Position);

            const e3 = world.spawn();
            world.insert(e3, Position);
            world.insert(e3, Velocity);

            const entities = world.getEntitiesWithComponents([Position, Velocity]);

            expect(entities).toHaveLength(2);
            expect(entities).toContain(e1);
            expect(entities).toContain(e3);
        });

        it('should return empty array when no entities match', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const entities = world.getEntitiesWithComponents([Velocity, Health]);

            expect(entities).toHaveLength(0);
        });
    });

    describe('component data mutations', () => {
        it('should allow mutating component data', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 0, y: 0 });

            const pos = world.get(entity, Position);
            pos.x = 100;
            pos.y = 200;

            const updated = world.get(entity, Position);
            expect(updated.x).toBe(100);
            expect(updated.y).toBe(200);
        });

        it('should reflect mutations immediately', () => {
            const entity = world.spawn();
            world.insert(entity, Health, { value: 100 });

            const hp1 = world.get(entity, Health);
            hp1.value -= 25;

            const hp2 = world.get(entity, Health);
            expect(hp2.value).toBe(75);
        });
    });

    describe('structural changes', () => {
        it('should invalidate queries on entity spawn', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const entities1 = world.getEntitiesWithComponents([Position]);
            expect(entities1).toHaveLength(1);

            const e2 = world.spawn();
            world.insert(e2, Position);

            const entities2 = world.getEntitiesWithComponents([Position]);
            expect(entities2).toHaveLength(2);
        });

        it('should invalidate queries on entity despawn', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const e2 = world.spawn();
            world.insert(e2, Position);

            const entities1 = world.getEntitiesWithComponents([Position]);
            expect(entities1).toHaveLength(2);

            world.despawn(e1);

            const entities2 = world.getEntitiesWithComponents([Position]);
            expect(entities2).toHaveLength(1);
        });

        it('should invalidate queries on component insert', () => {
            const e1 = world.spawn();

            const entities1 = world.getEntitiesWithComponents([Position]);
            expect(entities1).toHaveLength(0);

            world.insert(e1, Position);

            const entities2 = world.getEntitiesWithComponents([Position]);
            expect(entities2).toHaveLength(1);
        });

        it('should invalidate queries on component remove', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const entities1 = world.getEntitiesWithComponents([Position]);
            expect(entities1).toHaveLength(1);

            world.remove(e1, Position);

            const entities2 = world.getEntitiesWithComponents([Position]);
            expect(entities2).toHaveLength(0);
        });
    });

    describe('complex scenarios', () => {
        it('should handle many entities', () => {
            const entities: number[] = [];

            for (let i = 0; i < 1000; i++) {
                const entity = world.spawn();
                world.insert(entity, Position, { x: i, y: i * 2 });
                entities.push(entity);
            }

            const queried = world.getEntitiesWithComponents([Position]);
            expect(queried).toHaveLength(1000);
        });

        it('should handle complex component combinations', () => {
            const enemy1 = world.spawn();
            world.insert(enemy1, Position);
            world.insert(enemy1, Velocity);
            world.insert(enemy1, Health);

            const enemy2 = world.spawn();
            world.insert(enemy2, Position);
            world.insert(enemy2, Health);

            const player = world.spawn();
            world.insert(player, Position);
            world.insert(player, Velocity);
            world.insert(player, Health);
            world.insert(player, Player);

            const movingEntities = world.getEntitiesWithComponents([Position, Velocity]);
            expect(movingEntities).toHaveLength(2);

            const players = world.getEntitiesWithComponents([Player]);
            expect(players).toHaveLength(1);

            const allLiving = world.getEntitiesWithComponents([Health]);
            expect(allLiving).toHaveLength(3);
        });
    });

    // =========================================================================
    // Pure JS mode (no C++ registry)
    // =========================================================================

    describe('pure JS mode (no cpp)', () => {
        let jsWorld: World;

        beforeEach(() => {
            jsWorld = new World();
        });

        it('should spawn entities with incrementing ids', () => {
            const e1 = jsWorld.spawn();
            const e2 = jsWorld.spawn();
            expect(e1).not.toBe(e2);
            expect(e1).toBeGreaterThan(0);
        });

        it('should validate entities', () => {
            const e = jsWorld.spawn();
            expect(jsWorld.valid(e)).toBe(true);
            jsWorld.despawn(e);
            expect(jsWorld.valid(e)).toBe(false);
        });

        it('should report entity count', () => {
            expect(jsWorld.entityCount()).toBe(0);
            const e1 = jsWorld.spawn();
            jsWorld.spawn();
            expect(jsWorld.entityCount()).toBe(2);
            jsWorld.despawn(e1);
            expect(jsWorld.entityCount()).toBe(1);
        });

        it('should list all entities', () => {
            const e1 = jsWorld.spawn();
            const e2 = jsWorld.spawn();
            expect(jsWorld.getAllEntities()).toContain(e1);
            expect(jsWorld.getAllEntities()).toContain(e2);
        });

        it('hasCpp should return false', () => {
            expect(jsWorld.hasCpp).toBe(false);
        });

        it('getCppRegistry should return null', () => {
            expect(jsWorld.getCppRegistry()).toBeNull();
        });
    });

    // =========================================================================
    // connectCpp / disconnectCpp
    // =========================================================================

    describe('connectCpp / disconnectCpp', () => {
        it('should connect and disconnect', () => {
            const w = new World();
            expect(w.hasCpp).toBe(false);

            const mod = createMockModule();
            w.connectCpp(mod.getRegistry(), mod);
            expect(w.hasCpp).toBe(true);
            expect(w.getCppRegistry()).not.toBeNull();

            w.disconnectCpp();
            expect(w.hasCpp).toBe(false);
            expect(w.getCppRegistry()).toBeNull();
        });
    });

    // =========================================================================
    // tryGet
    // =========================================================================

    describe('tryGet', () => {
        it('should return component data if present', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 42, y: 99 });
            const result = world.tryGet(entity, Position);
            expect(result).not.toBeNull();
            expect(result!.x).toBe(42);
        });

        it('should return null if component not present', () => {
            const entity = world.spawn();
            expect(world.tryGet(entity, Position)).toBeNull();
        });
    });

    // =========================================================================
    // set
    // =========================================================================

    describe('set', () => {
        it('should overwrite script component data', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 1, y: 2 });
            world.set(entity, Position, { x: 100, y: 200 });
            expect(world.get(entity, Position)).toEqual({ x: 100, y: 200 });
        });
    });

    // =========================================================================
    // Spawn / Despawn callbacks
    // =========================================================================

    describe('onSpawn / onDespawn callbacks', () => {
        it('should call spawn callbacks', () => {
            const w = new World();
            const spawned: number[] = [];
            w.onSpawn((e) => spawned.push(e));
            const e1 = w.spawn();
            const e2 = w.spawn();
            expect(spawned).toEqual([e1, e2]);
        });

        it('should call despawn callbacks', () => {
            const w = new World();
            const despawned: number[] = [];
            w.onDespawn((e) => despawned.push(e));
            const e1 = w.spawn();
            w.despawn(e1);
            expect(despawned).toEqual([e1]);
        });

        it('should support unsubscribing spawn callback', () => {
            const w = new World();
            const spawned: number[] = [];
            const unsub = w.onSpawn((e) => spawned.push(e));
            w.spawn();
            unsub();
            w.spawn();
            expect(spawned).toHaveLength(1);
        });

        it('should support unsubscribing despawn callback', () => {
            const w = new World();
            const despawned: number[] = [];
            const unsub = w.onDespawn((e) => despawned.push(e));
            const e1 = w.spawn();
            w.despawn(e1);
            unsub();
            const e2 = w.spawn();
            w.despawn(e2);
            expect(despawned).toHaveLength(1);
        });

        it('should not throw if callback throws', () => {
            const w = new World();
            w.onSpawn(() => { throw new Error('boom'); });
            expect(() => w.spawn()).not.toThrow();
        });
    });

    // =========================================================================
    // Iteration guards
    // =========================================================================

    describe('iteration guards', () => {
        it('should throw on spawn during iteration', () => {
            world.beginIteration();
            expect(() => world.spawn()).toThrow('Cannot spawn entity during query iteration');
            world.endIteration();
        });

        it('should throw on despawn during iteration', () => {
            const e = world.spawn();
            world.beginIteration();
            expect(() => world.despawn(e)).toThrow('Cannot despawn entity during query iteration');
            world.endIteration();
        });

        it('should throw on remove during iteration', () => {
            const e = world.spawn();
            world.insert(e, Position, { x: 0, y: 0 });
            world.beginIteration();
            expect(() => world.remove(e, Position)).toThrow('Cannot remove component during query iteration');
            world.endIteration();
        });

        it('should reset iteration depth', () => {
            world.beginIteration();
            world.beginIteration();
            world.resetIterationDepth();
            expect(world.isIterating()).toBe(false);
        });

        it('should warn on mismatched endIteration', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            world.endIteration();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mismatched'));
            warnSpy.mockRestore();
        });
    });

    // =========================================================================
    // Change detection
    // =========================================================================

    describe('change detection', () => {
        it('should advance tick', () => {
            const w = new World();
            expect(w.getWorldTick()).toBe(0);
            w.advanceTick();
            expect(w.getWorldTick()).toBe(1);
        });

        it('isAddedSince should detect newly added components', () => {
            const w = new World();
            const e = w.spawn();
            w.advanceTick();
            w.insert(e, Position, { x: 1, y: 1 });
            expect(w.isAddedSince(e, Position, 0)).toBe(true);
            expect(w.isAddedSince(e, Position, 1)).toBe(false);
        });

        it('isAddedSince should return false for unknown component', () => {
            const w = new World();
            const e = w.spawn();
            expect(w.isAddedSince(e, Position, -1)).toBe(false);
        });

        it('isChangedSince should detect changed components', () => {
            const w = new World();
            const e = w.spawn();
            w.insert(e, Position, { x: 0, y: 0 });
            w.advanceTick();
            w.set(e, Position, { x: 5, y: 5 });
            expect(w.isChangedSince(e, Position, 0)).toBe(true);
        });

        it('isChangedSince should return false for unknown component', () => {
            const w = new World();
            const e = w.spawn();
            expect(w.isChangedSince(e, Position, -1)).toBe(false);
        });

        it('getRemovedEntitiesSince should detect removed components', () => {
            const w = new World();
            const e = w.spawn();
            w.insert(e, Position, { x: 0, y: 0 });
            w.advanceTick();
            w.remove(e, Position);
            const removed = w.getRemovedEntitiesSince(Position, 0);
            expect(removed).toContain(e);
        });

        it('getRemovedEntitiesSince should return empty for unknown component', () => {
            const w = new World();
            expect(w.getRemovedEntitiesSince(Velocity, -1)).toEqual([]);
        });

        it('cleanRemovedBuffer should remove old entries', () => {
            const w = new World();
            const e1 = w.spawn();
            w.insert(e1, Position, { x: 0, y: 0 });
            w.remove(e1, Position);

            w.advanceTick();
            w.advanceTick();

            const e2 = w.spawn();
            w.insert(e2, Position, { x: 0, y: 0 });
            w.remove(e2, Position);

            w.cleanRemovedBuffer(1);
            const removed = w.getRemovedEntitiesSince(Position, -1);
            expect(removed).toContain(e2);
            expect(removed).not.toContain(e1);
        });

        it('cleanRemovedBuffer should delete empty buffers', () => {
            const w = new World();
            const e = w.spawn();
            w.insert(e, Position, { x: 0, y: 0 });
            w.remove(e, Position);

            w.cleanRemovedBuffer(Infinity);
            expect(w.getRemovedEntitiesSince(Position, -1)).toEqual([]);
        });

        it('despawn should record removed ticks for all components', () => {
            const w = new World();
            const e = w.spawn();
            w.insert(e, Position, { x: 0, y: 0 });
            w.insert(e, Velocity, { dx: 1, dy: 1 });
            w.advanceTick();
            w.despawn(e);
            expect(w.getRemovedEntitiesSince(Position, 0)).toContain(e);
            expect(w.getRemovedEntitiesSince(Velocity, 0)).toContain(e);
        });
    });

    // =========================================================================
    // setParent / removeParent
    // =========================================================================

    describe('setParent / removeParent', () => {
        it('should call setParent on cpp registry', () => {
            const e1 = world.spawn();
            const e2 = world.spawn();
            expect(() => world.setParent(e1, e2)).not.toThrow();
        });

        it('should call removeParent on cpp registry', () => {
            const e1 = world.spawn();
            expect(() => world.removeParent(e1)).not.toThrow();
        });

        it('should be no-op without cpp registry', () => {
            const w = new World();
            const e1 = w.spawn();
            const e2 = w.spawn();
            expect(() => w.setParent(e1, e2)).not.toThrow();
            expect(() => w.removeParent(e1)).not.toThrow();
        });
    });

    // =========================================================================
    // getEntitiesWithComponents with filters
    // =========================================================================

    describe('getEntitiesWithComponents with filters', () => {
        it('should return all entities when no components specified', () => {
            const e1 = world.spawn();
            const e2 = world.spawn();
            const result = world.getEntitiesWithComponents([]);
            expect(result).toContain(e1);
            expect(result).toContain(e2);
        });

        it('should apply withFilters', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 0, y: 0 });
            world.insert(e1, Health, { value: 100 });

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 0, y: 0 });

            const result = world.getEntitiesWithComponents([Position], [Health]);
            expect(result).toHaveLength(1);
            expect(result).toContain(e1);
        });

        it('should apply withoutFilters', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 0, y: 0 });
            world.insert(e1, Health, { value: 100 });

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 0, y: 0 });

            const result = world.getEntitiesWithComponents([Position], [], [Health]);
            expect(result).toHaveLength(1);
            expect(result).toContain(e2);
        });
    });

    // =========================================================================
    // computeQueryCacheKey
    // =========================================================================

    describe('computeQueryCacheKey', () => {
        it('should produce a stable key', () => {
            const key1 = computeQueryCacheKey([Position, Velocity]);
            const key2 = computeQueryCacheKey([Position, Velocity]);
            expect(key1).toBe(key2);
        });

        it('should include with filter in key', () => {
            const keyBase = computeQueryCacheKey([Position]);
            const keyWith = computeQueryCacheKey([Position], [Velocity]);
            expect(keyWith).not.toBe(keyBase);
            expect(keyWith).toContain('|+');
        });

        it('should include without filter in key', () => {
            const keyBase = computeQueryCacheKey([Position]);
            const keyWithout = computeQueryCacheKey([Position], [], [Velocity]);
            expect(keyWithout).not.toBe(keyBase);
            expect(keyWithout).toContain('|-');
        });
    });

    // =========================================================================
    // resetQueryPool
    // =========================================================================

    describe('resetQueryPool', () => {
        it('should reset the pool index', () => {
            world.getEntitiesWithComponents([Position]);
            world.resetQueryPool();
            world.getEntitiesWithComponents([Position]);
        });
    });

    // =========================================================================
    // getComponentTypes
    // =========================================================================

    describe('getComponentTypes', () => {
        it('should return an array (may be empty for script-only without registry)', () => {
            const entity = world.spawn();
            world.insert(entity, Position, { x: 0, y: 0 });
            const types = world.getComponentTypes(entity);
            expect(Array.isArray(types)).toBe(true);
        });

        it('should return empty array for entity with no components', () => {
            const entity = world.spawn();
            const types = world.getComponentTypes(entity);
            expect(types).toEqual([]);
        });
    });

    // =========================================================================
    // Builtin component operations via mock
    // =========================================================================

    describe('builtin components', () => {
        const Transform = defineBuiltin('WTestTransform', {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
        });

        it('should insert and get builtin component', () => {
            const entity = world.spawn();
            world.insert(entity, Transform, { x: 10, y: 20 });
            const data = world.get(entity, Transform);
            expect(data.x).toBe(10);
            expect(data.y).toBe(20);
        });

        it('should check has for builtin component', () => {
            const entity = world.spawn();
            expect(world.has(entity, Transform)).toBe(false);
            world.insert(entity, Transform, { x: 0, y: 0 });
            expect(world.has(entity, Transform)).toBe(true);
        });

        it('should remove builtin component', () => {
            const entity = world.spawn();
            world.insert(entity, Transform, { x: 0, y: 0 });
            world.remove(entity, Transform);
            expect(world.has(entity, Transform)).toBe(false);
        });

        it('should set builtin component data', () => {
            const entity = world.spawn();
            world.insert(entity, Transform, { x: 0, y: 0 });
            world.set(entity, Transform, { x: 50, y: 60, rotation: 0, scaleX: 1, scaleY: 1 });
            const data = world.get(entity, Transform);
            expect(data.x).toBe(50);
            expect(data.y).toBe(60);
        });

        it('tryGet should return builtin data if present', () => {
            const entity = world.spawn();
            world.insert(entity, Transform, { x: 7, y: 8 });
            const data = world.tryGet(entity, Transform);
            expect(data).not.toBeNull();
            expect(data!.x).toBe(7);
        });

        it('tryGet should return null if builtin not present', () => {
            const entity = world.spawn();
            expect(world.tryGet(entity, Transform)).toBeNull();
        });

        it('tryGet should return null without cpp registry', () => {
            const w = new World();
            const e = w.spawn();
            expect(w.tryGet(e, Transform)).toBeNull();
        });

        it('hasBuiltin should return false without cpp registry', () => {
            const w = new World();
            const e = w.spawn();
            expect(w.has(e, Transform)).toBe(false);
        });

        it('removeBuiltin should be no-op without cpp registry', () => {
            const w = new World();
            const e = w.spawn();
            expect(() => w.remove(e, Transform)).not.toThrow();
        });
    });

    // =========================================================================
    // getWorldVersion
    // =========================================================================

    describe('getWorldVersion', () => {
        it('should increment on structural changes', () => {
            const v0 = world.getWorldVersion();
            const e = world.spawn();
            expect(world.getWorldVersion()).toBeGreaterThan(v0);
            const v1 = world.getWorldVersion();
            world.insert(e, Position, { x: 0, y: 0 });
            expect(world.getWorldVersion()).toBeGreaterThan(v1);
        });
    });

    // =========================================================================
    // Color conversion via builtin components (convertFromWasm/convertForWasm)
    // =========================================================================

    describe('color conversion (rgba <-> xyzw)', () => {
        const ColorComp = defineBuiltin('WTestColor', {
            tint: { r: 1, g: 1, b: 1, a: 1 },
        });

        it('should convert rgba to xyzw when setting builtin', () => {
            const entity = world.spawn();
            world.insert(entity, ColorComp, { tint: { r: 1, g: 0, b: 0, a: 0.5 } });
            const data = world.get(entity, ColorComp);
            expect(data.tint.r).toBe(1);
            expect(data.tint.a).toBe(0.5);
        });

        it('should round-trip color data through set/get', () => {
            const entity = world.spawn();
            world.insert(entity, ColorComp, { tint: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 } });
            world.set(entity, ColorComp, { tint: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 } });
            const data = world.get(entity, ColorComp);
            expect(data.tint.r).toBeCloseTo(0.2);
            expect(data.tint.g).toBeCloseTo(0.4);
            expect(data.tint.b).toBeCloseTo(0.6);
            expect(data.tint.a).toBeCloseTo(0.8);
        });
    });

    // =========================================================================
    // Validation errors
    // =========================================================================

    describe('component validation', () => {
        it('should throw on invalid builtin data type', () => {
            const Sprite = defineBuiltin('WTestSprite', { width: 100, height: 100 });
            const entity = world.spawn();
            expect(() => world.insert(entity, Sprite, { width: 'abc' as any })).toThrow();
        });

        it('should throw on invalid script data type', () => {
            const entity = world.spawn();
            expect(() => world.insert(entity, Position, { x: 'abc' as any })).toThrow();
        });
    });
});
