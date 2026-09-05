// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Who decides when world transforms are recomposed.
 *
 * A staleness epoch that producers advance and consumers wait on. A render
 * frame is not a mutation: a server with no frames still recomposes, and two
 * fixed steps inside one frame each get their own answer.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Sprite, Transform } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('world transform authority', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    /** A parent at 100 and a child 5 to its right, on a server with no renderer. */
    function parented() {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        const worldX = () => (world.get(child, Transform) as { worldPosition: { x: number } })
            .worldPosition.x;
        return { app, world, parent, child, worldX };
    }

    it('composes for a server that has no renderer at all', () => {
        const { world, worldX } = parented();
        world.ensureTransformsComposed();
        expect(worldX()).toBe(105);
    });

    it('recomposes for each of two steps inside one frame', () => {
        const { world, parent, worldX } = parented();
        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 10; });
        world.ensureTransformsComposed();
        expect(worldX()).toBe(15);

        // No frame boundary between these: replication samples on every fixed
        // step, and a frame may run several.
        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 20; });
        world.ensureTransformsComposed();
        expect(worldX()).toBe(25);
    });

    it('composes once for any number of consumers in one generation', () => {
        const { world, parent, worldX } = parented();
        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 7; });
        const epoch = world.transformEpoch();

        world.ensureTransformsComposed();
        world.ensureTransformsComposed();
        world.ensureTransformsComposed();

        expect(worldX()).toBe(12);
        // Composing does not itself count as a mutation: writing the world
        // fields must not advance the epoch, or every compose is stale again.
        expect(world.transformEpoch()).toBe(epoch);
    });

    it('a render frame is not a mutation', () => {
        const { world } = parented();
        world.ensureTransformsComposed();
        const epoch = world.transformEpoch();
        module.renderer_beginFrame(0);
        expect(world.transformEpoch()).toBe(epoch);
    });

    it('every legal write path advances the epoch', () => {
        const { world, parent } = parented();
        const advances = (fn: () => void): boolean => {
            const before = world.transformEpoch();
            fn();
            return world.transformEpoch() !== before;
        };
        expect(advances(() => world.update(parent, Transform, (t) => {
            (t as { position: { x: number } }).position.x += 1;
        }))).toBe(true);
        expect(advances(() => world.set(parent, Transform,
            world.get(parent, Transform)))).toBe(true);
        expect(advances(() => world.markChanged(parent, Transform))).toBe(true);
        // Hierarchy moves a subtree without touching a single transform.
        const other = world.spawn('other');
        world.insert(other, Transform, { position: { x: 0, y: 0, z: 0 } });
        expect(advances(() => world.setParent(other, parent))).toBe(true);
    });

    it('survives the wasm heap growing under the notifier', () => {
        const { world, parent, worldX } = parented();
        world.ensureTransformsComposed();

        // A cached typed-array view detaches when Emscripten replaces the heap,
        // and writes to it go nowhere while looking like they worked.
        const before = module.HEAPU32.buffer;
        const blocks: number[] = [];
        for (let i = 0; i < 64 && module.HEAPU32.buffer === before; i++) {
            blocks.push((module as unknown as { _malloc(n: number): number })._malloc(8 << 20));
        }
        expect(blocks.length).toBeGreaterThan(0);

        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 400; });
        world.ensureTransformsComposed();
        expect(worldX()).toBe(405);
    });

    it('keeps two worlds apart even at the same epoch value', () => {
        const a = parented();
        a.world.ensureTransformsComposed();
        expect(a.worldX()).toBe(105);

        // A second registry, composed at whatever number the shared epoch holds:
        // having composed the first world says nothing about this one.
        const b = parented();
        b.world.ensureTransformsComposed();
        expect(b.worldX()).toBe(105);
    });

    it('composes a chain built after the first compose', () => {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        world.ensureTransformsComposed();
        const p = world.spawn();
        world.insert(p, Transform, { position: { x: 3, y: 0, z: 0 } });
        const c = world.spawn();
        world.insert(c, Transform, { position: { x: 4, y: 0, z: 0 } });
        world.setParent(c, p);
        world.ensureTransformsComposed();
        expect((world.get(c, Transform) as { worldPosition: { x: number } }).worldPosition.x).toBe(7);
        world.disconnectCpp();
    });
});

