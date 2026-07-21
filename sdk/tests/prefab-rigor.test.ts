// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Rigor suite for the prefab data model:
 *   - UUID identity + legacy migration round-trip
 *   - Per-entity metadata through flatten + overrides
 *   - Variant additions (new entities contributed by variant)
 *   - diffAgainstSource inverse of applyOverrides
 *   - validateOverrides catches stale refs
 *   - parent/children consistency invariant
 *   - O(N+M) override application (correctness under bucketed path)
 *
 * Covers the gaps flagged during the editor-readiness audit. Numeric-id
 * existing tests stay in `prefab.test.ts`; this file targets the new
 * surface introduced for editor authoring.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrefabData, PrefabOverride, ProcessedEntity } from '../src/prefab';
import {
    migratePrefabData,
    diffAgainstSource,
    validateOverrides,
    PREFAB_FORMAT_VERSION,
} from '../src/prefab';
import {
    flattenPrefab,
    bucketOverridesByEntity,
    expandInstance,
    collapseInstance,
} from '../src/prefab/index';
import type { FlattenContext, PrefabInstanceDelta } from '../src/prefab/index';
import { defineComponent } from '../src/component';

// ─── Shared fixtures for hierarchical-address / structural-deletion suites ───

/** A tiny 2-entity prefab: root '0' + child '1' (ids two prefabs will reuse). */
function leafPrefab(name: string): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name,
        rootEntityId: '0',
        entities: [
            { prefabEntityId: '0', name: `${name}Root`, parent: null, children: ['1'], components: [{ type: 'Transform', data: { x: 0 } }], visible: true },
            { prefabEntityId: '1', name: `${name}Child`, parent: '0', children: [], components: [], visible: true },
        ],
    };
}

/** An outer prefab mounting `slots` as nested-prefab children under its root. */
function shipWithSlots(slots: Array<{ id: string; path: string }>): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name: 'Ship',
        rootEntityId: 'ship',
        entities: [
            { prefabEntityId: 'ship', name: 'Ship', parent: null, children: slots.map((s) => s.id), components: [], visible: true },
            ...slots.map((s) => ({
                prefabEntityId: s.id, name: `Slot_${s.id}`, parent: 'ship', children: [], components: [], visible: true,
                nestedPrefab: { prefabPath: s.path, overrides: [] },
            })),
        ],
    };
}

function ctxWith(prefabs: Record<string, PrefabData>): FlattenContext {
    let n = 0;
    return { allocateId: () => n++, loadPrefab: (p) => prefabs[p] ?? null, visited: new Set() };
}
const loaderFor = (prefabs: Record<string, PrefabData>) => (p: string) => prefabs[p] ?? null;

function uuidPrefab(): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name: 'Hero',
        rootEntityId: 'root',
        entities: [
            {
                prefabEntityId: 'root',
                name: 'Hero',
                parent: null,
                children: ['weapon'],
                components: [
                    { type: 'Transform', data: { x: 0, y: 0 } },
                    { type: 'Sprite', data: { texture: 'hero.png', color: 'white' } },
                ],
                visible: true,
                metadata: { 'asset:Sprite.texture': 'uuid-hero-png' },
            },
            {
                prefabEntityId: 'weapon',
                name: 'Weapon',
                parent: 'root',
                children: [],
                components: [
                    { type: 'Sprite', data: { texture: 'sword.png' } },
                ],
                visible: true,
            },
        ],
    };
}

function freshCtx(): FlattenContext {
    let n = 0;
    return {
        allocateId: () => n++,
        loadPrefab: () => null,
        visited: new Set(),
    };
}

// ─── Migration + round-trip ────────────────────────────────────

