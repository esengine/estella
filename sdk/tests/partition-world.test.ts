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
import { cutWorld, resolvePrefabRoots } from '../src/residency/cutWorld';
import { farProxySettings } from '../src/residency/farProxy';
import { RuntimeConfig } from '../src/defaults';
import { StreamPlane } from '../src/residency/components';
import { desiredResidency, manifestPlane, planeSecond } from '../src/residency/cells';
import { loadSceneData, type SceneData } from '../src/scene/scene';
import { validateScene } from '../src/scene/validateScene';
import { Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

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

it('resolves repeated and inherited prefab roots from one read per document and isolates missing roots', async () => {
    const refs = ['variant-a', 'unavailable', 'variant-b', 'variant-a', 'base'];
    const data = scene(entity(0, 'World', null, { components: [declaration] }),
        ...refs.map((prefab, index) => ({ id: index + 1, prefab, parent: null, overrides: [] })));
    const reads: string[] = [];
    const resolvePrefab = await resolvePrefabRoots(data, async ref => {
        reads.push(ref);
        if (ref === 'unavailable') throw new Error('asset missing');
        if (ref === 'base') return {
            rootEntityId: 'r', entities: [{ prefabEntityId: 'r', ...entity(0, 'Base', [500, 0, 500]) }],
        };
        return {
            rootEntityId: 'r', basePrefab: 'base', entities: [],
            overrides: [{ type: 'property', prefabEntityId: 'r', componentType: 'Transform',
                propertyName: 'position', value: { x: ref === 'variant-a' ? 1500 : 2500, y: 0, z: 500 } }],
        };
    });
    expect(reads.sort()).toEqual(['base', 'unavailable', 'variant-a', 'variant-b']);
    expect(refs.map(ref => resolvePrefab(ref)?.position.x ?? null)).toEqual([1500, null, 2500, 1500, 500]);
    const partition = cutWorld(data, 'main', { ...options, resolvePrefab })!;
    expect(partition.manifest.cells.map(({ x, rootCount }) => [x, rootCount])).toEqual([[0, 2], [1, 2], [2, 1]]);
    expect(partition.errors).toHaveLength(1);
    expect(partition.errors[0]).toContain('(unavailable)');
});

it('overlaps prefab reads within the asset preload limit', async () => {
    const limit = RuntimeConfig.preloadConcurrency;
    const refs = Array.from({ length: limit + 3 }, (_, index) => `prefab-${index}`);
    const data = scene(...refs.map((prefab, index) => ({ id: index + 1, prefab, overrides: [] })));
    let active = 0;
    let peak = 0;
    const resolvePrefab = await resolvePrefabRoots(data, async ref => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return { rootEntityId: ref, entities: [{ prefabEntityId: ref, components: [] }] };
    });
    expect(peak).toBe(limit);
    expect(refs.map(ref => resolvePrefab(ref)?.rootId)).toEqual(refs);
});

