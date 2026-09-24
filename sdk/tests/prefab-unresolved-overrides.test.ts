// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An override is addressed to a prefab entity by id. One whose id names
 *        no entity is applied nowhere, and flatten says which, by the address the
 *        instance wrote — through a nested slot too.
 */
import { describe, it, expect } from 'vitest';
import { flattenPrefab } from '../src/prefab/flatten';
import type { PrefabData, PrefabOverride } from '../src/prefab/types';

const entity = (id: string, parent: string | null, children: string[] = [], extra = {}) => ({
    prefabEntityId: id, name: `E${id}`, parent, children, visible: true,
    components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }], ...extra,
});

const child: PrefabData = {
    version: '1.0', name: 'Child', rootEntityId: 'c0',
    entities: [entity('c0', null)],
};
const parent: PrefabData = {
    version: '1.0', name: 'Parent', rootEntityId: 'n24',
    entities: [
        entity('n24', null, ['slot']),
        { ...entity('slot', 'n24'), components: [], nestedPrefab: { prefabPath: 'child', overrides: [] } },
    ],
};

const move = (target: string): PrefabOverride => ({
    prefabEntityId: target, type: 'property', componentType: 'Transform', propertyName: 'position',
    value: { x: -70, y: 0, z: 0 },
});

const flatten = (overrides: PrefabOverride[]) => {
    let next = 0;
    return flattenPrefab(parent, overrides, {
        allocateId: () => next++,
        loadPrefab: (path) => (path === 'child' ? child : null),
    });
};

describe('an override that names no entity', () => {
    it('is reported, and one that does name an entity is applied', () => {
        const { entities, rootId, unresolved } = flatten([move('n54'), move('n24')]);
        expect(unresolved.map((o) => o.prefabEntityId)).toEqual(['n54']);
        const root = entities.find((e) => e.id === rootId)!;
        expect((root.components[0].data as { position: { x: number } }).position.x).toBe(-70);
    });

    it('inside a nested slot is reported by the address the instance wrote', () => {
        const { unresolved } = flatten([move('slot/c0'), move('slot/c9')]);
        expect(unresolved.map((o) => o.prefabEntityId)).toEqual(['slot/c9']);
    });

    it('is nothing to report when every override lands', () => {
        expect(flatten([move('n24'), move('slot/c0')]).unresolved).toEqual([]);
    });
});