describe('migratePrefabData', () => {
    it('upgrades numeric ids to strings and preserves cross-references', () => {
        const legacy = {
            version: '1.0',
            name: 'Legacy',
            rootEntityId: 0,
            entities: [
                {
                    prefabEntityId: 0,
                    name: 'Root',
                    parent: null,
                    children: [1],
                    components: [],
                    visible: true,
                },
                {
                    prefabEntityId: 1,
                    name: 'Child',
                    parent: 0,
                    children: [],
                    components: [],
                    visible: true,
                },
            ],
            overrides: [
                { prefabEntityId: 1, type: 'name', value: 'Renamed' },
            ],
        };

        const { data, migrated, fromVersion, toVersion } = migratePrefabData(legacy);
        expect(migrated).toBe(true);
        expect(fromVersion).toBe('1.0');
        expect(toVersion).toBe(PREFAB_FORMAT_VERSION);
        expect(data.rootEntityId).toBe('0');
        expect(data.entities[0].prefabEntityId).toBe('0');
        expect(data.entities[0].children).toEqual(['1']);
        expect(data.entities[1].parent).toBe('0');
        expect(data.overrides![0].prefabEntityId).toBe('1');
    });

    it('is idempotent on already-migrated data', () => {
        const current = uuidPrefab();
        const { data, migrated } = migratePrefabData(current);
        expect(migrated).toBe(false);
        expect(data).toBe(current);
    });

    it('upgrades a stale-version file even when its ids are already strings', () => {
        const staleButStringIds = {
            version: '1.0',
            name: 'Stale',
            rootEntityId: '0',
            entities: [{ prefabEntityId: '0', name: 'R', parent: null, children: [], components: [], visible: true }],
        };
        const { data, migrated, toVersion } = migratePrefabData(staleButStringIds);
        expect(migrated).toBe(true);
        expect(toVersion).toBe(PREFAB_FORMAT_VERSION);
        expect(data.version).toBe(PREFAB_FORMAT_VERSION);
        expect(data.rootEntityId).toBe('0'); // string ids preserved, not re-numbered
        expect(data.entities[0].prefabEntityId).toBe('0');
    });

    it('round-trips through JSON without drift', () => {
        const original = uuidPrefab();
        const serialized = JSON.stringify(original);
        const parsed = JSON.parse(serialized);
        const { data } = migratePrefabData(parsed);
        const reSerialized = JSON.stringify(data);
        // parsed path → migrate-no-op → re-stringify must equal original
        expect(JSON.parse(reSerialized)).toEqual(original);
    });

    it('throws on shapes that are not prefab data', () => {
        expect(() => migratePrefabData(null)).toThrow(/must be an object/);
        expect(() => migratePrefabData({})).toThrow(/entities/);
        expect(() => migratePrefabData({ entities: [], rootEntityId: null })).toThrow(
            /rootEntityId/,
        );
    });
});

// ─── Metadata carries through flatten ─────────────────────────

describe('prefab metadata', () => {
    it('flatten preserves per-entity metadata on ProcessedEntity', () => {
        const { entities } = flattenPrefab(uuidPrefab(), [], freshCtx());
        const root = entities.find(e => e.prefabEntityId === 'root');
        expect(root?.metadata).toEqual({ 'asset:Sprite.texture': 'uuid-hero-png' });
    });

    it('metadata_set override adds a new key to an entity without existing metadata', () => {
        const prefab = uuidPrefab();
        const overrides: PrefabOverride[] = [
            { prefabEntityId: 'weapon', type: 'metadata_set', metadataKey: 'debug:autoSpin', value: true },
        ];
        const { entities } = flattenPrefab(prefab, overrides, freshCtx());
        const weapon = entities.find(e => e.prefabEntityId === 'weapon');
        expect(weapon?.metadata).toEqual({ 'debug:autoSpin': true });
    });

    it('metadata_set override replaces an existing key', () => {
        const prefab = uuidPrefab();
        const overrides: PrefabOverride[] = [
            {
                prefabEntityId: 'root',
                type: 'metadata_set',
                metadataKey: 'asset:Sprite.texture',
                value: 'uuid-different',
            },
        ];
        const { entities } = flattenPrefab(prefab, overrides, freshCtx());
        const root = entities.find(e => e.prefabEntityId === 'root');
        expect(root?.metadata?.['asset:Sprite.texture']).toBe('uuid-different');
    });

    it('metadata_removed drops the key and clears the object when empty', () => {
        const prefab = uuidPrefab();
        const overrides: PrefabOverride[] = [
            { prefabEntityId: 'root', type: 'metadata_removed', metadataKey: 'asset:Sprite.texture' },
        ];
        const { entities } = flattenPrefab(prefab, overrides, freshCtx());
        const root = entities.find(e => e.prefabEntityId === 'root');
        expect(root?.metadata).toBeUndefined();
    });

    it('cloneMetadata is deep (mutating the source does not leak into flatten result)', () => {
        const prefab = uuidPrefab();
        const original = prefab.entities[0].metadata!['asset:Sprite.texture'];
        const { entities } = flattenPrefab(prefab, [], freshCtx());
        prefab.entities[0].metadata!['asset:Sprite.texture'] = 'MUTATED';
        const root = entities.find(e => e.prefabEntityId === 'root');
        expect(root?.metadata?.['asset:Sprite.texture']).toBe(original);
    });
});

