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
import { partitionWorld, type PartitionOptions } from '../src/residency/partitionWorld';
import { cutWorld } from '../src/residency/cutWorld';
import { StreamPlane } from '../src/residency/components';
import { desiredResidency, manifestPlane, planeSecond } from '../src/residency/cells';
import type { SceneData } from '../src/scene/scene';

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

const declaration: Component = { type: 'StreamedWorld', data: { cellSize: SIZE } };

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

    it('leaves references inside the persistent world alone', () => {
        // Two persistent roots are one document: a camera naming the player it
        // follows comes and goes with it, so nothing can dangle between them.
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Camera', [0, 0, 0], {
                components: [
                    { type: 'WorldPersistent', data: {} },
                    { type: 'ThirdPersonCamera', data: { target: 2 } },
                ],
            }),
            entity(2, 'Player', [10, 0, 10], { components: [{ type: 'WorldPersistent', data: {} }] }),
        ))!;
        expect(partition.errors).toEqual([]);
        expect(partition.persistentRefs).toEqual([]);
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
});

describe('a world cut on the screen plane', () => {
    const screen: Component = { type: 'StreamedWorld', data: { cellSize: SIZE, plane: StreamPlane.Screen } };
    const world = (): SceneData => scene(
        entity(0, 'World', null, { components: [screen] }),
        // A 2D scene lies at z 0 (or a layering depth): only x and y tell the places apart.
        entity(1, 'Near', [500, 500, 0]),
        entity(2, 'East', [1500, 500, 0]),
        entity(3, 'North', [500, 1500, 5]),
        entity(4, 'Far', [500, -1500, 9]),
    );

    it('cuts along x and y, so a scene at z 0 is a grid and not one row', () => {
        const partition = cut(world())!;
        expect(partition.plane).toBe('xy');
        expect(partition.cells.map((c) => [c.x, c.z]).sort()).toEqual([[0, -2], [0, 0], [0, 1], [1, 0]]);
        // The box covers world y, not z: the North entity at y 1500 is inside cell (0, 1).
        const north = partition.cells.find((c) => c.x === 0 && c.z === 1)!;
        expect(north.minZ).toBeLessThanOrEqual(1000);
        expect(north.maxZ).toBeGreaterThanOrEqual(1500);
    });

    it('still cuts the ground by x and z when the world does not say otherwise', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'A', [500, 500, 0]),
            entity(2, 'B', [500, 500, 1500]),
        ))!;
        expect(partition.plane).toBe('xz');
        expect(partition.cells.map((c) => [c.x, c.z])).toEqual([[0, 0], [0, 1]]);
    });

    it('writes the plane into the manifest only for a screen world, and an old manifest reads as the ground', () => {
        expect(cutWorld(world(), 'main', options)!.manifest.plane).toBe('xy');
        const ground = cutWorld(scene(entity(0, 'World', null, { components: [declaration] }), entity(1, 'A', [1, 1, 1])), 'main', options)!;
        expect(ground.manifest.plane).toBeUndefined();
        expect(manifestPlane(ground.manifest)).toBe('xz');
        expect(manifestPlane(null)).toBe('xz');
    });

    it('asks for the cells round a source by its y: a source walking up a 2D world brings in the cells above it', () => {
        const manifest = cutWorld(world(), 'main', options)!.manifest;
        const plane = manifestPlane(manifest);
        const at = { x: 500, y: 1400, z: 0 };
        const sources = [{ x: at.x, z: planeSecond(at, plane), loadRadius: 300, unloadRadius: 400, prefetchRadius: 300 }];
        const wanted = desiredResidency(manifest.cells, sources, new Set()).target;
        expect(wanted).toEqual(['main.cell_0_1']);
    });
});
