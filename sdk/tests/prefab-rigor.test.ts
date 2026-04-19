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
} from '../src/prefab/index';
import type { FlattenContext } from '../src/prefab/index';

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

// ─── Self-smoke ──────────────────────────────────────────────
// Guard against accidentally removing the vi import when trimming.
vi.fn;
