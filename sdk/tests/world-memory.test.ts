// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a streamed world remembers of a cell: the document it is brought back in with.
 */
import { describe, it, expect } from 'vitest';
import { WorldMemory, type WorldMemoryData } from '../src/residency/worldMemory';
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
