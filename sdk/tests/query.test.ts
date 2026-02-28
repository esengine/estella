import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import {
    Query, QueryInstance, Mut,
    Added, Changed, Removed,
    isMutWrapper, isAddedWrapper, isChangedWrapper,
    RemovedQueryInstance,
} from '../src/query';
import { defineComponent } from '../src/component';


describe('Query System', () => {
    let world: World;

    const Position = defineComponent('QPosition', { x: 0, y: 0 });
    const Velocity = defineComponent('QVelocity', { dx: 0, dy: 0 });
    const Health = defineComponent('QHealth', { value: 100 });
    const Enemy = defineComponent('QEnemy', {});

    beforeEach(() => {
        world = new World();
    });

    describe('Query creation', () => {
        it('should create query with single component', () => {
            const query = Query(Position);
            expect(query).toBeDefined();
        });

        it('should create query with multiple components', () => {
            const query = Query(Position, Velocity);
            expect(query).toBeDefined();
        });

        it('should create query with Mut wrapper', () => {
            const query = Query(Mut(Position), Velocity);
            expect(query).toBeDefined();
        });
    });

    describe('Query iteration', () => {
        it('should iterate over entities with components', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 2 });
            world.insert(e1, Velocity, { dx: 3, dy: 4 });

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 5, y: 6 });
            world.insert(e2, Velocity, { dx: 7, dy: 8 });

            const query = Query(Position, Velocity);
            const results: Array<{ entity: number; pos: any; vel: any }> = [];

            const instance = new QueryInstance(world, query);
            instance.forEach((entity, pos, vel) => {
                results.push({ entity, pos, vel });
            });

            expect(results).toHaveLength(2);
            expect(results[0].pos).toEqual({ x: 1, y: 2 });
            expect(results[1].pos).toEqual({ x: 5, y: 6 });
        });

        it('should only return entities with all required components', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });
            world.insert(e2, Velocity, { dx: 1, dy: 1 });

            const query = Query(Position, Velocity);
            const results: number[] = [];

            const instance = new QueryInstance(world, query);
            instance.forEach((entity) => {
                results.push(entity);
            });

            expect(results).toHaveLength(1);
            expect(results[0]).toBe(e2);
        });

        it('should handle empty query results', () => {
            const query = Query(Position);
            let count = 0;

            const instance = new QueryInstance(world, query);
            instance.forEach(() => {
                count++;
            });

            expect(count).toBe(0);
        });
    });

    describe('Query caching', () => {
        it('should cache query results', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Position);

            let count1 = 0;
            new QueryInstance(world, query).forEach(() => { count1++; });

            let count2 = 0;
            new QueryInstance(world, query).forEach(() => { count2++; });

            expect(count1).toBe(1);
            expect(count2).toBe(1);
        });

        it('should invalidate cache on structural changes', () => {
            const query = Query(Position);

            let count1 = 0;
            new QueryInstance(world, query).forEach(() => { count1++; });

            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            let count2 = 0;
            new QueryInstance(world, query).forEach(() => { count2++; });

            expect(count1).toBe(0);
            expect(count2).toBe(1);
        });

        it('should not invalidate cache on component data changes', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Position);

            new QueryInstance(world, query).forEach(() => {});

            const pos = world.get(e1, Position);
            pos.x = 999;

            let count = 0;
            new QueryInstance(world, query).forEach(() => { count++; });

            expect(count).toBe(1);
        });
    });

    describe('Mut wrapper', () => {
        it('should provide mutable access', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Mut(Position));

            new QueryInstance(world, query).forEach((entity, pos) => {
                pos.x = 100;
                pos.y = 200;
            });

            const updated = world.get(e1, Position);
            expect(updated.x).toBe(100);
            expect(updated.y).toBe(200);
        });

        it('should mix mutable and immutable components', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Velocity, { dx: 2, dy: 2 });

            const query = Query(Mut(Position), Velocity);

            new QueryInstance(world, query).forEach((entity, pos, vel) => {
                pos.x += vel.dx;
                pos.y += vel.dy;
            });

            const updated = world.get(e1, Position);
            expect(updated.x).toBe(3);
            expect(updated.y).toBe(3);
        });
    });

    describe('complex queries', () => {
        it('should handle three-component queries', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Velocity, { dx: 1, dy: 1 });
            world.insert(e1, Health, { value: 50 });

            const query = Query(Position, Velocity, Health);
            let count = 0;

            new QueryInstance(world, query).forEach((entity, pos, vel, hp) => {
                expect(pos.x).toBe(1);
                expect(vel.dx).toBe(1);
                expect(hp.value).toBe(50);
                count++;
            });

            expect(count).toBe(1);
        });

        it('should filter correctly with multiple components', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Enemy, {});

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });
            world.insert(e2, Health, { value: 100 });

            const e3 = world.spawn();
            world.insert(e3, Position, { x: 3, y: 3 });
            world.insert(e3, Enemy, {});

            const query = Query(Position, Enemy);
            const results: number[] = [];

            new QueryInstance(world, query).forEach((entity) => {
                results.push(entity);
            });

            expect(results).toHaveLength(2);
            expect(results).toContain(e1);
            expect(results).toContain(e3);
        });
    });

    describe('entity lifecycle during iteration', () => {
        it('should handle entity creation during iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Position);
            let iterations = 0;

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    iterations++;
                    if (iterations === 1) {
                        world.spawn();
                    }
                });
            }).toThrow(/Cannot spawn entity during query iteration/);
        });

        it('should handle component removal during iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Velocity, { dx: 1, dy: 1 });

            const query = Query(Position);

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    world.remove(entity, Velocity);
                });
            }).toThrow(/Cannot remove component during query iteration/);
        });
    });

    // =========================================================================
    // with / without filters
    // =========================================================================

    describe('with / without filters', () => {
        it('should filter entities that also have a with component', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Enemy, {});

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });

            const query = Query(Position).with(Enemy);
            const results: number[] = [];
            new QueryInstance(world, query).forEach((entity) => {
                results.push(entity);
            });
            expect(results).toEqual([e1]);
        });

        it('should exclude entities with a without component', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Enemy, {});

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });

            const query = Query(Position).without(Enemy);
            const results: number[] = [];
            new QueryInstance(world, query).forEach((entity) => {
                results.push(entity);
            });
            expect(results).toEqual([e2]);
        });

        it('should chain with and without', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.insert(e1, Velocity, { dx: 1, dy: 1 });
            world.insert(e1, Enemy, {});

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });
            world.insert(e2, Velocity, { dx: 2, dy: 2 });

            const e3 = world.spawn();
            world.insert(e3, Position, { x: 3, y: 3 });
            world.insert(e3, Enemy, {});

            const query = Query(Position).with(Velocity).without(Enemy);
            const results: number[] = [];
            new QueryInstance(world, query).forEach((entity) => {
                results.push(entity);
            });
            expect(results).toEqual([e2]);
        });
    });

    // =========================================================================
    // Added / Changed wrappers and type guards
    // =========================================================================

    describe('Added / Changed wrappers', () => {
        it('Added should create an added filter wrapper', () => {
            const wrapper = Added(Position);
            expect(wrapper._filterType).toBe('added');
            expect(wrapper._component).toBe(Position);
        });

        it('Changed should create a changed filter wrapper', () => {
            const wrapper = Changed(Position);
            expect(wrapper._filterType).toBe('changed');
            expect(wrapper._component).toBe(Position);
        });

        it('isAddedWrapper should detect Added wrappers', () => {
            expect(isAddedWrapper(Added(Position))).toBe(true);
            expect(isAddedWrapper(Changed(Position))).toBe(false);
            expect(isAddedWrapper(Mut(Position))).toBe(false);
            expect(isAddedWrapper(null)).toBe(false);
        });

        it('isChangedWrapper should detect Changed wrappers', () => {
            expect(isChangedWrapper(Changed(Position))).toBe(true);
            expect(isChangedWrapper(Added(Position))).toBe(false);
            expect(isChangedWrapper(Mut(Position))).toBe(false);
            expect(isChangedWrapper(null)).toBe(false);
        });

        it('isMutWrapper should detect Mut wrappers', () => {
            expect(isMutWrapper(Mut(Position))).toBe(true);
            expect(isMutWrapper(Added(Position))).toBe(false);
            expect(isMutWrapper(Position)).toBe(false);
            expect(isMutWrapper(null)).toBe(false);
        });
    });

    describe('Added query filtering', () => {
        it('should only return entities added since last run tick', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Added(Position));
            const instance = new QueryInstance(world, query, -1);
            const results: number[] = [];
            instance.forEach((entity) => {
                results.push(entity);
            });
            expect(results).toContain(e1);
        });
    });

    describe('Changed query filtering', () => {
        it('should only return entities changed since last run tick', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Changed(Position));
            const instance = new QueryInstance(world, query, -1);
            const results: number[] = [];
            instance.forEach((entity) => {
                results.push(entity);
            });
            expect(results).toContain(e1);
        });

        it('should skip entities not changed since a future tick', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Changed(Position));
            const instance = new QueryInstance(world, query, Infinity);
            const results: number[] = [];
            instance.forEach((entity) => {
                results.push(entity);
            });
            expect(results).toHaveLength(0);
        });
    });

    // =========================================================================
    // single / isEmpty / count / toArray
    // =========================================================================

    describe('single()', () => {
        it('should return first result', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 10, y: 20 });

            const query = Query(Position);
            const instance = new QueryInstance(world, query);
            const result = instance.single();
            expect(result).not.toBeNull();
            expect(result![0]).toBe(e1);
        });

        it('should return null when no results', () => {
            const query = Query(Position);
            const instance = new QueryInstance(world, query);
            expect(instance.single()).toBeNull();
        });
    });

    describe('isEmpty()', () => {
        it('should return true when no matching entities', () => {
            const query = Query(Position);
            const instance = new QueryInstance(world, query);
            expect(instance.isEmpty()).toBe(true);
        });

        it('should return false when matching entities exist', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 0, y: 0 });

            const query = Query(Position);
            const instance = new QueryInstance(world, query);
            expect(instance.isEmpty()).toBe(false);
        });
    });

    describe('count()', () => {
        it('should return 0 for empty query', () => {
            const query = Query(Position);
            expect(new QueryInstance(world, query).count()).toBe(0);
        });

        it('should return correct count', () => {
            for (let i = 0; i < 3; i++) {
                const e = world.spawn();
                world.insert(e, Position, { x: i, y: i });
            }

            const query = Query(Position);
            expect(new QueryInstance(world, query).count()).toBe(3);
        });
    });

    describe('toArray()', () => {
        it('should return empty array for no results', () => {
            const query = Query(Position);
            expect(new QueryInstance(world, query).toArray()).toEqual([]);
        });

        it('should return all results as array', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            const e2 = world.spawn();
            world.insert(e2, Position, { x: 2, y: 2 });

            const query = Query(Position);
            const arr = new QueryInstance(world, query).toArray();
            expect(arr).toHaveLength(2);
            expect(arr[0][0]).toBe(e1);
            expect(arr[1][0]).toBe(e2);
        });
    });

    // =========================================================================
    // Mut write-back with multiple entities
    // =========================================================================

    describe('Mut write-back across multiple entities', () => {
        it('should write back mutations for all entities', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 0, y: 0 });

            const e2 = world.spawn();
            world.insert(e2, Position, { x: 0, y: 0 });

            const e3 = world.spawn();
            world.insert(e3, Position, { x: 0, y: 0 });

            const query = Query(Mut(Position));
            new QueryInstance(world, query).forEach((entity, pos) => {
                pos.x = entity * 10;
                pos.y = entity * 20;
            });

            expect(world.get(e1, Position)).toEqual({ x: e1 * 10, y: e1 * 20 });
            expect(world.get(e2, Position)).toEqual({ x: e2 * 10, y: e2 * 20 });
            expect(world.get(e3, Position)).toEqual({ x: e3 * 10, y: e3 * 20 });
        });
    });

    // =========================================================================
    // Removed query
    // =========================================================================

    describe('Removed query', () => {
        it('should create a removed descriptor', () => {
            const desc = Removed(Position);
            expect(desc._type).toBe('removed');
            expect(desc._component).toBe(Position);
        });

        it('should iterate over removed entities', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.remove(e1, Position);

            const instance = new RemovedQueryInstance(world, Position, -1);
            const removed = instance.toArray();
            expect(removed).toContain(e1);
        });

        it('should report isEmpty correctly', () => {
            const instance = new RemovedQueryInstance(world, Position, Infinity);
            expect(instance.isEmpty()).toBe(true);

            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.remove(e1, Position);

            const instance2 = new RemovedQueryInstance(world, Position, -1);
            expect(instance2.isEmpty()).toBe(false);
        });

        it('should be iterable', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });
            world.remove(e1, Position);

            const instance = new RemovedQueryInstance(world, Position, -1);
            const results: number[] = [];
            for (const entity of instance) {
                results.push(entity);
            }
            expect(results).toContain(e1);
        });
    });
});