describe('a compiled system that moves transforms', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('invalidates composition with no Changed consumer anywhere', () => {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        const parent = world.spawn();
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn();
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        world.ensureTransformsComposed();

        // Nothing tracks Transform: no Changed() filter, no replication, no
        // write reader. Composition staleness must not depend on any of them —
        // the AOT dispatcher reports it before the tracking filter, not inside.
        expect(world.isChangeTracked(Transform)).toBe(false);

        const before = world.transformEpoch();
        world.invalidateTransformComposition();
        expect(world.transformEpoch()).not.toBe(before);

        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 200; });
        world.ensureTransformsComposed();
        expect((world.get(child, Transform) as { worldPosition: { x: number } }).worldPosition.x)
            .toBe(205);
        world.disconnectCpp();
    });
});

/**
 * The editor's generated field setter writes the same bytes every other producer
 * writes, and until now said nothing. It got away with it because an editor
 * always has a renderer — so these run without one, which is the only way to tell
 * "it announced" apart from "something else was drawing anyway".
 */
describe.skipIf(!HAS_WASM)('the editor writes through the same authority', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    interface EditorApi {
        editor_setFloat(reg: CppRegistry, e: number, comp: string, field: string, v: number): boolean;
        editor_addComponent(reg: CppRegistry, e: number, name: string): boolean;
    }
    const editor = (): EditorApi => module as unknown as EditorApi;
    const worldPosX = (reg: CppRegistry, e: number): number =>
        (reg as unknown as { getTransform(e: number): { worldPosition: { x: number } } })
            .getTransform(e).worldPosition.x;

    /** A parent at 100 and a child 5 to its right, with no renderer installed. */
    function parented() {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        const world = app.world;
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        world.ensureTransformsComposed();
        return { app, world, registry, parent, child };
    }

    it('a generated field setter recomposes a world that has no renderer', () => {
        const { world, registry, parent, child } = parented();
        expect(worldPosX(registry, child)).toBe(105);

        const before = world.transformEpoch();
        expect(editor().editor_setFloat(registry, parent, 'Transform', 'position.x', 300)).toBe(true);
        expect(world.transformEpoch()).not.toBe(before);

        world.ensureTransformsComposed();
        expect(worldPosX(registry, child)).toBe(305);
        world.disconnectCpp();
    });

    it('the euler path announces too, not just the vector fields', () => {
        const { world, registry, parent } = parented();
        const before = world.transformEpoch();
        expect(editor().editor_setFloat(registry, parent, 'Transform', 'rotation.z', 90)).toBe(true);
        expect(world.transformEpoch()).not.toBe(before);
        world.disconnectCpp();
    });

    it('a setter for any other component announces nothing', () => {
        const { world, registry, parent } = parented();
        world.insert(parent, Sprite, {});
        const before = world.transformEpoch();

        // Staleness is about the composition's inputs. A generated setter that
        // bumped the epoch for every component would recompose the whole world on
        // any editor edit, and no test of the composition would catch it.
        expect(editor().editor_setFloat(registry, parent, 'Sprite', 'size.x', 42)).toBe(true);
        expect(world.transformEpoch()).toBe(before);
        world.disconnectCpp();
    });

    it('adding a Transform under a parent composes it into place', () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        const world = app.world;
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        // Parented, but carrying no Transform: nothing composes it, and nothing
        // should — it has no world position to have.
        const child = world.spawn('child');
        world.setParent(child, parent);
        world.ensureTransformsComposed();

        expect(editor().editor_addComponent(registry, child, 'Transform')).toBe(true);
        world.ensureTransformsComposed();
        expect(worldPosX(registry, child)).toBe(100);
        world.disconnectCpp();
    });
});
