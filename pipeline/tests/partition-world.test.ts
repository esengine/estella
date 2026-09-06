// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the cook does to one authored world, and what it refuses.
 *
 * The two claims that matter most are negative. A subtree cannot be split
 * across cells no matter where a child ends up in the world, because only
 * top-level entities are ever placed; and a hard reference that crosses a
 * residency boundary fails the build rather than shipping a handle that dangles
 * the first time a player walks away.
 */
import { describe, it, expect } from 'vitest';
import type { SceneData } from 'esengine';
import { partitionWorld, type PartitionOptions } from '../src/world/partitionWorld';

const SIZE = 1000;

type Component = { type: string; data: Record<string, unknown> };

function entity(
    id: number, name: string, at: [number, number, number] | null,
    extra: { parent?: number | null; components?: Component[] } = {},
): Record<string, unknown> {
    const components: Component[] = [...(extra.components ?? [])];
    if (at !== null) {
        components.unshift({ type: 'Transform', data: { position: { x: at[0], y: at[1], z: at[2] } } });
    }
    return { id, name, parent: extra.parent ?? null, children: [], visible: true, components };
}

const declaration: Component = { type: 'StreamedWorld', data: { cellSize: SIZE, enabled: true } };

function scene(...entities: Array<Record<string, unknown>>): SceneData {
    return { version: 4, name: 'main', entities } as unknown as SceneData;
}

const options: PartitionOptions = {
    entityFieldsOf: (type) => (type === 'ThirdPersonCamera' ? ['target'] : []),
};

const cut = (data: SceneData): ReturnType<typeof partitionWorld> =>
    partitionWorld(data, 'main', options);

const names = (document: SceneData): string[] =>
    (document.entities as unknown as Array<{ name: string }>).map((e) => e.name);

describe('partitionWorld', () => {
    it('leaves a scene that never declared itself streamed alone', () => {
        expect(cut(scene(entity(0, 'Ground', [0, 0, 0])))).toBeNull();
    });

    it('places top-level entities by their own position, and keeps the rest persistent', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'RockA', [500, 0, 500]),
            entity(3, 'RockB', [1500, 0, 500]),
            entity(4, 'Services', null),
        ))!;
        expect(partition.cellSize).toBe(SIZE);
        // A root with no Transform is not anywhere, so it stays with the world.
        expect(names(partition.persistent).sort()).toEqual(['Player', 'Services', 'World']);
        expect(partition.cells.map((c) => [c.x, c.z])).toEqual([[0, 0], [1, 0]]);
        expect(names(partition.cells[0].data)).toEqual(['RockA']);
        expect(names(partition.cells[1].data)).toEqual(['RockB']);
    });

    it('keeps a subtree whole even when a child stands in another cell', () => {
        // The lamp's world position is 1500, which is cell 1 — but residency is a
        // property of the root, so it goes where the house goes. Split by each
        // entity's own position, unloading the house would strand the lamp.
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'House', [500, 0, 500]),
            entity(2, 'Lamp', [1000, 0, 0], { parent: 1 }),
        ))!;
        expect(partition.cells).toHaveLength(1);
        expect(names(partition.cells[0].data)).toEqual(['House', 'Lamp']);
        // …and the box grows to cover it, so the cell is asked for from where its
        // content actually is rather than from the grid square it was cut on.
        expect(partition.cells[0].maxX).toBe(1500);
    });

    it('composes a child through its parent\'s rotation and scale', () => {
        const turned = entity(1, 'Rig', [0, 0, 0]);
        (turned.components as Component[])[0].data.rotation = { x: 0, y: 0.7071067811865476, z: 0, w: 0.7071067811865476 };
        (turned.components as Component[])[0].data.scale = { x: 2, y: 1, z: 1 };
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            turned,
            entity(2, 'Arm', [100, 0, 0], { parent: 1 }),
        ))!;
        // Scaled to 200 along local X, then a quarter turn about Y sends it to -Z.
        expect(partition.cells[0].minZ).toBeCloseTo(-200, 4);
    });

    it('refuses WorldPersistent on anything but a root', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'House', [500, 0, 500]),
            entity(2, 'Lamp', [0, 0, 0], { parent: 1, components: [{ type: 'WorldPersistent', data: {} }] }),
        ))!;
        expect(partition.errors.join('\n')).toContain('not top-level');
    });

    it('refuses a hard reference from one cell into another', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Watcher', [500, 0, 500], {
                components: [{ type: 'ThirdPersonCamera', data: { target: 2 } }],
            }),
            entity(2, 'Watched', [1500, 0, 500]),
        ))!;
        expect(partition.errors.join('\n')).toContain('residency may delete one without the other');
    });

    it('allows a cell to reference the persistent world, and records which rows', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
            entity(2, 'Turret', [1500, 0, 500], {
                components: [{ type: 'ThirdPersonCamera', data: { target: 1 } }],
            }),
        ))!;
        expect(partition.errors).toEqual([]);
        expect(partition.persistentRefs).toEqual([1]);
    });

    it('refuses a persistent entity holding a reference into a cell', () => {
        // The dangerous direction: the holder outlives what it points at.
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Camera', [0, 0, 0], {
                components: [
                    { type: 'WorldPersistent', data: {} },
                    { type: 'ThirdPersonCamera', data: { target: 2 } },
                ],
            }),
            entity(2, 'Prop', [1500, 0, 500]),
        ))!;
        expect(partition.errors.join('\n')).toContain('cell 1,0');
    });

    it('places a prefab instance by its override, and refuses one it cannot read', () => {
        const instance = {
            id: 1, name: 'Coin', parent: null, prefab: '@uuid:abc',
            overrides: [{
                prefabEntityId: '0', type: 'property', componentType: 'Transform',
                propertyName: 'position', value: { x: 2500, y: 0, z: 0 },
            }],
            added: [], removed: [],
        };
        const document = scene(entity(0, 'World', null, { components: [declaration] }), instance);
        const placed = partitionWorld(document, 'main', {
            ...options,
            resolvePrefab: () => ({ rootId: '0', position: { x: 0, y: 0, z: 0 } }),
        })!;
        expect(placed.errors).toEqual([]);
        expect(placed.cells.map((c) => c.x)).toEqual([2]);

        const unread = partitionWorld(document, 'main', options)!;
        expect(unread.errors.join('\n')).toContain('cannot read');
    });

    it('names a declaration with no usable cell size instead of shipping it whole', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [{ type: 'StreamedWorld', data: { cellSize: 0 } }] }),
        ))!;
        expect(partition.errors.join('\n')).toContain('no positive cellSize');
    });

    it('answers null for a world whose streaming is switched off', () => {
        expect(cut(scene(
            entity(0, 'World', null, { components: [{ type: 'StreamedWorld', data: { cellSize: SIZE, enabled: false } }] }),
            entity(1, 'RockA', [500, 0, 500]),
        ))).toBeNull();
    });
});
