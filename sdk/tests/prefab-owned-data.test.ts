// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, Transform } from '../src/ecs/component';
import { instantiatePrefab, type PrefabData, type PrefabOverride } from '../src/prefab';
import { flattenPrefab } from '../src/prefab/flatten';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

const Payload = defineComponent('PrefabOwnedPayload', { payload: { values: [0] }, target: 0 },
    { entityFields: ['target'] });
const source = (): PrefabData => ({ version: '2', name: 'owned', rootEntityId: 'root', entities: [
    { prefabEntityId: 'root', name: 'root', parent: null, children: ['child'], visible: true,
        components: [{ type: 'PrefabOwnedPayload', data: {} }] },
    { prefabEntityId: 'child', name: 'child', parent: 'root', children: [], visible: true,
        components: [{ type: 'Transform', data: {} }] },
] });

describe('flattened prefab owns all mutable override values', () => {
    it('isolates property and metadata objects across flatten calls and the caller', () => {
        const prefab = source();
        const payload = { values: [1, 2] };
        const marker = { values: ['source'] };
        const overrides: PrefabOverride[] = [
            { type: 'property', prefabEntityId: 'root', componentType: 'PrefabOwnedPayload', propertyName: 'payload', value: payload },
            { type: 'metadata_set', prefabEntityId: 'root', metadataKey: 'marker', value: marker },
        ];
        const flatten = () => { let next = 0; return flattenPrefab(prefab, overrides, { allocateId: () => next++, loadPrefab: () => null }); };
        const first = flatten(); const second = flatten();
        (first.entities[0].components[0].data.payload as typeof payload).values.push(9);
        (first.entities[0].metadata!.marker as typeof marker).values.push('changed');
        expect(second.entities[0].components[0].data.payload).toEqual({ values: [1, 2] });
        expect(second.entities[0].metadata!.marker).toEqual({ values: ['source'] });
        expect(payload.values).toEqual([1, 2]); expect(marker.values).toEqual(['source']);
    });
});

describe.skipIf(!HAS_WASM)('owned prefab records retain scene-loader behavior', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    it('remaps entity overrides, upgrades added legacy components and preserves source data', async () => {
        const world = new World(); world.connectCpp(new engine.Registry() as unknown as CppRegistry, engine);
        const prefab = source(); const payload = { values: [3, 4] };
        const overrides: PrefabOverride[] = [
            { type: 'property', prefabEntityId: 'root', componentType: Payload._name, propertyName: 'target', value: 'child' },
            { type: 'property', prefabEntityId: 'root', componentType: Payload._name, propertyName: 'payload', value: payload },
            { type: 'component_added', prefabEntityId: 'root', componentData: { type: 'LocalTransform', data: { position: { x: 7, y: 8, z: 0 } } } },
        ];
        const original = JSON.stringify({ prefab, overrides });
        try {
            const first = await instantiatePrefab(world, prefab, { overrides });
            const second = await instantiatePrefab(world, prefab, { overrides });
            // The child is the entity besides the root; the map's keys are the loader's own numbering, not the prefab's.
            const childOf = (placed: { root: number; entities: Map<number, number> }) => [...placed.entities.values()].find((e) => e !== placed.root);
            expect(world.get(first.root, Payload).target).toBe(childOf(first));
            expect(world.get(second.root, Payload).target).toBe(childOf(second));
            expect(world.get(first.root, Transform).position.x).toBe(7);
            world.update(first.root, Payload, data => { data.payload.values.push(12); });
            expect(world.get(second.root, Payload).payload.values).toEqual([3, 4]);
            expect(JSON.stringify({ prefab, overrides })).toBe(original);
        } finally { for (const e of world.getAllEntities()) if (world.valid(e)) world.despawn(e); }
    });
});
