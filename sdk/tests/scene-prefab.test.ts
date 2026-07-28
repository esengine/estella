// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Runtime prefab-instance scene loading (REARCH_PREFABS PF1 — play == ship).
 *
 * A saved scene may carry prefab-instance entries — a minimal delta over a
 * `.esprefab` asset (`{ prefab, overrides, added, removed }`). The runtime
 * loader expands them into ordinary entities via the SAME flattenPrefab core
 * the editor uses, so a prefab scene loads identically in the editor and at
 * runtime. This pins:
 *   - the delta round-trip `collapse(expand) === delta` (the data-loss net),
 *   - `expandScenePrefabs` (scene → plain scene), and
 *   - `loadSceneWithAssets` actually spawning the expanded instance into a World.
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import { defineBuiltin, defineComponent } from '../src/ecs/component';
import { INVALID_ENTITY } from '../src/types';
import {
    loadSceneData,
    loadSceneWithAssets,
    expandScenePrefabs,
    sceneHasPrefabEntries,
    type SceneData,
} from '../src/scene/scene';
import {
    migratePrefabData,
    flattenPrefab,
    expandInstance,
    collapseInstance,
    expandEntry,
    collapseEntry,
    extractPrefab,
    collectExternalEntityRefs,
    type PrefabData,
    type PrefabInstanceDelta,
    type PrefabInstanceEntry,
    type ExtractEntity,
    type ProcessedEntity,
} from '../src/prefab/index';

defineBuiltin('Transform', {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
});
defineBuiltin('Sprite', {
    texture: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
});

const REF = '@uuid:turret-0000';

function turretPrefab(): PrefabData {
    return migratePrefabData({
        version: '1.0',
        name: 'Turret',
        rootEntityId: 'root',
        entities: [
            {
                prefabEntityId: 'root',
                name: 'Turret',
                parent: null,
                children: ['barrel', 'scope'],
                components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
                visible: true,
            },
            {
                prefabEntityId: 'barrel',
                name: 'Barrel',
                parent: 'root',
                children: [],
                components: [{ type: 'Sprite', data: { color: { r: 1, g: 1, b: 1, a: 1 } } }],
                visible: true,
            },
            {
                prefabEntityId: 'scope',
                name: 'Scope',
                parent: 'root',
                children: [],
                components: [],
                visible: true,
            },
        ],
    }).data as PrefabData;
}

