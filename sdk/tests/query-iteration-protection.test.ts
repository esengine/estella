import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import { Query, QueryInstance, Mut } from '../src/query';
import { defineComponent } from '../src/component';

describe('Query Iteration Protection', () => {
    let world: World;

    const Position = defineComponent('IPPosition', { x: 0, y: 0 });
    const Velocity = defineComponent('IPVelocity', { dx: 0, dy: 0 });
    const Health = defineComponent('IPHealth', { value: 100 });

    beforeEach(() => {
        world = new World();
    });

    describe('spawn protection', () => {
        it('should throw when spawning during iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Position);

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    world.spawn();
                });
            }).toThrow(/Cannot spawn entity during query iteration/);
        });

        it('should allow spawning before iteration', () => {
            expect(() => {
                const e = world.spawn();
                world.insert(e, Position);
            }).not.toThrow();
        });

        it('should allow spawning after iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);
            new QueryInstance(world, query).forEach(() => {});

            expect(() => {
                world.spawn();
            }).not.toThrow();
        });
    });

    describe('despawn protection', () => {
        it('should throw when despawning during iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    world.despawn(entity);
                });
            }).toThrow(/Cannot despawn entity during query iteration/);
        });

        it('should allow despawning after iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);
            let captured: number = 0;

            new QueryInstance(world, query).forEach((entity) => {
                captured = entity;
            });

            expect(() => {
                world.despawn(captured);
            }).not.toThrow();
        });
    });

    describe('component removal protection', () => {
        it('should throw when removing component during iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);
            world.insert(e1, Velocity);

            const query = Query(Position);

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    world.remove(entity, Velocity);
                });
            }).toThrow(/Cannot remove component during query iteration/);
        });

        it('should allow removing component after iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);
            world.insert(e1, Velocity);

            const query = Query(Position);
            let captured: number = 0;

            new QueryInstance(world, query).forEach((entity) => {
                captured = entity;
            });

            expect(() => {
                world.remove(captured, Velocity);
            }).not.toThrow();
        });
    });

    describe('nested iteration', () => {
        it('should protect nested iterations', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const e2 = world.spawn();
            world.insert(e2, Velocity);

            const query1 = Query(Position);
            const query2 = Query(Velocity);

            expect(() => {
                new QueryInstance(world, query1).forEach(() => {
                    new QueryInstance(world, query2).forEach(() => {
                        world.spawn();
                    });
                });
            }).toThrow(/Cannot spawn entity during query iteration/);
        });

        it('should track nested iteration depth correctly', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const e2 = world.spawn();
            world.insert(e2, Velocity);

            const query1 = Query(Position);
            const query2 = Query(Velocity);

            let innerExecuted = false;

            new QueryInstance(world, query1).forEach(() => {
                new QueryInstance(world, query2).forEach(() => {
                    innerExecuted = true;
                });
            });

            expect(innerExecuted).toBe(true);

            expect(() => {
                world.spawn();
            }).not.toThrow();
        });
    });

    describe('Mut() writeback', () => {
        it('should allow Mut() writeback after iteration', () => {
            const e1 = world.spawn();
            world.insert(e1, Position, { x: 1, y: 1 });

            const query = Query(Mut(Position));

            expect(() => {
                new QueryInstance(world, query).forEach((entity, pos) => {
                    pos.x = 10;
                    pos.y = 20;
                });
            }).not.toThrow();

            const updated = world.get(e1, Position);
            expect(updated.x).toBe(10);
            expect(updated.y).toBe(20);
        });
    });

    describe('iteration methods', () => {
        it('forEach should protect against structural changes', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);

            expect(() => {
                new QueryInstance(world, query).forEach((entity) => {
                    world.spawn();
                });
            }).toThrow(/Cannot spawn entity during query iteration/);
        });

        it('iterator should protect against structural changes', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);
            const instance = new QueryInstance(world, query);

            expect(() => {
                const iter = instance[Symbol.iterator]();
                iter.next();
                world.spawn();
            }).toThrow(/Cannot spawn entity during query iteration/);
        });
    });

    describe('error messages', () => {
        it('should provide clear error for spawn', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);

            try {
                new QueryInstance(world, query).forEach(() => {
                    world.spawn();
                });
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('spawn');
                expect(message).toContain('query iteration');
                expect(message).toContain('Commands');
            }
        });

        it('should provide clear error for despawn', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);

            const query = Query(Position);

            try {
                new QueryInstance(world, query).forEach((entity) => {
                    world.despawn(entity);
                });
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('despawn');
                expect(message).toContain('query iteration');
                expect(message).toContain('Commands');
            }
        });

        it('should provide clear error for remove', () => {
            const e1 = world.spawn();
            world.insert(e1, Position);
            world.insert(e1, Velocity);

            const query = Query(Position);

            try {
                new QueryInstance(world, query).forEach((entity) => {
                    world.remove(entity, Velocity);
                });
                expect.fail('Should have thrown');
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain('remove component');
                expect(message).toContain('query iteration');
                expect(message).toContain('Commands');
            }
        });
    });
});
