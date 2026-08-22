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
import { Transform, Sprite } from '../src/ecs/component';
import { Interactable } from '../src/ui/input/interactable';
import type { Entity } from '../src/types';
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
        opts: { size?: number; layer?: number; raycastTarget?: boolean; scale?: number } = {},
    ): Entity {
        const e = world.spawn();
        const s = opts.size ?? 100;
        const k = opts.scale ?? 1;
        world.insert(e, Transform, { position: { x, y, z: 0 }, scale: { x: k, y: k, z: 1 } });
        world.insert(e, Sprite, { size: { x: s, y: s }, layer: opts.layer ?? 0 });
        world.insert(e, Interactable, { raycastTarget: opts.raycastTarget ?? true });
        return e;
    }

    let frame = 0;
    function pickAt(registry: CppRegistry, x: number, y: number): number {
        // transforms_updated is memoised per frame, so each pick needs its own.
        module.renderer_beginFrame(frame++);
        module.renderer_updateTransforms(registry as never);
        module.uiHitTest_update(registry as never, x, y, false, false, false);
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
});