/** A minimal Assets stub: no real asset I/O, just a prefab resolver. */
function mockAssets(prefabs: Record<string, PrefabData | null>) {
    return {
        preloadSceneAssets: vi.fn().mockResolvedValue({
            textureHandles: new Map(),
            materialHandles: new Map(),
            fontHandles: new Map(),
            missing: [],
            releaseCallbacks: [],
        }),
        resolveSceneAssetPaths: vi.fn(),
        loadPrefab: vi.fn(async (ref: string) => ({ data: prefabs[ref] ?? null })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe('Prefab scene loading (PF1)', () => {
    // ── The delta round-trip safety net (same invariant the editor pins, now
    //    anchored on the SDK core both sides share). ──
    it('round-trips overrides + added + removed (collapse∘expand = identity)', () => {
        const prefab = turretPrefab();
        const delta: PrefabInstanceDelta = {
            prefab: REF,
            overrides: [
                { prefabEntityId: 'root', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: 5, y: 0, z: 0 } },
                { prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' },
                { prefabEntityId: 'barrel', type: 'visibility', value: false },
            ],
            added: [
                { prefabEntityId: 'addon1', name: 'Muzzle', components: [{ type: 'Sprite', data: { color: { r: 0, g: 1, b: 0, a: 1 } } }], visible: true, parentId: 'root' },
            ],
            removed: ['scope'],
        };

        let nid = 0;
        const { entities } = expandInstance(prefab, delta, () => nid++);
        const back = collapseInstance(prefab, REF, entities);

        expect(back.prefab).toBe(REF);
        expect(back.removed.sort()).toEqual(['scope']);
        expect(back.added).toHaveLength(1);
        expect(back.added[0].prefabEntityId).toBe('addon1');
        expect(back.added[0].parentId).toBe('root');
        expect(back.overrides.find((o) => o.type === 'property' && o.prefabEntityId === 'root')?.value).toEqual({ x: 5, y: 0, z: 0 });
        expect(back.overrides.find((o) => o.type === 'name' && o.prefabEntityId === 'barrel')?.value).toBe('BigBarrel');
        expect(back.overrides.find((o) => o.type === 'visibility' && o.prefabEntityId === 'barrel')?.value).toBe(false);
    });

    it('a scene entry round-trips through expandEntry → collapseEntry (root id + parent preserved)', () => {
        const prefab = turretPrefab();
        const entry: PrefabInstanceEntry = {
            id: 100,
            parent: 7,
            prefab: REF,
            overrides: [{ prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' }],
            added: [],
            removed: ['scope'],
        };
        let nid = 200;
        const { entities, rootId } = expandEntry(prefab, entry, () => nid++);
        const back = collapseEntry(prefab, REF, entities, rootId, entry.parent);
        expect(back.id).toBe(100);
        expect(back.parent).toBe(7);
        expect(back.removed.sort()).toEqual(['scope']);
        expect(back.overrides.find((o) => o.type === 'name')?.value).toBe('BigBarrel');
    });

    // ── expandScenePrefabs: scene file (with a prefab entry) → plain scene. ──
    it('expands a prefab-instance entry into ordinary entities, pinning the root id', async () => {
        const prefab = turretPrefab();
        const scene = {
            version: '1.0',
            name: 's',
            entities: [
                { id: 1, name: 'Ground', parent: null, children: [], components: [], visible: true },
                { id: 2, prefab: REF, parent: 1, overrides: [{ prefabEntityId: 'root', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: 5, y: 0, z: 0 } }], added: [], removed: ['scope'] },
            ],
        } as unknown as SceneData;

        expect(sceneHasPrefabEntries(scene)).toBe(true);
        const out = await expandScenePrefabs(scene, async (ref) => (ref === REF ? prefab : null));

        // Ground + (root + barrel); scope removed; no prefab entries remain.
        expect(out.entities).toHaveLength(3);
        expect(sceneHasPrefabEntries(out)).toBe(false);
        const root = out.entities.find((e) => e.id === 2)!; // pinned to the entry id
        expect(root.name).toBe('Turret');
        expect(root.parent).toBe(1); // attached under Ground
        // The position override is baked into the expanded root's Transform.
        const transform = root.components.find((c) => c.type === 'Transform')!;
        expect((transform.data.position as { x: number }).x).toBe(5);
        // No expanded internal id collides with the file ids (1, 2).
        const barrel = out.entities.find((e) => e.name === 'Barrel')!;
        expect(barrel.id).toBeGreaterThan(2);
        expect(barrel.parent).toBe(2);
    });

    it('drops an instance whose prefab cannot be resolved (no throw)', async () => {
        const scene = {
            version: '1.0',
            name: 's',
            entities: [
                { id: 1, name: 'Ground', parent: null, children: [], components: [], visible: true },
                { id: 2, prefab: '@uuid:missing', parent: null, overrides: [], added: [], removed: [] },
            ],
        } as unknown as SceneData;
        const out = await expandScenePrefabs(scene, async () => null);
        expect(out.entities.map((e) => e.name)).toEqual(['Ground']);
    });

    it('passes a scene with no prefab instances through unchanged', async () => {
        const scene: SceneData = {
            version: '1.0',
            name: 's',
            entities: [{ id: 1, name: 'A', parent: null, children: [], components: [{ type: 'Transform', data: {} }], visible: true }],
        };
        expect(sceneHasPrefabEntries(scene)).toBe(false);
        const out = await expandScenePrefabs(scene, async () => null);
        expect(out.entities).toHaveLength(1);
        expect(out.entities[0].name).toBe('A');
    });

    // ── loadSceneWithAssets: the play == ship path — a prefab scene spawns into
    //    a real World via the same expansion. ──
    it('loadSceneWithAssets spawns the expanded prefab instance into the World', async () => {
        createMockModule();
        const world = new World();
        const prefab = turretPrefab();
        const scene = {
            version: '1.0',
            name: 's',
            entities: [
                { id: 1, name: 'Ground', parent: null, children: [], components: [{ type: 'Transform', data: {} }], visible: true },
                { id: 2, prefab: REF, parent: null, overrides: [{ prefabEntityId: 'barrel', type: 'name', value: 'BigBarrel' }], added: [], removed: ['scope'] },
            ],
        } as unknown as SceneData;

        const assets = mockAssets({ [REF]: prefab });
        await loadSceneWithAssets(world, scene, { assets });

        expect(assets.loadPrefab).toHaveBeenCalledWith(REF);
        // Ground + Turret (root) + BigBarrel (barrel); scope removed.
        expect(world.findEntityByName('Ground')).not.toBeNull();
        expect(world.findEntityByName('Turret')).not.toBeNull();
        expect(world.findEntityByName('BigBarrel')).not.toBeNull(); // name override applied
        expect(world.findEntityByName('Scope')).toBeNull(); // removed
    });

    // ── extractPrefab: live subtree → a new prefab asset (the authoring path). ──
    it('extractPrefab builds a PrefabData from a subtree (root first, minted ids, detached, deep-cloned)', () => {
        const subtree: ExtractEntity[] = [
            { id: 10, name: 'Turret', parent: 5 /* external scene parent */, children: [11, 12], components: [{ type: 'Transform', data: { position: { x: 3, y: 4, z: 0 } } }], visible: true },
            { id: 11, name: 'Barrel', parent: 10, children: [], components: [{ type: 'Sprite', data: {} }], visible: true },
            { id: 12, name: 'Scope', parent: 10, children: [], components: [], visible: false },
        ];
        // Inject a deterministic id generator so the test can pin identity; the
        // editor uses the default (crypto.randomUUID) for globally-unique ids.
        let n = 0;
        const prefab = extractPrefab(subtree, 10, 'Turret', () => String(n++));

        expect(prefab.name).toBe('Turret');
        expect(prefab.rootEntityId).toBe('0');
        const root = prefab.entities[0];
        expect(root.prefabEntityId).toBe('0');
        expect(root.name).toBe('Turret');
        expect(root.parent).toBeNull(); // detached from the scene parent (5)
        expect(root.children).toHaveLength(2);
        const barrel = prefab.entities.find((e) => e.name === 'Barrel')!;
        expect(barrel.parent).toBe('0'); // remapped within the subtree
        expect(prefab.entities.find((e) => e.name === 'Scope')!.visible).toBe(false);

        // Components are deep-cloned — mutating the source doesn't leak in.
        (subtree[0].components[0].data.position as { x: number }).x = 999;
        expect((root.components[0].data.position as { x: number }).x).toBe(3);
    });

    it('extractPrefab mints a fresh UUID per entity by default (globally-unique identity)', () => {
        const subtree: ExtractEntity[] = [
            { id: 10, name: 'Turret', parent: null, children: [11], components: [], visible: true },
            { id: 11, name: 'Barrel', parent: 10, children: [], components: [], visible: true },
        ];
        const prefab = extractPrefab(subtree, 10, 'Turret');
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const e of prefab.entities) expect(e.prefabEntityId).toMatch(UUID);
        expect(prefab.rootEntityId).toBe(prefab.entities[0].prefabEntityId);
        // Two extractions never share an id (the old String(i) counter would).
        const other = extractPrefab(subtree, 10, 'Turret');
        const ids = new Set([...prefab.entities, ...other.entities].map((e) => e.prefabEntityId));
        expect(ids.size).toBe(4);
    });

    it('extract → flatten round-trips: a created prefab instantiates back to the same entities', () => {
        const subtree: ExtractEntity[] = [
            { id: 10, name: 'Turret', parent: null, children: [11], components: [{ type: 'Transform', data: { position: { x: 1, y: 2, z: 0 } } }], visible: true },
            { id: 11, name: 'Barrel', parent: 10, children: [], components: [{ type: 'Sprite', data: {} }], visible: true },
        ];
        const prefab = extractPrefab(subtree, 10, 'Turret');
        let nid = 100;
        const { entities, rootId } = flattenPrefab(prefab, [], { allocateId: () => nid++, loadPrefab: () => null });
        expect(entities).toHaveLength(2);
        expect(entities.find((e) => e.id === rootId)!.name).toBe('Turret');
        expect(entities.find((e) => e.name === 'Barrel')!.parent).toBe(rootId);
    });

    // ── External entity refs: cleared on extract (never dangle), reportable. ──
    it('extractPrefab remaps in-subtree entity refs and clears external ones', () => {
        defineComponent('Chaser', { target: 0 }, { entityFields: ['target'] });
        const subtree: ExtractEntity[] = [
            // root chases the in-subtree child; child chases an external scene entity (99).
            { id: 10, name: 'Root', parent: null, children: [11], components: [{ type: 'Chaser', data: { target: 11 } }], visible: true },
            { id: 11, name: 'Child', parent: 10, children: [], components: [{ type: 'Chaser', data: { target: 99 } }], visible: true },
        ];
        const prefab = extractPrefab(subtree, 10, 'Squad', (() => { let n = 0; return () => String(n++); })());
        const root = prefab.entities.find((e) => e.name === 'Root')!;
        const child = prefab.entities.find((e) => e.name === 'Child')!;
        // In-subtree ref → the child's prefab-local id ('1'); external ref → cleared.
        expect(root.components[0].data.target).toBe('1');
        expect(child.components[0].data.target).toBe(INVALID_ENTITY);
    });

    it('collectExternalEntityRefs reports only out-of-subtree refs', () => {
        defineComponent('Chaser', { target: 0 }, { entityFields: ['target'] });
        const subtree: ExtractEntity[] = [
            { id: 10, name: 'Root', parent: null, children: [11], components: [{ type: 'Chaser', data: { target: 11 } }], visible: true },
            { id: 11, name: 'Child', parent: 10, children: [], components: [{ type: 'Chaser', data: { target: 99 } }], visible: true },
        ];
        const external = collectExternalEntityRefs(subtree);
        expect(external).toEqual([{ entityId: 11, componentType: 'Chaser', field: 'target', target: 99 }]);
    });

    // ExposeRef: a prefab leaves an external ref UNBOUND, and an instance binds it
    // to a scene entity outside the instance. That binding must survive save (collapse)
    // + load (expand) as a plain override carrying the target's stable scene id.
    it('an instance binding of an exposed entity-ref to an external scene entity round-trips', () => {
        defineComponent('Chaser', { target: 0 }, { entityFields: ['target'] });
        const base: PrefabData = {
            version: '2', name: 'Linker', rootEntityId: '0',
            entities: [
                { prefabEntityId: '0', name: 'Linker', parent: null, children: [], visible: true,
                  components: [{ type: 'Chaser', data: { target: INVALID_ENTITY } }] },
            ],
        };
        // The live instance has its exposed ref bound to scene entity 99 (outside the instance).
        const instance: ProcessedEntity[] = [
            { id: 5, prefabEntityId: '0', name: 'Linker', parent: null, children: [], visible: true,
              components: [{ type: 'Chaser', data: { target: 99 } }] },
        ];
        const delta = collapseInstance(base, '@uuid:linker', instance);
        // Captured verbatim — a raw scene id, NOT normalised to a prefab-local id.
        expect(delta.overrides).toEqual([
            { prefabEntityId: '0', type: 'property', componentType: 'Chaser', propertyName: 'target', value: 99 },
        ]);
        // Expand restores the binding — the instance still points at scene entity 99.
        let n = 100;
        const { entities } = expandInstance(base, delta, () => n++);
        const linker = entities.find((e) => e.prefabEntityId === '0')!;
        expect((linker.components.find((c) => c.type === 'Chaser')!.data as { target: number }).target).toBe(99);
    });

    it('loadSceneData (sync) skips prefab entries without throwing', () => {
        createMockModule();
        const world = new World();
        const scene = {
            version: '1.0',
            name: 's',
            entities: [
                { id: 1, name: 'Ground', parent: null, children: [], components: [{ type: 'Transform', data: {} }], visible: true },
                { id: 2, prefab: REF, parent: null, overrides: [], added: [], removed: [] },
            ],
        } as unknown as SceneData;

        const map = expect(() => loadSceneData(world, scene)).not.toThrow();
        void map;
        expect(world.findEntityByName('Ground')).not.toBeNull();
        // The prefab entry is not spawnable synchronously — it is skipped.
        expect(world.findEntityByName('Turret')).toBeNull();
    });
});
