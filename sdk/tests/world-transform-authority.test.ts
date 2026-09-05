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

/**
 * A core with no emscripten module — the shape a native host connects in — reads
 * neither half of the seam off `module`, so it hands them over instead. Here the
 * web engine stands in for that host: the epoch view and the compose call are the
 * engine's own, reached the way a native binding would deliver them.
 */
describe.skipIf(!HAS_WASM)('a core that hands the composition seam over', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    /** What a native host binds: a one-word view, and the call that composes. On a
     *  native core the word lives in an arena that never moves; here it borrows the
     *  wasm heap, which is why nothing in these tests grows it. */
    const handedOver = (registry: CppRegistry) => ({
        epoch: new Uint32Array(module.HEAPU32.buffer, module.transform_epochAddress!(), 1),
        ensure: () => module.transform_ensureComposed!(registry),
    });

    function parented(handOver: boolean) {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, undefined,
            handOver ? { transformComposition: handedOver(registry) } : {});
        const world = app.world;
        const parent = world.spawn('parent');
        world.insert(parent, Transform, { position: { x: 100, y: 0, z: 0 } });
        const child = world.spawn('child');
        world.insert(child, Transform, { position: { x: 5, y: 0, z: 0 } });
        world.setParent(child, parent);
        const worldX = () => (world.get(child, Transform) as { worldPosition: { x: number } })
            .worldPosition.x;
        return { world, parent, worldX };
    }

    it('composes through the seam it was handed', () => {
        const { world, parent, worldX } = parented(true);
        world.ensureTransformsComposed();
        expect(worldX()).toBe(105);

        const before = world.transformEpoch();
        world.update(parent, Transform, (t) => { (t as { position: { x: number } }).position.x = 200; });
        expect(world.transformEpoch()).not.toBe(before);
        world.ensureTransformsComposed();
        expect(worldX()).toBe(205);
        world.disconnectCpp();
    });

    it('without it, an announcement goes nowhere and nothing recomposes', () => {
        const { world, worldX } = parented(false);
        world.ensureTransformsComposed();
        expect(world.transformEpoch()).toBe(-1);
        expect(worldX()).toBe(0);
        world.disconnectCpp();
    });
});

/**
 * What a consumer maintaining an incremental structure reads: a serial saying
 * WHICH composition it is looking at, and the entities that one changed. The
 * pair is the whole contract — a set without a serial cannot tell "nothing
 * moved" from "you missed three compositions".
 */
describe.skipIf(!HAS_WASM)('the composition reports what it changed', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function scene() {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        const world = app.world;
        const a = world.spawn('a');
        world.insert(a, Transform, { position: { x: 1, y: 0, z: 0 } });
        const b = world.spawn('b');
        world.insert(b, Transform, { position: { x: 2, y: 0, z: 0 } });
        return { app, world, a, b };
    }
    const ids = (world: App['world']) => [...(world.lastComposition()!.changed)];

    it('names the entities whose output moved, and only those', () => {
        const { world, a, b } = scene();
        expect(world.setTransformChangeTracking(true)).toBe(true);
        world.ensureTransformsComposed();

        world.update(b, Transform, (t) => { (t as { position: { x: number } }).position.x = 40; });
        world.ensureTransformsComposed();
        expect(ids(world)).toEqual([b as number]);

        // A write that moves nothing: the epoch cannot tell it from movement and
        // the comparison can, which is the whole reason the set is worth having.
        world.update(a, Transform, (t) => { (t as { position: { x: number } }).position.x = 1; });
        world.ensureTransformsComposed();
        expect(ids(world)).toEqual([]);
        world.setTransformChangeTracking(false);
        world.disconnectCpp();
    });

    it('advances the serial once per composition and not at all without one', () => {
        const { world, a } = scene();
        world.setTransformChangeTracking(true);
        world.ensureTransformsComposed();
        const first = world.lastComposition()!.serial;

        // Nothing was invalidated, so nothing composed.
        world.ensureTransformsComposed();
        world.ensureTransformsComposed();
        expect(world.lastComposition()!.serial).toBe(first);

        world.update(a, Transform, (t) => { (t as { position: { x: number } }).position.x = 9; });
        world.ensureTransformsComposed();
        expect(world.lastComposition()!.serial).toBe(first + 1);
        world.setTransformChangeTracking(false);
        world.disconnectCpp();
    });

    it('reports nothing while tracking is off, and the serial still moves', () => {
        const { world, a } = scene();
        world.setTransformChangeTracking(false);
        world.ensureTransformsComposed();
        const before = world.lastComposition()!.serial;

        world.update(a, Transform, (t) => { (t as { position: { x: number } }).position.x = 3; });
        world.ensureTransformsComposed();
        const after = world.lastComposition()!;
        expect(after.serial).toBe(before + 1);
        expect(after.changed.length).toBe(0);
        world.disconnectCpp();
    });

    it('a second world composing in between shows up as a gap', () => {
        const first = scene();
        first.world.setTransformChangeTracking(true);
        first.world.ensureTransformsComposed();
        const seen = first.world.lastComposition()!.serial;

        // Another world composes; the serial is the engine's, not this world's,
        // so a consumer that missed compositions has to be able to see that.
        const other = scene();
        other.world.ensureTransformsComposed();
        other.world.disconnectCpp();

        first.world.update(first.a, Transform,
            (t) => { (t as { position: { x: number } }).position.x = 50; });
        first.world.ensureTransformsComposed();
        expect(first.world.lastComposition()!.serial).toBeGreaterThan(seen + 1);
        first.world.setTransformChangeTracking(false);
        first.world.disconnectCpp();
    });

    it('a core that cannot report says so instead of answering nothing', () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        // The seam without its optional third half — a host too old to report.
        app.connectCpp(registry, undefined, {
            transformComposition: {
                epoch: new Uint32Array(module.HEAPU32.buffer, module.transform_epochAddress!(), 1),
                ensure: () => module.transform_ensureComposed!(registry),
            },
        });
        expect(app.world.setTransformChangeTracking(true)).toBe(false);
        expect(app.world.lastComposition()).toBeNull();
        app.world.disconnectCpp();
    });
});
