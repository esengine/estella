// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a streamed world remembers of a cell: the document it is brought back in with.
 */
import { describe, it, expect } from 'vitest';
import { RememberState, WorldMemory, type WorldMemoryData } from '../src/residency/worldMemory';
import { App } from '../src/app/app';
import { defineComponent, unregisterComponent } from '../src/ecs/component';
import { enableSceneOrigins, recordSceneOrigins } from '../src/scene/sceneOrigins';
import { loadSceneData } from '../src/scene/scene';
import type { SceneData } from '../src/scene/scene';
import type { WorldManifest } from '../src/residency/cells';

const cell = { name: 'w.cell_1_0', path: '', x: 1, z: 0, minX: 0, minZ: 0, maxX: 1, maxZ: 1, entityCount: 3, rootCount: 2 };
const manifest: WorldManifest = { version: 1, scene: 'w', cellSize: 100, persistentRefs: [], cells: [cell] };
const entity = (id: number, children: number[], components: Array<{ type: string; data: Record<string, unknown> }>, parent: number | null = null) =>
    ({ id, name: `e${id}`, parent, children, visible: true, components });
const document = (): SceneData => ({
    version: 4, name: 'w.cell_1_0', entities: [
        entity(1, [], [{ type: 'Transform', data: { position: { x: 1, y: 0, z: 0 } } }, { type: 'Health', data: { current: 100, max: 100 } }]),
        entity(2, [3], [{ type: 'Transform', data: {} }]),
        entity(3, [], [{ type: 'Transform', data: {} }], 2),
    ],
} as unknown as SceneData);

function remembered(entries: WorldMemoryData['entries'], world = 'w'): WorldMemory {
    const memory = new WorldMemory({} as never, () => manifest);
    memory.read({ version: 1, world, entries });
    return memory;
}

describe('a cell brought back from memory', () => {
    it('can reuse the authored hierarchy after clearing a remembered deletion', () => {
        const rows = document(), memory = remembered({ 'w.cell_1_0:3': { gone: true } });
        const parent = (scene: SceneData) => scene.entities.find(e => e.id === 2)!;
        expect(parent(memory.adapt(cell.name, rows)).children).toEqual([]);
        memory.clear();
        expect(parent(memory.adapt(cell.name, rows)).children).toEqual([3]);
    });

    it('keeps remembered data independent of imported saves, exported saves and loaded cells', () => {
        const key = 'w.cell_1_0:1', items = ['key'];
        const memory = remembered({ [key]: { components: [{ type: 'Bag', data: { items } }] } });
        const exportedItems = () => memory.toJSON().entries[key].components![0].data.items as string[];
        items.push('input');
        expect(exportedItems()).toEqual(['key']);
        exportedItems().push('output');
        const loadItems = () => memory.adapt(cell.name, document()).entities[0].components.find(c => c.type === 'Bag')!.data.items as string[];
        expect(loadItems()).toEqual(['key']);
        loadItems().push('cell');
        expect(exportedItems()).toEqual(['key']);
    });

    it('restores remembered target lists by authored id after the cell receives new entity handles', () => {
        const app = App.new(), w = app.world, memory = new WorldMemory(app, () => manifest);
        const type = 'RememberedTargetList', defaults = { targets: [] as number[], values: [] as number[] };
        const definition = defineComponent(type, defaults, { entityFields: ['targets'] });
        enableSceneOrigins(app);
        const rows = { ...document(), entities: [entity(1, [], []), entity(3, [], [])] };
        const actor = w.spawn(), target = w.spawn(), dynamic = w.spawn();
        memory.adapt(cell.name, rows);
        recordSceneOrigins(app, new Map([[1, actor], [3, target]]));
        const values = [target, dynamic, 0, target];
        w.insert(actor, RememberState, { keepTransform: false });
        w.insert(actor, definition, { targets: values, values });
        try {
            unregisterComponent(type);
            memory.despawned(actor);
            const saved = JSON.parse(JSON.stringify(memory.toJSON())) as WorldMemoryData;
            expect(saved.entries[cell.name + ':1'].components).toContainEqual({
                type, data: { targets: [3, 0, 0, 3], values },
            });
            const again = new WorldMemory(app, () => manifest);
            again.read(saved);
            w.despawn(actor);
            w.despawn(target);
            const restored = defineComponent(type, defaults, { entityFields: ['targets'] });
            const ids = loadSceneData(w, again.adapt(cell.name, rows));
            expect(ids.get(3)).not.toBe(target);
            expect(w.get(ids.get(1)!, restored)).toEqual({ targets: [ids.get(3), 0, 0, ids.get(3)], values });
        } finally { unregisterComponent(type); }
    });

    it('comes in as it was left, and without what was destroyed and everything under it', () => {
        const memory = remembered({
            'w.cell_1_0:1': { components: [{ type: 'Health', data: { current: 25, max: 100 } }, { type: 'Transform', data: { position: { x: 7, y: 0, z: 0 } } }] },
            'w.cell_1_0:2': { gone: true },
        });
        const out = memory.adapt('w.cell_1_0', document());
        expect(out.entities.map((e) => e.id)).toEqual([1]);
        const health = out.entities[0]!.components.find((c) => c.type === 'Health')!.data as { current: number };
        expect(health.current).toBe(25);
        expect((out.entities[0]!.components.find((c) => c.type === 'Transform')!.data as { position: { x: number } }).position.x).toBe(7);
        expect(memory.isGone('w.cell_1_0', 2)).toBe(true);
    });

    it('leaves another scene, and another world\'s save, alone', () => {
        const memory = remembered({ 'w.cell_1_0:2': { gone: true } });
        expect(memory.adapt('menu', document()).entities).toHaveLength(3);
        expect(remembered({ 'w.cell_1_0:2': { gone: true } }, 'other').adapt('w.cell_1_0', document()).entities).toHaveLength(3);
    });

    it('goes through a save as JSON and comes back the same', () => {
        const memory = remembered({ 'w.cell_1_0:2': { gone: true } });
        const again = new WorldMemory({} as never, () => manifest);
        again.read(JSON.parse(JSON.stringify(memory.toJSON())) as WorldMemoryData);
        expect(again.adapt('w.cell_1_0', document()).entities.map((e) => e.id)).toEqual([1]);
        expect(() => again.read({ version: 2 } as never)).toThrow();
    });
});
