/**
 * Integration tests: Entity parent-child hierarchy via real WASM module.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { World } from '../src/world';
import { Transform, Sprite, Parent, Children } from '../src/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Entity Hierarchy (WASM integration)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createWorld(): { world: World; registry: CppRegistry } {
        const registry = new module.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, module);
        return { world, registry };
    }

    function disposeWorld(world: World, registry: CppRegistry): void {
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    }

    describe('setParent / getChildEntities', () => {
        it('should establish parent-child relationship', () => {
            const { world, registry } = createWorld();

            const parent = world.spawn();
            const child = world.spawn();

            world.setParent(child, parent);

            expect(registry.hasParent(child)).toBe(true);
            const parentComp = registry.getParent(child);
            expect(parentComp.entity).toBe(parent);

            expect(registry.hasChildren(parent)).toBe(true);

            disposeWorld(world, registry);
        });

        it('should return child entities via getChildEntities', () => {
            const { world, registry } = createWorld();

            const parent = world.spawn();
            const child1 = world.spawn();
            const child2 = world.spawn();
            const child3 = world.spawn();

            world.setParent(child1, parent);
            world.setParent(child2, parent);
            world.setParent(child3, parent);

            const children = module.getChildEntities(registry, parent);
            expect(children).toHaveLength(3);
            expect(children).toContain(child1);
            expect(children).toContain(child2);
            expect(children).toContain(child3);

            disposeWorld(world, registry);
        });

        it('should return empty array for entity with no children', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            const children = module.getChildEntities(registry, entity);
            expect(children).toHaveLength(0);

            disposeWorld(world, registry);
        });

        it('should support multi-level hierarchy', () => {
            const { world, registry } = createWorld();

            const root = world.spawn();
            const mid = world.spawn();
            const leaf = world.spawn();

            world.setParent(mid, root);
            world.setParent(leaf, mid);

            const rootChildren = module.getChildEntities(registry, root);
            expect(rootChildren).toHaveLength(1);
            expect(rootChildren).toContain(mid);

            const midChildren = module.getChildEntities(registry, mid);
            expect(midChildren).toHaveLength(1);
            expect(midChildren).toContain(leaf);

            const leafChildren = module.getChildEntities(registry, leaf);
            expect(leafChildren).toHaveLength(0);

            expect(registry.getParent(mid).entity).toBe(root);
            expect(registry.getParent(leaf).entity).toBe(mid);

            disposeWorld(world, registry);
        });

        it('should remove parent relationship via removeParent', () => {
            const { world, registry } = createWorld();

            const parent = world.spawn();
            const child = world.spawn();

            world.setParent(child, parent);
            expect(registry.hasParent(child)).toBe(true);

            world.removeParent(child);
            expect(registry.hasParent(child)).toBe(false);

            disposeWorld(world, registry);
        });

        it('should reparent entity to a different parent', () => {
            const { world, registry } = createWorld();

            const parent1 = world.spawn();
            const parent2 = world.spawn();
            const child = world.spawn();

            world.setParent(child, parent1);
            expect(module.getChildEntities(registry, parent1)).toHaveLength(1);
            expect(module.getChildEntities(registry, parent2)).toHaveLength(0);

            world.setParent(child, parent2);
            expect(module.getChildEntities(registry, parent1)).toHaveLength(0);
            expect(module.getChildEntities(registry, parent2)).toHaveLength(1);
            expect(registry.getParent(child).entity).toBe(parent2);

            disposeWorld(world, registry);
        });
    });

    describe('builtin component CRUD via World', () => {
        it('should insert and get Transform', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Transform, {
                position: { x: 10, y: 20, z: 30 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 2, y: 2, z: 2 },
            });

            expect(world.has(entity, Transform)).toBe(true);

            const lt = world.get(entity, Transform);
            expect(lt.position.x).toBeCloseTo(10);
            expect(lt.position.y).toBeCloseTo(20);
            expect(lt.position.z).toBeCloseTo(30);
            expect(lt.scale.x).toBeCloseTo(2);

            disposeWorld(world, registry);
        });

        it('should insert and get Sprite', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Sprite, {
                texture: 0,
                color: { r: 1, g: 0, b: 0, a: 1 },
                size: { x: 64, y: 32 },
                uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 },
                layer: 5,
                flipX: true,
                flipY: false,
            });

            expect(world.has(entity, Sprite)).toBe(true);

            const sprite = registry.getSprite(entity);
            expect(sprite.layer).toBe(5);
            expect(sprite.flipX).toBe(true);
            expect(sprite.flipY).toBe(false);

            disposeWorld(world, registry);
        });

        it('should remove builtin component', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Transform);
            expect(world.has(entity, Transform)).toBe(true);

            world.remove(entity, Transform);
            expect(world.has(entity, Transform)).toBe(false);
            expect(registry.hasTransform(entity)).toBe(false);

            disposeWorld(world, registry);
        });

        it('should update existing component via insert', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Transform, {
                position: { x: 1, y: 2, z: 3 },
            });

            world.insert(entity, Transform, {
                position: { x: 100, y: 200, z: 300 },
            });

            const lt = registry.getTransform(entity);
            expect(lt.position.x).toBeCloseTo(100);
            expect(lt.position.y).toBeCloseTo(200);
            expect(lt.position.z).toBeCloseTo(300);

            disposeWorld(world, registry);
        });

        it('should insert multiple builtin components on same entity', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Transform);
            world.insert(entity, Sprite, {
                texture: 0,
                color: { r: 1, g: 1, b: 1, a: 1 },
                size: { x: 32, y: 32 },
                uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 },
                layer: 0,
                flipX: false,
                flipY: false,
            });

            expect(registry.hasTransform(entity)).toBe(true);
            expect(registry.hasSprite(entity)).toBe(true);

            disposeWorld(world, registry);
        });
    });

    describe('entity despawn with hierarchy', () => {
        it('should despawn entity and clean up', () => {
            const { world, registry } = createWorld();

            const entity = world.spawn();
            world.insert(entity, Transform);
            world.insert(entity, Sprite, {
                texture: 0,
                color: { r: 1, g: 1, b: 1, a: 1 },
                size: { x: 32, y: 32 },
                uvOffset: { x: 0, y: 0 },
                uvScale: { x: 1, y: 1 },
                layer: 0,
                flipX: false,
                flipY: false,
            });

            world.despawn(entity);

            expect(world.valid(entity)).toBe(false);
            expect(world.entityCount()).toBe(0);

            disposeWorld(world, registry);
        });

        it('should handle spawning many entities and despawning some', () => {
            const { world, registry } = createWorld();

            const entities: number[] = [];
            for (let i = 0; i < 100; i++) {
                const e = world.spawn();
                world.insert(e, Transform, {
                    position: { x: i, y: i * 2, z: 0 },
                });
                entities.push(e);
            }

            expect(world.entityCount()).toBe(100);

            for (let i = 0; i < 50; i++) {
                world.despawn(entities[i * 2] as any);
            }

            expect(world.entityCount()).toBe(50);

            disposeWorld(world, registry);
        });
    });

    describe('World.valid and entity lifecycle', () => {
        it('should report valid for living entities', () => {
            const { world, registry } = createWorld();

            const e1 = world.spawn();
            const e2 = world.spawn();

            expect(world.valid(e1)).toBe(true);
            expect(world.valid(e2)).toBe(true);

            world.despawn(e1);
            expect(world.valid(e1)).toBe(false);
            expect(world.valid(e2)).toBe(true);

            disposeWorld(world, registry);
        });

        it('should track entity count correctly', () => {
            const { world, registry } = createWorld();

            expect(world.entityCount()).toBe(0);

            const e1 = world.spawn();
            expect(world.entityCount()).toBe(1);

            const e2 = world.spawn();
            expect(world.entityCount()).toBe(2);

            world.despawn(e1);
            expect(world.entityCount()).toBe(1);

            world.despawn(e2);
            expect(world.entityCount()).toBe(0);

            disposeWorld(world, registry);
        });
    });
});