// ─── Variant additions ────────────────────────────────────────

describe('variant additions', () => {
    it('variant entities with new ids get added to base with parent wiring', () => {
        const base = uuidPrefab();
        const variant: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'HeroWithShield',
            rootEntityId: 'root',
            basePrefab: 'base.esprefab',
            entities: [
                {
                    prefabEntityId: 'shield',
                    name: 'Shield',
                    parent: 'root',
                    children: [],
                    components: [{ type: 'Sprite', data: { texture: 'shield.png' } }],
                    visible: true,
                },
            ],
        };
        const ctx: FlattenContext = {
            allocateId: (() => { let n = 0; return () => n++; })(),
            loadPrefab: (path) => path === 'base.esprefab' ? base : null,
            visited: new Set(),
        };
        const { entities } = flattenPrefab(variant, [], ctx);
        expect(entities.some(e => e.prefabEntityId === 'shield')).toBe(true);
        expect(entities.some(e => e.prefabEntityId === 'weapon')).toBe(true);
        expect(entities.some(e => e.prefabEntityId === 'root')).toBe(true);

        // Shield must be a child of root in the runtime tree.
        const root = entities.find(e => e.prefabEntityId === 'root')!;
        const shield = entities.find(e => e.prefabEntityId === 'shield')!;
        expect(root.children).toContain(shield.id);
    });

    it('rejects variant additions with unknown parent', () => {
        const base = uuidPrefab();
        const variant: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'Broken',
            rootEntityId: 'root',
            basePrefab: 'base.esprefab',
            entities: [
                {
                    prefabEntityId: 'floater',
                    name: 'Floater',
                    parent: 'ghost',
                    children: [],
                    components: [],
                    visible: true,
                },
            ],
        };
        const ctx: FlattenContext = {
            allocateId: (() => { let n = 0; return () => n++; })(),
            loadPrefab: (path) => path === 'base.esprefab' ? base : null,
            visited: new Set(),
        };
        expect(() => flattenPrefab(variant, [], ctx)).toThrow(/parent "ghost" not found/);
    });

    it('variant entry with a known id replaces the base authored data', () => {
        const base = uuidPrefab();
        const variant: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'HeroReskin',
            rootEntityId: 'root',
            basePrefab: 'base.esprefab',
            entities: [
                {
                    prefabEntityId: 'weapon',
                    name: 'BigWeapon',
                    parent: 'root',
                    children: [],
                    components: [{ type: 'Sprite', data: { texture: 'greatsword.png' } }],
                    visible: true,
                },
            ],
        };
        const ctx: FlattenContext = {
            allocateId: (() => { let n = 0; return () => n++; })(),
            loadPrefab: (path) => path === 'base.esprefab' ? base : null,
            visited: new Set(),
        };
        const { entities } = flattenPrefab(variant, [], ctx);
        const weapon = entities.find(e => e.prefabEntityId === 'weapon')!;
        expect(weapon.name).toBe('BigWeapon');
        expect(weapon.components[0].data['texture']).toBe('greatsword.png');
    });

    it('rejects variants whose rootEntityId disagrees with base', () => {
        const base = uuidPrefab();
        const variant: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'BadVariant',
            rootEntityId: 'different-root',
            basePrefab: 'base.esprefab',
            entities: [],
        };
        const ctx: FlattenContext = {
            allocateId: (() => { let n = 0; return () => n++; })(),
            loadPrefab: (path) => path === 'base.esprefab' ? base : null,
            visited: new Set(),
        };
        expect(() => flattenPrefab(variant, [], ctx)).toThrow(/rootEntityId/);
    });
});

// ─── Parent/children invariant ────────────────────────────────

