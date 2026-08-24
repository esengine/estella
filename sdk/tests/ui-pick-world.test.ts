// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Picking an entity that is NOT in the UI layout tree, via the real raycast.
 *
 * ui-drag-plugin.test.ts sets `hovered` by hand, so it covers the drag logic and
 * not whether such an entity can be hovered at all.
 * Requires pre-built WASM at build/wasm/web/esengine.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Sprite, MeshRenderer } from '../src/ecs/component';
import { Interactable } from '../src/ui/input/interactable';
import type { Entity, Vec3 } from '../src/types';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const NO_HIT = 0xffffffff;

describe.skipIf(!HAS_WASM)('world-space picking (WASM integration)', () => {
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
            try { world.despawn(e); } catch { /* already gone */ }
        }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    /** A plain world-space sprite: no UINode, so the layout tree never sees it. */
    function sprite(
        world: World, x: number, y: number,
        opts: { size?: number; layer?: number; raycastTarget?: boolean; scale?: number;
                z?: number } = {},
    ): Entity {
        const e = world.spawn();
        const s = opts.size ?? 100;
        const k = opts.scale ?? 1;
        world.insert(e, Transform, { position: { x, y, z: opts.z ?? 0 }, scale: { x: k, y: k, z: 1 } });
        world.insert(e, Sprite, { size: { x: s, y: s }, layer: opts.layer ?? 0 });
        world.insert(e, Interactable, { raycastTarget: opts.raycastTarget ?? true });
        return e;
    }

    /**
     * A world-space mesh: a quad of inline geometry, which is the only kind a
     * bare registry can hold — a resident .esmesh needs a ResourceManager, and
     * the only difference downstream is where localMin/localMax are read from.
     */
    function mesh(
        world: World, x: number, y: number, z: number,
        opts: { half?: number; layer?: number } = {},
    ): Entity {
        const h = opts.half ?? 50;
        const e = world.spawn();
        world.insert(e, Transform, { position: { x, y, z } });
        world.insert(e, MeshRenderer, { layer: opts.layer ?? 0 });
        world.insert(e, Interactable, { raycastTarget: true });

        const positions = [-h, -h, h, -h, h, h, -h, h];
        const posUv = new Float32Array(positions.length * 2);
        for (let v = 0; v < 4; v++) {
            posUv[v * 4 + 0] = positions[v * 2 + 0];
            posUv[v * 4 + 1] = positions[v * 2 + 1];
        }
        const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
        const posPtr = module._malloc!(posUv.byteLength);
        const idxPtr = module._malloc!(indices.byteLength);
        module.HEAPF32!.set(posUv, posPtr >> 2);
        module.HEAPU32!.set(indices, idxPtr >> 2);
        module.meshRenderer_setGeometry!(
            world.getCppRegistry() as never, e, posPtr, 4, 0, idxPtr, indices.length);
        module._free!(posPtr);
        module._free!(idxPtr);
        return e;
    }

    let frame = 0;
    /** An orthographic pointer: straight down -Z from above everything. */
    function pickAt(registry: CppRegistry, x: number, y: number): number {
        return pickRay(registry, { x, y, z: 1000 }, { x: 0, y: 0, z: -1 });
    }

    function pickRay(registry: CppRegistry, origin: Vec3, dir: Vec3): number {
        // transforms_updated is memoised per frame, so each pick needs its own.
        module.renderer_beginFrame(frame++);
        module.renderer_updateTransforms(registry as never);
        module.uiHitTest_update(registry as never,
                                origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
        return module.uiHitTest_getHitEntity();
    }

    it('hits a sprite that has no UINode', () => {
        const { world, registry } = createWorld();
        const e = sprite(world, 0, 0);

        expect(pickAt(registry, 0, 0)).toBe(e);

        disposeWorld(world, registry);
    });

    it('misses outside the sprite, so the box is the sprite and not the world', () => {
        const { world, registry } = createWorld();
        sprite(world, 0, 0, { size: 100 });

        // Just inside, then well outside: a pass that always hits would fail here.
        expect(pickAt(registry, 49, 49)).not.toBe(NO_HIT);
        expect(pickAt(registry, 400, 400)).toBe(NO_HIT);

        disposeWorld(world, registry);
    });

    it('sets UIInteraction, which is what the drag system gates on', () => {
        const { world, registry } = createWorld();
        const e = sprite(world, 0, 0);

        pickAt(registry, 0, 0);

        // The engine writes it, so ask the engine: this is the component the drag
        // system reads `hovered` from, and nothing else creates it here.
        const reg = registry as unknown as { hasUIInteraction(e: number): boolean };
        expect(reg.hasUIInteraction(e)).toBe(true);

        disposeWorld(world, registry);
    });

    it('honours raycastTarget: false', () => {
        const { world, registry } = createWorld();
        const opaque = sprite(world, 0, 0);

        // Prove the point IS pickable first: asserting only the miss would pass
        // just as well with no world-space pass at all.
        expect(pickAt(registry, 0, 0)).toBe(opaque);

        world.insert(opaque, Interactable, { raycastTarget: false });
        expect(pickAt(registry, 0, 0)).toBe(NO_HIT);

        disposeWorld(world, registry);
    });

    it('takes the higher layer when two overlap', () => {
        const { world, registry } = createWorld();
        sprite(world, 0, 0, { layer: 0 });
        const top = sprite(world, 0, 0, { layer: 5 });

        expect(pickAt(registry, 0, 0)).toBe(top);

        disposeWorld(world, registry);
    });

    it('scales the box with the transform', () => {
        const { world, registry } = createWorld();
        const e = sprite(world, 0, 0, { size: 100, scale: 3 });

        // 140 is outside the unscaled box (±50) and inside the scaled one (±150).
        expect(pickAt(registry, 140, 0)).toBe(e);

        disposeWorld(world, registry);
    });

    it('hits a MeshRenderer, which no pass reached before', () => {
        const { world, registry } = createWorld();
        const e = mesh(world, 0, 0, 0);

        expect(pickAt(registry, 0, 0)).toBe(e);
        // Outside the quad, so a pass that answers with the only mesh present
        // would pass the line above and fail this one.
        expect(pickAt(registry, 400, 0)).toBe(NO_HIT);

        disposeWorld(world, registry);
    });

    it('takes the NEARER of two meshes stacked in depth', () => {
        const { world, registry } = createWorld();
        const far = mesh(world, 0, 0, -500);
        const near = mesh(world, 0, 0, -100);

        // Both are under the pointer; only depth separates them, and the far one
        // was created first — so an answer that ignored depth would return it.
        expect(pickAt(registry, 0, 0)).toBe(near);
        expect(far).not.toBe(near);

        // Cast the other way and the ranking has to invert.
        expect(pickRay(registry, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 1 })).toBe(far);

        disposeWorld(world, registry);
    });

    it('follows a perspective ray to where content actually stands', () => {
        const { world, registry } = createWorld();
        // 200 units to the right and 300 back. A pointer from the origin reaches
        // it only if the ray is followed to ITS plane; resolved at z = 0 — which
        // is every answer this pass could give before — it lands at x = 0.
        const e = mesh(world, 200, 0, -300, { half: 40 });

        const len = Math.hypot(200, 0, -300);
        expect(pickRay(registry, { x: 0, y: 0, z: 0 },
                       { x: 200 / len, y: 0, z: -300 / len })).toBe(e);
        // Straight down -Z from the origin misses it, so the hit above is the
        // ray's doing and not a box wide enough to catch anything.
        expect(pickAt(registry, 0, 0)).toBe(NO_HIT);

        disposeWorld(world, registry);
    });

    it('meets a sprite on the sprite\'s own plane, not on z = 0', () => {
        const { world, registry } = createWorld();
        // Same geometry as the mesh case, so what differs is only which pass
        // answers: a sprite resolves the ray against a plane, a mesh against a box.
        const e = sprite(world, 200, 0, { size: 80, z: -300 });

        const len = Math.hypot(200, 0, -300);
        expect(pickRay(registry, { x: 0, y: 0, z: 0 },
                       { x: 200 / len, y: 0, z: -300 / len })).toBe(e);
        expect(pickAt(registry, 0, 0)).toBe(NO_HIT);

        disposeWorld(world, registry);
    });

    it('lets a sprite in front of a mesh win, by depth alone', () => {
        const { world, registry } = createWorld();
        const behind = mesh(world, 0, 0, -200);
        const front = sprite(world, 0, 0, { size: 100 });

        expect(pickAt(registry, 0, 0)).toBe(front);
        // From behind, the mesh is the near one — so the line above is depth
        // deciding and not sprites simply outranking meshes.
        expect(pickRay(registry, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 1 })).toBe(behind);

        disposeWorld(world, registry);
    });
});