describe('partitionWorld', () => {
    it('leaves a scene that never declared itself streamed alone', () => {
        expect(cut(scene(entity(0, 'Ground', [0, 0, 0])))).toBeNull();
    });

    it('refuses competing streamed-world declarations before producing any cells', () => {
        const competing = { type: 'StreamedWorld', data: { cellSize: 250, plane: StreamPlane.Screen } };
        const first = entity(1, 'Ground settings', null, { components: [declaration] });
        const second = entity(2, 'Screen settings', null, { components: [competing] });
        const prop = entity(3, 'Prop', [1500, 500, 500]);
        for (const declarations of [[first, second], [second, first]]) {
            const partition = cut(scene(...declarations, prop))!;
            expect(partition.errors.join('\n')).toMatch(/only one StreamedWorld/);
            expect(partition.errors.join('\n')).toContain('Ground settings');
            expect(partition.errors.join('\n')).toContain('Screen settings');
            expect(partition.cells).toEqual([]);
        }
        const duplicate = cut(scene(entity(1, 'World settings', null, { components: [declaration, competing] }), prop))!;
        expect(duplicate.errors.join('\n')).toMatch(/only one StreamedWorld.*World settings/);
        expect(duplicate.cells).toEqual([]);
    });

    it('uses the effective StreamedWorld component added to a prefab instance root', () => {
        const add = { prefabEntityId: 'r', type: 'component_added', componentData: {
            type: 'StreamedWorld', data: { cellSize: 100, plane: StreamPlane.Screen, farProxies: true },
        } };
        const resize = { prefabEntityId: 'r', type: 'property', componentType: 'StreamedWorld', propertyName: 'cellSize', value: 200 };
        const settings = { id: 1, name: 'Settings', prefab: 'settings.esprefab', parent: null, added: [], removed: [], overrides: [add, resize] };
        const prop = entity(2, 'Sprite', [250, 450, 0]);
        const opts = { ...options, resolvePrefab: () => ({ rootId: 'r', position: { x: 700, y: 0, z: 0 } }) };
        const document = scene(settings, prop);
        const partition = partitionWorld(document, 'main', opts)!;
        expect(partition.errors).toEqual([]);
        expect(partition.cellSize).toBe(200);
        expect(partition.plane).toBe('xy');
        expect(partition.cells.map(cell => cell.name)).toEqual(['main.cell_1_2']);
        expect(names(partition.persistent)).toEqual(['Settings']);
        expect(farProxySettings(document)?.farDistance).toBe(8000);

        const child = { ...settings, overrides: [{ ...add, prefabEntityId: 'child' }] };
        expect(partitionWorld(scene(child, prop), 'main', opts)?.errors.join('\n')).toMatch(/StreamedWorld.*prefab root/);
        const removed = { ...settings, overrides: [...settings.overrides,
            { prefabEntityId: 'r', type: 'component_removed', componentType: 'StreamedWorld' }] };
        expect(partitionWorld(scene(removed, prop), 'main', opts)).toBeNull();
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

    it.each([StreamPlane.Screen, StreamPlane.Ground])('rebuilds child lists from authored parents for plane %s', plane => {
        const data = scene(
            { ...entity(0, 'World', null, { components: [{ ...declaration, data: { cellSize: SIZE, plane } }] }), children: [1] },
            { ...entity(1, 'Root', [100, 100, 100]), children: [4, 2] },
            entity(3, 'First child', [0, 0, 0], { parent: 1 }),
            entity(2, 'Second child', [0, 0, 0], { parent: 1 }),
            entity(4, 'Other root', [1500, 1500, 1500]),
        );
        const snapshot = JSON.stringify(data);
        const partition = cut(data)!;
        expect(partition.persistent.entities[0].children).toEqual([]);
        expect(partition.cells.map(cell => cell.data.entities.map(row => row.id))).toEqual([[1, 3, 2], [4]]);
        expect(partition.cells[0].data.entities[0].children).toEqual([3, 2]);
        expect([partition.persistent, ...partition.cells.map(cell => cell.data)].flatMap(validateScene)).toEqual([]);
        expect(JSON.stringify(data)).toBe(snapshot);
    });

    it('keeps embedded texture importer settings in the persistent scene and each cell', () => {
        const data = scene(entity(0, 'World', null, { components: [declaration] }), entity(1, 'Sprite', [500, 0, 500]));
        data.textureImporterSettings = { 'assets/art.png': { sRGB: false, maxSize: 128 } };
        const partition = cut(data)!;
        expect(partition.persistent.textureImporterSettings).toEqual(data.textureImporterSettings);
        expect(partition.cells[0].data.textureImporterSettings).toEqual(data.textureImporterSettings);
    });

    it('keeps authored order within each document when parents and cells are interleaved', () => {
        const data = scene(
            entity(14, 'Shop sign', [0, 2, 0], { parent: 4 }),
            entity(0, 'World', null, { components: [declaration] }),
            entity(3, 'Tree', [50, 0, 50]),
            entity(4, 'Shop', [1500, 0, 500]),
            entity(21, 'Services', null),
            entity(1, 'Well', [60, 0, 60]),
            entity(30, 'Tree branch', [0, 2, 0], { parent: 3 }),
            entity(11, 'Counter', [1, 0, 0], { parent: 4 }),
        );
        const partition = cut(data)!;
        expect(partition.errors).toEqual([]);
        expect(names(partition.persistent)).toEqual(['World', 'Services']);
        expect(partition.cells.map(cell => ({ roots: cell.rootCount, names: names(cell.data) }))).toEqual([
            { roots: 2, names: ['Tree', 'Well', 'Tree branch'] },
            { roots: 1, names: ['Shop sign', 'Shop', 'Counter'] },
        ]);
    });

    it('reports entities stuck behind a cyclic parent chain', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'A', [0, 0, 0], { parent: 2 }),
            entity(2, 'B', [0, 0, 0], { parent: 1 }),
            entity(3, 'Below the cycle', null, { parent: 2 }),
        ))!;
        expect(partition.errors.join('\n')).toMatch(/3 entities.*parent cycle.*1/);
    });

    it('rejects duplicate ids before building a hierarchy', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'First', [0, 0, 0]),
            entity(1, 'Duplicate', [1500, 0, 0]),
        ))!;
        expect(partition.errors.join('\n')).toMatch(/duplicate entity id 1/i);
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

    it.each([
        { plane: StreamPlane.Screen, axis: 'y' as const, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } },
        { plane: StreamPlane.Ground, axis: 'z' as const, rotation: { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } },
    ])('matches the composed runtime bounds in the $axis axis', async ({ plane, axis, rotation }) => {
        const root = entity(1, 'Scaled root', [100, 100, 100]);
        root.children = [2];
        (root.components as Component[])[0].data.scale = { x: 1, y: 3, z: 3 };
        const middle = entity(2, 'Rotated pivot', [0, 0, 0], { parent: 1 });
        middle.children = [3];
        (middle.components as Component[])[0].data.rotation = rotation;
        const document = scene(
            entity(0, 'World', null, { components: [{ ...declaration, data: { cellSize: SIZE, plane } }] }),
            root, middle, { ...entity(3, 'Folder', null, { parent: 2 }), children: [4] },
            entity(4, 'Leaf', [450, 0, 0], { parent: 3 }),
        );

        const bounds = cut(document)!.cells[0];
        expect(bounds.maxZ).toBeCloseTo(1450, 4);
        if (HAS_WASM) {
            ensureBuiltinComponentsRegistered();
            const module = await loadWasmModule();
            const registry = new module.Registry();
            const world = new World();
            world.connectCpp(registry, module);
            try {
                const ids = loadSceneData(world, document);
                world.ensureTransformsComposed();
                expect(bounds.maxZ).toBeCloseTo(world.get(ids.get(4)!, Transform).worldPosition[axis], 2);
            } finally { world.disconnectCpp(); registry.delete(); }
        }
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

    it('allows references across subtrees in one cell but rejects references into another cell', () => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            entity(1, 'Watcher', [500, 0, 500], {
                components: [{ type: 'ThirdPersonCamera', data: { target: 2 } }],
            }),
            entity(2, 'Nearby', [750, 0, 500]),
            entity(3, 'Distant', [1500, 0, 500]),
            entity(4, 'Other Watcher', [600, 0, 500], {
                components: [{ type: 'ThirdPersonCamera', data: { target: 3 } }],
            }),
        ))!;
        expect(partition.errors).toEqual([expect.stringMatching(/entity 3 .*residency may delete one without the other/)]);
        expect(partition.persistentRefs).toEqual([]);
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

    it.each(['component_added', 'component_replaced', 'added member'])(
        'checks scene links in prefab %s data, ignoring local ids and the empty reference', kind => {
            const makeInstance = (target: number) => {
                const component = { type: 'MeshSkin', data: { joints: ['2', 0, target, -1] } };
                return {
                    id: 1, prefab: 'rig.esprefab', parent: null, removed: [],
                    overrides: kind === 'added member' ? [] : [{ prefabEntityId: 'root', type: kind, componentData: component }],
                    added: kind === 'added member' ? [{ prefabEntityId: 'new', components: [component] }] : [],
                };
            };
            // A legacy scene can have entity zero in a different cell. The
            // sentinel in the joint list still denotes an empty field.
            const declarationAndTargets = [
                entity(9, 'World', null, { components: [declaration] }),
                entity(0, 'Legacy', [2500, 0, 500]),
                entity(2, 'Persistent joint', null),
            ];
            const opts: PartitionOptions = {
                entityFieldsOf: type => type === 'MeshSkin' ? ['joints'] : [],
                resolvePrefab: () => ({ rootId: 'root', position: { x: 500, y: 0, z: 500 } }),
            };
            const valid = partitionWorld(scene(...declarationAndTargets, makeInstance(2)), 'main', opts)!;
            expect(valid.errors).toEqual([]);
            expect(valid.persistentRefs).toEqual([2]);
            const invalid = partitionWorld(scene(...declarationAndTargets, makeInstance(3),
                entity(3, 'Other cell', [3500, 0, 500])), 'main', opts)!;
            expect(invalid.errors.join('\n')).toMatch(/MeshSkin\.joints.*entity 3.*cell 3,0/);
        },
    );

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

    it('uses the last root position override in authored order', () => {
        const position = (x: number) => ({ prefabEntityId: 'root', type: 'property',
            componentType: 'Transform', propertyName: 'position', value: { x, y: 0, z: 0 } });
        const document = scene(entity(0, 'World', null, { components: [declaration] }), {
            id: 1, name: 'Instance', parent: null, prefab: 'prefab', overrides: [position(1500), position(2500)],
        });
        const partition = partitionWorld(document, 'main', {
            ...options, resolvePrefab: () => ({ rootId: 'root', position: { x: 0, y: 0, z: 0 } }),
        })!;
        expect(partition.cells.map(cell => cell.name)).toEqual(['main.cell_2_0']);
    });

    it.each([StreamPlane.Screen, StreamPlane.Ground])('uses the effective prefab root persistence on plane %s', async plane => {
        const marker = { type: 'WorldPersistent', data: {} };
        const add = { type: 'component_added', prefabEntityId: 'r', componentData: marker };
        const remove = { type: 'component_removed', prefabEntityId: 'r', componentType: marker.type };
        const instance = (id: number, prefab: string, overrides: Array<Record<string, unknown>> = [], parent: number | null = null) =>
            ({ id, name: `Instance ${id}`, prefab, overrides, parent, added: [], removed: [] });
        const document = scene(
            entity(0, 'World', null, { components: [{ type: 'StreamedWorld', data: { cellSize: SIZE, plane } }] }),
            instance(1, 'variant'),
            instance(2, 'variant', [remove]),
            instance(3, 'base', [add]),
            instance(4, 'base', [{ ...add, prefabEntityId: 'child' }]),
            instance(5, 'base', [add, remove]),
            instance(6, 'base', [{ ...add, type: 'component_replaced' }]),
            entity(7, 'Camera', [2500, 0, 0], { components: [{ type: 'ThirdPersonCamera', data: { target: 3 } }] }),
        );
        const resolvePrefab = await resolvePrefabRoots(document, async ref => ref === 'variant'
            ? { rootEntityId: 'r', basePrefab: 'base', overrides: [add], entities: [] }
            : { rootEntityId: 'r', entities: [
                { prefabEntityId: 'r', ...entity(0, 'Root', [1500, 0, 0]), children: ['child'] },
                { prefabEntityId: 'child', ...entity(1, 'Child', null), parent: 'r' },
            ] });
        const result = partitionWorld(document, 'main', { ...options, resolvePrefab })!;
        expect(result.errors).toEqual([]);
        expect(names(result.persistent)).toEqual(['World', 'Instance 1', 'Instance 3', 'Instance 6']);
        expect(result.cells.map(cell => names(cell.data))).toEqual([['Instance 2', 'Instance 4', 'Instance 5'], ['Camera']]);
        expect(result.persistentRefs).toEqual([3]);

        document.entities.push(instance(8, 'variant', [], 7) as unknown as SceneData['entities'][number]);
        const nested = partitionWorld(document, 'main', { ...options, resolvePrefab })!;
        expect(nested.errors).toEqual([expect.stringMatching(/entity 8 .*WorldPersistent but is not top-level/)]);
    });

    it.each([0, -1, Infinity, NaN])('reports an unusable cell size (%s) before placing any cells', cellSize => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [{ type: 'StreamedWorld', data: { cellSize } }] }),
            entity(1, 'Rock', [500, 0, 500]),
        ))!;
        expect(partition.errors.join('\n')).toContain('cellSize');
        expect(partition.cells).toEqual([]);
    });

    it.each([
        { plane: StreamPlane.Ground, invalid: [0, 0, Infinity], valid: [10, 0, 10] },
        { plane: StreamPlane.Screen, invalid: [0, Number.MAX_VALUE, 0], valid: [10, 10, 0] },
    ] as const)('diagnoses a root outside the representable grid on plane $plane', ({ plane, invalid, valid }) => {
        const partition = cut(scene(
            entity(0, 'World', null, { components: [{ ...declaration, data: { cellSize: SIZE, plane } }] }),
            entity(1, 'Invalid', [...invalid]),
            entity(2, 'Valid', [...valid]),
        ))!;
        expect(partition.errors.join('\n')).toMatch(/entity 1 .*outside the representable cell grid/);
        expect(partition.cells.map(cell => names(cell.data))).toEqual([['Valid']]);
    });

    it('diagnoses non-finite bounds after composing a streamed child transform', () => {
        const root = entity(1, 'Root', null, { components: [{ type: 'Transform',
            data: { position: { x: 10, y: 0, z: 10 }, scale: { x: Number.MAX_VALUE, y: 1, z: 1 } },
        }] });
        const partition = cut(scene(
            entity(0, 'World', null, { components: [declaration] }),
            root,
            entity(2, 'Oversized child', [2, 0, 0], { parent: 1 }),
        ))!;
        expect(partition.errors.join('\n')).toMatch(/cell \(0, 0\).*non-finite bounds/);
        expect(partition.cells).toEqual([]);
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