describe('parent/children consistency', () => {
    it('throws when a child points at a missing entity', () => {
        const broken: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'Broken',
            rootEntityId: 'root',
            entities: [
                {
                    prefabEntityId: 'root',
                    name: 'Root',
                    parent: null,
                    children: ['phantom'],
                    components: [],
                    visible: true,
                },
            ],
        };
        expect(() => flattenPrefab(broken, [], freshCtx())).toThrow(/child "phantom" which does not exist/);
    });

    it('throws when a parent pointer disagrees with children lists', () => {
        const broken: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'Broken',
            rootEntityId: 'root',
            entities: [
                {
                    prefabEntityId: 'root',
                    name: 'Root',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                },
                {
                    prefabEntityId: 'orphan',
                    name: 'Orphan',
                    parent: 'root',
                    children: [],
                    components: [],
                    visible: true,
                },
            ],
        };
        expect(() => flattenPrefab(broken, [], freshCtx())).toThrow(
            /parent's children list does not contain it/,
        );
    });
});

// ─── diffAgainstSource ─────────────────────────────────────────

describe('diffAgainstSource', () => {
    function cloneForInstance(prefab: PrefabData): ProcessedEntity[] {
        let n = 0;
        return prefab.entities.map(e => {
            const out: ProcessedEntity = {
                id: n++,
                prefabEntityId: e.prefabEntityId,
                name: e.name,
                parent: null,
                children: [],
                components: e.components.map(c => ({
                    type: c.type,
                    data: { ...c.data },
                })),
                visible: e.visible,
            };
            if (e.metadata) out.metadata = { ...e.metadata };
            return out;
        });
    }

    it('returns an empty override list when instance equals source', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        const result = diffAgainstSource(prefab, instance);
        expect(result.overrides).toEqual([]);
        expect(result.untracked).toEqual([]);
        expect(result.orphanedSourceIds).toEqual([]);
    });

    it('emits property override for changed field', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance[0].components[0].data = { x: 50, y: 0 };
        const { overrides } = diffAgainstSource(prefab, instance);
        expect(overrides).toContainEqual({
            prefabEntityId: 'root',
            type: 'property',
            componentType: 'Transform',
            propertyName: 'x',
            value: 50,
        });
    });

    it('emits component_added for new component and component_removed for missing one', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance[0].components.push({ type: 'Velocity', data: { linear: { x: 1, y: 0, z: 0 } } });
        instance[0].components = instance[0].components.filter(c => c.type !== 'Sprite');
        const { overrides } = diffAgainstSource(prefab, instance);
        expect(overrides).toContainEqual(
            expect.objectContaining({ type: 'component_added', componentData: expect.objectContaining({ type: 'Velocity' }) }),
        );
        expect(overrides).toContainEqual({
            prefabEntityId: 'root',
            type: 'component_removed',
            componentType: 'Sprite',
        });
    });

    it('emits name + visibility overrides', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance[0].name = 'Hero#42';
        instance[1].visible = false;
        const { overrides } = diffAgainstSource(prefab, instance);
        expect(overrides).toContainEqual({ prefabEntityId: 'root', type: 'name', value: 'Hero#42' });
        expect(overrides).toContainEqual({ prefabEntityId: 'weapon', type: 'visibility', value: false });
    });

    it('emits metadata_set for new/changed and metadata_removed for dropped keys', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        // Change existing key
        instance[0].metadata!['asset:Sprite.texture'] = 'uuid-different';
        // Add new key
        instance[0].metadata!['debug:autoSpin'] = true;
        // Drop on weapon (wasn't there) — no diff expected
        const { overrides } = diffAgainstSource(prefab, instance);
        expect(overrides).toContainEqual({
            prefabEntityId: 'root',
            type: 'metadata_set',
            metadataKey: 'asset:Sprite.texture',
            value: 'uuid-different',
        });
        expect(overrides).toContainEqual({
            prefabEntityId: 'root',
            type: 'metadata_set',
            metadataKey: 'debug:autoSpin',
            value: true,
        });
    });

    it('honours ignoreMetadataKeys', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance[0].metadata!['prefab:source'] = '@uuid:abc';
        const { overrides } = diffAgainstSource(prefab, instance, {
            ignoreMetadataKeys: ['prefab:source'],
        });
        expect(overrides).toEqual([]);
    });

    it('reports untracked entities and orphaned source ids', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance.push({
            id: 99,
            prefabEntityId: 'new-entity',
            name: 'Adhoc',
            parent: null,
            children: [],
            components: [],
            visible: true,
        });
        instance.shift(); // drop the root so it's orphaned from source POV
        const { untracked, orphanedSourceIds } = diffAgainstSource(prefab, instance);
        expect(untracked.map(e => e.prefabEntityId)).toEqual(['new-entity']);
        expect(orphanedSourceIds).toContain('root');
    });

    it('round-trip: applyOverrides(flatten(source), diffAgainstSource(source, instance)) reproduces instance', () => {
        const prefab = uuidPrefab();
        const instance = cloneForInstance(prefab);
        instance[0].name = 'Modified';
        instance[0].components[0].data = { x: 99, y: 0 };
        instance[1].visible = false;
        if (!instance[1].metadata) instance[1].metadata = {};
        instance[1].metadata['custom'] = 42;

        const { overrides } = diffAgainstSource(prefab, instance);

        const { entities: reflattened } = flattenPrefab(prefab, overrides, freshCtx());
        const reRoot = reflattened.find(e => e.prefabEntityId === 'root')!;
        const reWeapon = reflattened.find(e => e.prefabEntityId === 'weapon')!;
        expect(reRoot.name).toBe('Modified');
        expect(reRoot.components.find(c => c.type === 'Transform')?.data).toEqual({ x: 99, y: 0 });
        expect(reWeapon.visible).toBe(false);
        expect(reWeapon.metadata?.['custom']).toBe(42);
    });
});

