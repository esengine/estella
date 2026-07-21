// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  applyOverridesToSource — the core of editor "Apply to Prefab": fold an
 *        instance's overrides into the prefab source as the new base.
 */
import { describe, it, expect } from 'vitest';
// Import the value directly: the prefab barrel (`../src/prefab`) has a pre-existing
// circular-import quirk under vitest's source ESM that leaves several function
// re-exports undefined (the bundled dist resolves them fine). Types are erased, so
// they can still come from the barrel.
import { applyOverridesToSource } from '../src/prefab/override';
import { applyDeltaToSource } from '../src/prefab/sceneInstance';
import type { AddedEntity } from '../src/prefab/sceneInstance';
import type { PrefabData, PrefabOverride } from '../src/prefab';

function basePrefab(): PrefabData {
    return {
        version: '1.0',
        name: 'Enemy',
        rootEntityId: '0',
        entities: [
            { prefabEntityId: '0', name: 'Root', parent: null, children: ['1'], visible: true,
              components: [{ type: 'Transform', data: { x: 0, y: 0 } }] },
            { prefabEntityId: '1', name: 'Body', parent: '0', children: [], visible: true,
              components: [{ type: 'Sprite', data: { texture: 'a.png', color: 'white' } }] },
        ],
    };
}

describe('applyOverridesToSource', () => {
    it('bakes a property override into the matching source entity', () => {
        const overrides: PrefabOverride[] = [
            { prefabEntityId: '1', type: 'property', componentType: 'Sprite', propertyName: 'color', value: 'red' },
        ];
        const next = applyOverridesToSource(basePrefab(), overrides);
        const body = next.entities.find(e => e.prefabEntityId === '1')!;
        expect((body.components[0].data as { color: string }).color).toBe('red');
    });

    it('does not mutate the input source (pure)', () => {
        const src = basePrefab();
        applyOverridesToSource(src, [
            { prefabEntityId: '1', type: 'property', componentType: 'Sprite', propertyName: 'color', value: 'red' },
        ]);
        const body = src.entities.find(e => e.prefabEntityId === '1')!;
        expect((body.components[0].data as { color: string }).color).toBe('white');
    });

    it('preserves entity identities and unrelated entities/fields', () => {
        const next = applyOverridesToSource(basePrefab(), [
            { prefabEntityId: '1', type: 'property', componentType: 'Sprite', propertyName: 'color', value: 'red' },
        ]);
        expect(next.entities.map(e => e.prefabEntityId)).toEqual(['0', '1']);
        const root = next.entities.find(e => e.prefabEntityId === '0')!;
        expect((root.components[0].data as { x: number }).x).toBe(0); // untouched
        const body = next.entities.find(e => e.prefabEntityId === '1')!;
        expect((body.components[0].data as { texture: string }).texture).toBe('a.png'); // untouched field
    });

    it('applies name, visibility, component add/replace/remove, metadata', () => {
        const overrides: PrefabOverride[] = [
            { prefabEntityId: '0', type: 'name', value: 'Boss' },
            { prefabEntityId: '1', type: 'visibility', value: false },
            { prefabEntityId: '1', type: 'component_added', componentData: { type: 'Health', data: { hp: 5 } } },
            { prefabEntityId: '1', type: 'component_replaced', componentData: { type: 'Sprite', data: { texture: 'b.png' } } },
            { prefabEntityId: '0', type: 'component_removed', componentType: 'Transform' },
            { prefabEntityId: '1', type: 'metadata_set', metadataKey: 'tag', value: 'enemy' },
        ];
        const next = applyOverridesToSource(basePrefab(), overrides);
        const root = next.entities.find(e => e.prefabEntityId === '0')!;
        const body = next.entities.find(e => e.prefabEntityId === '1')!;
        expect(root.name).toBe('Boss');
        expect(root.components.find(c => c.type === 'Transform')).toBeUndefined();
        expect(body.visible).toBe(false);
        expect(body.components.find(c => c.type === 'Health')?.data).toEqual({ hp: 5 });
        expect(body.components.find(c => c.type === 'Sprite')?.data).toEqual({ texture: 'b.png' });
        expect(body.metadata?.tag).toBe('enemy');
    });

    it('is a no-op clone when there are no overrides', () => {
        const src = basePrefab();
        const next = applyOverridesToSource(src, []);
        expect(next).toEqual(src);
        expect(next).not.toBe(src); // a distinct object (safe to write)
    });

    it('ignores overrides targeting an unknown entity id', () => {
        const next = applyOverridesToSource(basePrefab(), [
            { prefabEntityId: 'ghost', type: 'name', value: 'X' },
        ]);
        expect(next).toEqual(basePrefab());
    });
});

