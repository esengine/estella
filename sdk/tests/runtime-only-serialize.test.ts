// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RuntimeOnly entities are world-only projections a system re-derives
 *        from source data (Tilemap source layers, tile colliders). Scene
 *        serialization must skip them entirely — persisting one would
 *        duplicate it against the next derivation (e.g. the editor's
 *        play-stop world restore would double every Tiled layer).
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, RuntimeOnly, Name, Parent } from '../src/ecs/component';
import { serializeScene } from '../src/scene/scene';
import { createMockModule } from './mocks/wasm';

// Builtin components are C++-memory-backed; the mock module gives them a home
// (a bare World stores nothing for them).
function makeWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod as never);
    return world;
}

describe('serializeScene × RuntimeOnly', () => {
    it('skips tagged entities and their parent/children listings', () => {
        const world = makeWorld();
        const owner = world.spawn('Map');
        world.insert(owner, Transform, { position: { x: 1, y: 2, z: 0 } });

        const derived = world.spawn('TiledLayer_0');
        world.insert(derived, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(derived, RuntimeOnly, {});
        // The JS test backend has no C++ hierarchy; insert the Parent component
        // serializeScene reads (what registry.setParent maintains on wasm).
        world.insert(derived, Parent, { entity: owner });

        const scene = serializeScene(world, 'test');
        const names = scene.entities.map((e) => e.name);
        expect(names).toContain('Map');
        expect(names).not.toContain('TiledLayer_0');

        const ownerData = scene.entities.find((e) => e.name === 'Map')!;
        expect(ownerData.children).toEqual([]);
    });

    it('keeps untagged children intact', () => {
        const world = makeWorld();
        const parent = world.spawn('P');
        world.insert(parent, Transform, { position: { x: 0, y: 0, z: 0 } });
        const child = world.spawn('C');
        world.insert(child, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(child, Parent, { entity: parent });

        const scene = serializeScene(world, 'test');
        const p = scene.entities.find((e) => e.name === 'P')!;
        const c = scene.entities.find((e) => e.name === 'C')!;
        expect(p.children).toContain(c.id);
        expect(c.parent).toBe(p.id);
    });

    it('RuntimeOnly itself never round-trips as a component', () => {
        const world = makeWorld();
        const e = world.spawn('X');
        world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 } });
        world.insert(e, Name, { value: 'X' });

        const scene = serializeScene(world, 'test');
        for (const ent of scene.entities) {
            expect(ent.components.map((c) => c.type)).not.toContain('RuntimeOnly');
        }
    });
});