// ─── validateOverrides ────────────────────────────────────────

describe('validateOverrides', () => {
    it('returns empty when all overrides resolve', () => {
        const prefab = uuidPrefab();
        const { stale, orphanedChildren } = validateOverrides(prefab, {
            instanceOverrides: [
                { prefabEntityId: 'root', type: 'name', value: 'X' },
                { prefabEntityId: 'weapon', type: 'visibility', value: false },
            ],
        });
        expect(stale).toEqual([]);
        expect(orphanedChildren).toEqual([]);
    });

    it('flags override pointing at missing entity', () => {
        const prefab = uuidPrefab();
        const { stale } = validateOverrides(prefab, {
            instanceOverrides: [
                { prefabEntityId: 'ghost', type: 'name', value: 'X' },
            ],
        });
        expect(stale).toHaveLength(1);
        expect(stale[0].reason).toMatch(/entity "ghost" not found/);
    });

    it('flags property override for component not present on entity', () => {
        const prefab = uuidPrefab();
        const { stale } = validateOverrides(prefab, {
            instanceOverrides: [
                {
                    prefabEntityId: 'weapon',
                    type: 'property',
                    componentType: 'Physics',
                    propertyName: 'mass',
                    value: 1,
                },
            ],
        });
        expect(stale[0].reason).toMatch(/component "Physics" not present/);
    });

    it('flags metadata_removed when key is not present', () => {
        const prefab = uuidPrefab();
        const { stale } = validateOverrides(prefab, {
            instanceOverrides: [
                { prefabEntityId: 'weapon', type: 'metadata_removed', metadataKey: 'does-not-exist' },
            ],
        });
        expect(stale[0].reason).toMatch(/metadata key "does-not-exist" not present/);
    });

    it('walks nested prefab overrides when a loader is supplied', () => {
        const nested: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'Nested',
            rootEntityId: 'n-root',
            entities: [
                {
                    prefabEntityId: 'n-root',
                    name: 'NRoot',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                },
            ],
        };
        const outer: PrefabData = {
            version: PREFAB_FORMAT_VERSION,
            name: 'Outer',
            rootEntityId: 'root',
            entities: [
                {
                    prefabEntityId: 'root',
                    name: 'Root',
                    parent: null,
                    children: [],
                    components: [],
                    visible: true,
                    nestedPrefab: {
                        prefabPath: 'nested.esprefab',
                        overrides: [
                            { prefabEntityId: 'ghost-in-nested', type: 'name', value: 'X' },
                        ],
                    },
                },
            ],
        };
        const { stale } = validateOverrides(outer, {
            loadPrefab: (path) => path === 'nested.esprefab' ? nested : null,
        });
        expect(stale).toHaveLength(1);
        expect(stale[0].site).toBe('nested');
        expect(stale[0].nestedAt).toBe('root');
    });
});

