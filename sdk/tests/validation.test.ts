import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import { defineComponent, defineTag } from '../src/component';
import { createMockModule } from './mocks/wasm';

describe('Component Data Validation', () => {
    let world: World;

    const Position = defineComponent('Position', { x: 0, y: 0 });
    const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 });
    const Health = defineComponent('Health', {
        value: 100,
        max: 100,
        regeneration: 0,
    });
    const Player = defineComponent('Player', {
        name: 'Player',
        level: 1,
        active: true,
        items: [] as string[],
    });

    beforeEach(() => {
        const module = createMockModule();
        world = new World(module);
    });

    describe('valid data', () => {
        it('should accept valid component data', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: 10, y: 20 });
            }).not.toThrow();

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(10);
            expect(pos.y).toBe(20);
        });

        it('should accept partial data', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: 5 });
            }).not.toThrow();

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(5);
            expect(pos.y).toBe(0);
        });

        it('should accept data with all fields', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Health, { value: 75, max: 150, regeneration: 5 });
            }).not.toThrow();

            const hp = world.get(entity, Health);
            expect(hp.value).toBe(75);
            expect(hp.max).toBe(150);
            expect(hp.regeneration).toBe(5);
        });

        it('should accept mixed types', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Player, {
                    name: 'Hero',
                    level: 5,
                    active: false,
                    items: ['sword', 'shield'],
                });
            }).not.toThrow();

            const player = world.get(entity, Player);
            expect(player.name).toBe('Hero');
            expect(player.level).toBe(5);
            expect(player.active).toBe(false);
            expect(player.items).toEqual(['sword', 'shield']);
        });

        it('should accept empty data', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, {});
            }).not.toThrow();

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
        });

        it('should accept null and undefined for optional data', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, undefined);
            }).not.toThrow();

            expect(() => {
                world.insert(entity, Velocity, null as any);
            }).not.toThrow();
        });
    });

    describe('type mismatch', () => {
        it('should reject wrong type for number field', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: 'invalid' as any, y: 0 });
            }).toThrow(/Invalid component data.*Position/);
        });

        it('should reject wrong type for string field', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Player, { name: 123 as any });
            }).toThrow(/Invalid component data.*Player/);
        });

        it('should reject wrong type for boolean field', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Player, { active: 'yes' as any });
            }).toThrow(/Invalid component data.*Player/);
        });

        it('should reject wrong type for array field', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Player, { items: 'not-an-array' as any });
            }).toThrow(/Invalid component data.*Player/);
        });

        it('should reject multiple type mismatches', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: 'bad' as any, y: 'also-bad' as any });
            }).toThrow(/Invalid component data.*Position/);
        });
    });

    describe('unknown fields', () => {
        it('should reject unknown fields', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: 1, y: 2, z: 3 } as any);
            }).toThrow(/Invalid component data.*Position/);
        });

        it('should reject unknown fields even with valid fields', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Health, {
                    value: 50,
                    max: 100,
                    unknown: 'field',
                } as any);
            }).toThrow(/Invalid component data.*Health/);
        });
    });

    describe('null and undefined handling', () => {
        it('should allow null values', () => {
            const NullableComp = defineComponent('NullableComp', {
                value: null as number | null,
            });

            const entity = world.spawn();

            expect(() => {
                world.insert(entity, NullableComp, { value: null });
            }).not.toThrow();

            const comp = world.get(entity, NullableComp);
            expect(comp.value).toBeNull();
        });

        it('should filter out undefined values but not validate them', () => {
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Position, { x: undefined, y: 5 });
            }).not.toThrow();

            const pos = world.get(entity, Position);
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(5);
        });
    });

    describe('tag components', () => {
        it('should accept tag components without data', () => {
            const Tag = defineTag('Tag');
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Tag);
            }).not.toThrow();

            expect(world.has(entity, Tag)).toBe(true);
        });

        it('should accept tag components with empty object', () => {
            const Tag = defineTag('Tag');
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Tag, {});
            }).not.toThrow();

            expect(world.has(entity, Tag)).toBe(true);
        });

        it('should reject tag components with unknown fields', () => {
            const Tag = defineTag('Tag');
            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Tag, { invalid: true } as any);
            }).toThrow(/Invalid component data.*Tag/);
        });
    });

    describe('error messages', () => {
        it('should provide clear error message for type mismatch', () => {
            const entity = world.spawn();

            try {
                world.insert(entity, Position, { x: 'string' as any });
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('Position');
                expect(message).toContain('x');
                expect(message).toContain('number');
                expect(message).toContain('string');
            }
        });

        it('should provide clear error message for unknown field', () => {
            const entity = world.spawn();

            try {
                world.insert(entity, Position, { z: 10 } as any);
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('Position');
                expect(message).toContain('z');
                expect(message).toContain('unknown field');
            }
        });

        it('should list all validation errors', () => {
            const entity = world.spawn();

            try {
                world.insert(entity, Position, {
                    x: 'bad' as any,
                    y: 'also-bad' as any,
                    z: 10,
                } as any);
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('x');
                expect(message).toContain('y');
                expect(message).toContain('z');
            }
        });
    });

    describe('complex data types', () => {
        it('should validate nested objects', () => {
            const Transform = defineComponent('Transform', {
                position: { x: 0, y: 0 },
                rotation: 0,
            });

            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Transform, {
                    position: { x: 10, y: 20 },
                    rotation: 45,
                });
            }).not.toThrow();
        });

        it('should validate arrays', () => {
            const Inventory = defineComponent('Inventory', {
                items: [] as string[],
            });

            const entity = world.spawn();

            expect(() => {
                world.insert(entity, Inventory, {
                    items: ['sword', 'potion'],
                });
            }).not.toThrow();

            const inv = world.get(entity, Inventory);
            expect(inv.items).toEqual(['sword', 'potion']);
        });
    });
});
