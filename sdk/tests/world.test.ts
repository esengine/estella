import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import { defineComponent, defineTag } from '../src/component';
import { createMockModule } from './mocks/wasm';

describe('World', () => {
    let world: World;

    const Position = defineComponent('Position', { x: 0, y: 0 });
    const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 });
    const Health = defineComponent('Health', { value: 100 });
    const Player = defineTag('Player');

    beforeEach(() => {
        const module = createMockModule();
        world = new World(module);
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
});