// ─── Bucketing (perf-correctness) ─────────────────────────────

describe('bucketOverridesByEntity', () => {
    it('groups overrides by prefabEntityId preserving order within each bucket', () => {
        const overrides: PrefabOverride[] = [
            { prefabEntityId: 'a', type: 'name', value: 'A1' },
            { prefabEntityId: 'b', type: 'name', value: 'B1' },
            { prefabEntityId: 'a', type: 'visibility', value: true },
            { prefabEntityId: 'c', type: 'name', value: 'C1' },
            { prefabEntityId: 'a', type: 'name', value: 'A2' },
        ];
        const buckets = bucketOverridesByEntity(overrides);
        expect(buckets.get('a')!.map(o => o.value)).toEqual(['A1', true, 'A2']);
        expect(buckets.get('b')!.map(o => o.value)).toEqual(['B1']);
        expect(buckets.get('c')!.map(o => o.value)).toEqual(['C1']);
    });

    it('applied via flatten yields same result as pre-bucketed list', () => {
        const prefab = uuidPrefab();
        const overrides: PrefabOverride[] = [
            { prefabEntityId: 'root', type: 'name', value: 'One' },
            { prefabEntityId: 'weapon', type: 'visibility', value: false },
            { prefabEntityId: 'root', type: 'visibility', value: false },
        ];
        const { entities } = flattenPrefab(prefab, overrides, freshCtx());
        const root = entities.find(e => e.prefabEntityId === 'root')!;
        const weapon = entities.find(e => e.prefabEntityId === 'weapon')!;
        expect(root.name).toBe('One');
        expect(root.visible).toBe(false);
        expect(weapon.visible).toBe(false);
    });
});

// ─── Loader migration log side effect ────────────────────────
// (lightweight — heavier asset-loader integration covered elsewhere)

describe('migration visible to callers', () => {
    it('exposes fromVersion/toVersion so callers can inform the user', () => {
        const { migrated, fromVersion, toVersion } = migratePrefabData({
            version: '1.0',
            name: 'x',
            rootEntityId: 0,
            entities: [{ prefabEntityId: 0, name: 'r', parent: null, children: [], components: [], visible: true }],
        });
        expect(migrated).toBe(true);
        expect(fromVersion).toBe('1.0');
        expect(toVersion).toBe(PREFAB_FORMAT_VERSION);
    });
});

describe('diffAgainstSource — entity-ref fields', () => {
    // The real case is a USER component with a SCALAR entity ref (a script that
    // targets another entity); builtins only have Children.entities (an ARRAY the
    // structural parent/children path owns). Registered per-test — the setup
    // clears user components between tests.
    const FOLLOW_META = { entityFields: ['target'] };

    function squad(): PrefabData {
        return {
            version: PREFAB_FORMAT_VERSION,
            name: 'Squad',
            rootEntityId: 'leader',
            entities: [
                { prefabEntityId: 'leader', name: 'Leader', parent: null, children: ['ally', 'follower'], components: [], visible: true },
                { prefabEntityId: 'ally', name: 'Ally', parent: 'leader', children: [], components: [], visible: true },
                {
                    prefabEntityId: 'follower', name: 'Follower', parent: 'leader', children: [],
                    components: [{ type: 'FollowTarget', data: { target: 'leader' } }], visible: true,
                },
            ],
        };
    }

    // Runtime ids assigned in entity order: leader=0, ally=1, follower=2.
    function instance(prefab: PrefabData, followerTarget: number): ProcessedEntity[] {
        let n = 0;
        return prefab.entities.map((e) => ({
            id: n++,
            prefabEntityId: e.prefabEntityId,
            name: e.name,
            parent: null,
            children: [],
            components: e.components.map((c) => ({
                type: c.type,
                data: c.type === 'FollowTarget' ? { target: followerTarget } : { ...c.data },
            })),
            visible: e.visible,
        }));
    }

    it('an unchanged sibling ref produces no override (runtime id normalises to its prefab-local id)', () => {
        defineComponent('FollowTarget', { target: 0 }, FOLLOW_META);
        const prefab = squad();
        // follower.target = 0 = leader's runtime id → normalises to 'leader' === source.
        const { overrides } = diffAgainstSource(prefab, instance(prefab, 0));
        expect(overrides).toEqual([]);
    });

    it('a re-pointed ref stores the prefab-local id, not the volatile runtime number', () => {
        defineComponent('FollowTarget', { target: 0 }, FOLLOW_META);
        const prefab = squad();
        // follower.target = 1 = ally's runtime id → a genuine re-point.
        const { overrides } = diffAgainstSource(prefab, instance(prefab, 1));
        expect(overrides).toContainEqual({
            prefabEntityId: 'follower',
            type: 'property',
            componentType: 'FollowTarget',
            propertyName: 'target',
            value: 'ally', // prefab-local id — survives remapComponentEntityRefs on reload
        });
    });
});