// ── Structural Apply: overrides + added + removed folded into the source ─────

/** root '0' → mid '1' → leaf '2' (a 3-generation prefab). */
function chainPrefab(): PrefabData {
    return {
        version: '2', name: 'Chain', rootEntityId: '0',
        entities: [
            { prefabEntityId: '0', name: 'Root', parent: null, children: ['1'], visible: true, components: [] },
            { prefabEntityId: '1', name: 'Mid', parent: '0', children: ['2'], visible: true, components: [] },
            { prefabEntityId: '2', name: 'Leaf', parent: '1', children: [], visible: true, components: [] },
        ],
    };
}

describe('applyDeltaToSource (structural Apply)', () => {
    const noDelta = { overrides: [], added: [], removed: [] };

    it('folds overrides just like applyOverridesToSource', () => {
        const next = applyDeltaToSource(basePrefab(), {
            ...noDelta,
            overrides: [{ prefabEntityId: '1', type: 'property', componentType: 'Sprite', propertyName: 'color', value: 'red' }],
        });
        expect((next.entities.find((e) => e.prefabEntityId === '1')!.components[0].data as { color: string }).color).toBe('red');
    });

    it('removes a subtree root and its descendants, unlinking from the parent', () => {
        const next = applyDeltaToSource(chainPrefab(), { ...noDelta, removed: ['1'] });
        expect(next.entities.map((e) => e.prefabEntityId)).toEqual(['0']); // mid + leaf gone
        expect(next.entities[0].children).toEqual([]); // root no longer lists mid
    });

    it('removes only a leaf when the leaf is the removed root', () => {
        const next = applyDeltaToSource(chainPrefab(), { ...noDelta, removed: ['2'] });
        expect(next.entities.map((e) => e.prefabEntityId)).toEqual(['0', '1']);
        expect(next.entities.find((e) => e.prefabEntityId === '1')!.children).toEqual([]);
    });

    it('never removes the prefab root even if asked', () => {
        const next = applyDeltaToSource(chainPrefab(), { ...noDelta, removed: ['0'] });
        expect(next.entities.some((e) => e.prefabEntityId === '0')).toBe(true);
    });

    it('inserts an added entity linked under its parent', () => {
        const added: AddedEntity[] = [
            { prefabEntityId: 'new1', name: 'Muzzle', components: [{ type: 'Sprite', data: { texture: 'm.png' } }], visible: true, parentId: '1' },
        ];
        const next = applyDeltaToSource(basePrefab(), { ...noDelta, added });
        const created = next.entities.find((e) => e.prefabEntityId === 'new1')!;
        expect(created.parent).toBe('1');
        expect(next.entities.find((e) => e.prefabEntityId === '1')!.children).toContain('new1');
        expect((created.components[0].data as { texture: string }).texture).toBe('m.png');
    });

    it('attaches an added entity with null parentId under the root', () => {
        const added: AddedEntity[] = [
            { prefabEntityId: 'top', name: 'Top', components: [], visible: true, parentId: null },
        ];
        const next = applyDeltaToSource(basePrefab(), { ...noDelta, added });
        expect(next.entities.find((e) => e.prefabEntityId === 'top')!.parent).toBe('0');
        expect(next.entities.find((e) => e.prefabEntityId === '0')!.children).toContain('top');
    });

    it('combines overrides + added + removed in one pass', () => {
        const next = applyDeltaToSource(chainPrefab(), {
            overrides: [{ prefabEntityId: '0', type: 'name', value: 'Boss' }],
            added: [{ prefabEntityId: 'gun', name: 'Gun', components: [], visible: true, parentId: '0' }],
            removed: ['1'],
        });
        expect(next.entities.find((e) => e.prefabEntityId === '0')!.name).toBe('Boss');
        expect(next.entities.some((e) => e.prefabEntityId === 'gun')).toBe(true);
        expect(next.entities.some((e) => e.prefabEntityId === '1')).toBe(false); // mid removed
        expect(next.entities.find((e) => e.prefabEntityId === '0')!.children).toEqual(['gun']); // mid unlinked, gun linked
    });

    it('is pure — the input source is not mutated', () => {
        const src = chainPrefab();
        applyDeltaToSource(src, { overrides: [], added: [{ prefabEntityId: 'x', name: 'X', components: [], visible: true, parentId: '0' }], removed: ['2'] });
        expect(src.entities.map((e) => e.prefabEntityId)).toEqual(['0', '1', '2']);
        expect(src.entities[0].children).toEqual(['1']);
    });
});
