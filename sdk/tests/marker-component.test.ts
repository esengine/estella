// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The `Marker` gameplay component — a named point/region of interest placed as a
 *        real entity (spawn point / waypoint / trigger identity). It's a pure-TS
 *        `defineComponent`, so it must serialize into the scene, round-trip its `type`
 *        field, and be query-able like any component — the object-authoring foundation.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/world';
import { Transform, Marker, markEngineComponentBaseline, seedEngineComponents } from '../src/component';
import { serializeScene } from '../src/scene';
import { createMockModule } from './mocks/wasm';

// Snapshot the module-level engine components (incl. Marker) as the baseline — the SDK
// entry does this at app start so they survive into every app context. A test World
// activates its own context, so re-seed the baseline into it (else getComponentTypes'
// registry match, which serializeScene relies on, can't resolve Marker's script id).
markEngineComponentBaseline();

function makeWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod as never);
    seedEngineComponents();
    return world;
}

describe('Marker component', () => {
    it('is a registered component with `type` + `properties` defaults', () => {
        expect(Marker._name).toBe('Marker');
        expect(Marker._default).toEqual({ type: '', properties: {} });
    });

    it('serializes into the scene and round-trips `type` + `properties`', () => {
        const world = makeWorld();
        const e = world.spawn('SpawnPoint');
        world.insert(e, Transform, { position: { x: 3, y: 4, z: 0 } });
        world.insert(e, Marker, { type: 'player-spawn', properties: { team: 'red', delay: '2' } });

        const scene = serializeScene(world, 'test');
        const ent = scene.entities.find((n) => n.name === 'SpawnPoint')!;
        const marker = ent.components.find((c) => c.type === 'Marker');
        expect(marker).toBeTruthy();
        expect((marker!.data as { type: string }).type).toBe('player-spawn');
        expect((marker!.data as { properties: Record<string, string> }).properties).toEqual({ team: 'red', delay: '2' });
    });

    it('is query-able by its component id (distinct entities found)', () => {
        const world = makeWorld();
        const a = world.spawn('A');
        world.insert(a, Marker, { type: 'door', properties: {} });
        const b = world.spawn('B');
        world.insert(b, Marker, { type: 'pickup', properties: {} });
        world.spawn('C'); // no marker

        const found = world.getEntitiesWithComponents([Marker]);
        expect(found).toContain(a);
        expect(found).toContain(b);
        expect(found.length).toBe(2);
    });
});