// ─── Hierarchical addressing (nested identity, sibling repeats) ────────────

describe('hierarchical addressing', () => {
    it('mounts the SAME prefab in two sibling slots — distinct composed addresses, no throw', () => {
        const turret = leafPrefab('Turret');
        const ship = shipWithSlots([{ id: 'a', path: 'turret' }, { id: 'b', path: 'turret' }]);
        const { entities } = flattenPrefab(ship, [], ctxWith({ turret }));
        const ids = entities.map((e) => e.prefabEntityId);
        // Each slot namespaces the turret's local ids by the slot it mounted through.
        expect(ids).toEqual(expect.arrayContaining(['ship', 'a/0', 'a/1', 'b/0', 'b/1']));
        // No duplicate stable ids across the whole flattened set (the old global
        // `visited` set forbade this repeat entirely).
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('two DIFFERENT nested prefabs that both use "0"/"1" do not collide', () => {
        const engine = leafPrefab('Engine');
        const wing = leafPrefab('Wing');
        const ship = shipWithSlots([{ id: 'e', path: 'engine' }, { id: 'w', path: 'wing' }]);
        const { entities } = flattenPrefab(ship, [], ctxWith({ engine, wing }));
        const ids = entities.map((e) => e.prefabEntityId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expect.arrayContaining(['e/0', 'e/1', 'w/0', 'w/1']));
    });

    it('still detects a genuine self-cycle (a prefab nesting itself)', () => {
        const self: PrefabData = {
            version: PREFAB_FORMAT_VERSION, name: 'Self', rootEntityId: '0',
            entities: [
                { prefabEntityId: '0', name: 'Root', parent: null, children: ['1'], components: [], visible: true },
                { prefabEntityId: '1', name: 'Slot', parent: '0', children: [], components: [], visible: true, nestedPrefab: { prefabPath: 'self', overrides: [] } },
            ],
        };
        expect(() => flattenPrefab(self, [], ctxWith({ self }))).toThrow(/Circular reference/);
    });

    it('rejects an authored id containing the reserved address separator', () => {
        const bad: PrefabData = {
            version: PREFAB_FORMAT_VERSION, name: 'Bad', rootEntityId: 'a/b',
            entities: [{ prefabEntityId: 'a/b', name: 'X', parent: null, children: [], components: [], visible: true }],
        };
        expect(() => flattenPrefab(bad, [], freshCtx())).toThrow(/reserved separator/);
    });
});

// ─── Nested-instance delta round-trip (override on a nested entity) ─────────

describe('nested-instance delta', () => {
    it('routes an override onto a nested entity and round-trips it through collapse', () => {
        const turret = leafPrefab('Turret');
        const ship = shipWithSlots([{ id: 'a', path: 'turret' }]);
        const load = loaderFor({ turret });
        const delta: PrefabInstanceDelta = {
            prefab: '@uuid:ship',
            overrides: [{ prefabEntityId: 'a/1', type: 'name', value: 'CustomChild' }],
            added: [],
            removed: [],
        };
        let nid = 0;
        const { entities } = expandInstance(ship, delta, () => nid++, load);
        // The composed-address override was routed down into the nested flatten.
        expect(entities.find((e) => e.prefabEntityId === 'a/1')?.name).toBe('CustomChild');

        const back = collapseInstance(ship, '@uuid:ship', entities, load);
        expect(back.overrides).toContainEqual({ prefabEntityId: 'a/1', type: 'name', value: 'CustomChild' });
        expect(back.added).toEqual([]);
        expect(back.removed).toEqual([]);
    });
});

// ─── Structural deletion: subtree cascade + minimal recording ──────────────

describe('structural deletion', () => {
    /** root → mid → leaf (a flat 3-generation prefab). */
    function chainPrefab(): PrefabData {
        return {
            version: PREFAB_FORMAT_VERSION, name: 'Chain', rootEntityId: 'root',
            entities: [
                { prefabEntityId: 'root', name: 'Root', parent: null, children: ['mid'], components: [], visible: true },
                { prefabEntityId: 'mid', name: 'Mid', parent: 'root', children: ['leaf'], components: [], visible: true },
                { prefabEntityId: 'leaf', name: 'Leaf', parent: 'mid', children: [], components: [], visible: true },
            ],
        };
    }

    it('removing a parent drops its whole subtree; collapse records only the subtree root', () => {
        const prefab = chainPrefab();
        const delta: PrefabInstanceDelta = { prefab: '@uuid:chain', overrides: [], added: [], removed: ['mid'] };
        let nid = 0;
        const { entities } = expandInstance(prefab, delta, () => nid++);
        const ids = entities.map((e) => e.prefabEntityId);
        expect(ids).toEqual(['root']); // mid + its descendant leaf both gone
        // Collapse: both mid and leaf are absent from the instance, but only the
        // subtree root `mid` is recorded (leaf's parent is itself removed).
        const back = collapseInstance(prefab, '@uuid:chain', entities);
        expect(back.removed).toEqual(['mid']);
    });

    it('a leaf deletion still records just the leaf', () => {
        const prefab = chainPrefab();
        const delta: PrefabInstanceDelta = { prefab: '@uuid:chain', overrides: [], added: [], removed: ['leaf'] };
        let nid = 0;
        const { entities } = expandInstance(prefab, delta, () => nid++);
        expect(entities.map((e) => e.prefabEntityId).sort()).toEqual(['mid', 'root']);
        const back = collapseInstance(prefab, '@uuid:chain', entities);
        expect(back.removed).toEqual(['leaf']);
    });

    it('cascades across a nested boundary (remove the nested root)', () => {
        const turret = leafPrefab('Turret');
        const ship = shipWithSlots([{ id: 'a', path: 'turret' }]);
        const load = loaderFor({ turret });
        const delta: PrefabInstanceDelta = { prefab: '@uuid:ship', overrides: [], added: [], removed: ['a/0'] };
        let nid = 0;
        const { entities } = expandInstance(ship, delta, () => nid++, load);
        const ids = entities.map((e) => e.prefabEntityId);
        expect(ids).not.toContain('a/0');
        expect(ids).not.toContain('a/1'); // nested child cascaded away
        expect(ids).toContain('ship');
        const back = collapseInstance(ship, '@uuid:ship', entities, load);
        expect(back.removed).toEqual(['a/0']);
    });
});

// ─── validateOverrides: identity checks ────────────────────────────────────

describe('validateOverrides identity', () => {
    it('flags duplicate ids and ids containing the reserved separator', () => {
        const prefab: PrefabData = {
            version: PREFAB_FORMAT_VERSION, name: 'Dup', rootEntityId: 'root',
            entities: [
                { prefabEntityId: 'root', name: 'Root', parent: null, children: [], components: [], visible: true },
                { prefabEntityId: 'root', name: 'Dupe', parent: null, children: [], components: [], visible: true },
                { prefabEntityId: 'a/b', name: 'Bad', parent: null, children: [], components: [], visible: true },
            ],
        };
        const { duplicateIds, invalidIds } = validateOverrides(prefab);
        expect(duplicateIds).toEqual(['root']);
        expect(invalidIds).toEqual(['a/b']);
    });

    it('is clean for a well-formed prefab', () => {
        const { duplicateIds, invalidIds } = validateOverrides(uuidPrefab());
        expect(duplicateIds).toEqual([]);
        expect(invalidIds).toEqual([]);
    });
});

// ─── Self-smoke ──────────────────────────────────────────────
// Guard against accidentally removing the vi import when trimming.
vi.fn;
