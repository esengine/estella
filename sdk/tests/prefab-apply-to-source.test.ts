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
