// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The unified strict prefab validator (`validatePrefab`) — one structured-
 * diagnostic pass shared by editor open/save, runtime load, cook and CI.
 * Each test pins one diagnostic code so the CI gate + editor surfacing can
 * rely on stable codes.
 */
import { describe, it, expect } from 'vitest';
import type { PrefabData, PrefabDiagnostic } from '../src/prefab/index';
import { validatePrefab, PREFAB_FORMAT_VERSION } from '../src/prefab/index';
import { defineComponent } from '../src/component';

function clean(): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name: 'Hero',
        rootEntityId: 'root',
        entities: [
            { prefabEntityId: 'root', name: 'Hero', parent: null, children: ['weapon'], components: [{ type: 'Transform', data: {} }], visible: true },
            { prefabEntityId: 'weapon', name: 'Weapon', parent: 'root', children: [], components: [], visible: true },
        ],
    };
}

const codes = (d: PrefabDiagnostic[]): string[] => d.map((x) => x.code);
const errors = (d: PrefabDiagnostic[]): PrefabDiagnostic[] => d.filter((x) => x.severity === 'error');

describe('validatePrefab', () => {
    it('returns no diagnostics for a well-formed prefab', () => {
        expect(validatePrefab(clean())).toEqual([]);
    });

    it('flags a missing root', () => {
        const p = clean();
        p.rootEntityId = 'ghost';
        expect(codes(validatePrefab(p))).toContain('root-missing');
    });

    it('flags a duplicate id', () => {
        const p = clean();
        p.entities[1].prefabEntityId = 'root';
        p.entities[0].children = [];
        const d = validatePrefab(p);
        expect(codes(d)).toContain('duplicate-id');
    });

    it('flags an id containing the reserved separator', () => {
        const p = clean();
        p.entities[1].prefabEntityId = 'a/b';
        p.entities[0].children = ['a/b'];
        expect(codes(validatePrefab(p))).toContain('invalid-id');
    });

    it('flags a detached (parentless, non-root) entity', () => {
        const p = clean();
        p.entities[1].parent = null;
        p.entities[0].children = [];
        expect(codes(validatePrefab(p))).toContain('detached-entity');
    });

    it('flags a missing parent reference', () => {
        const p = clean();
        p.entities[1].parent = 'ghost';
        p.entities[0].children = [];
        expect(codes(validatePrefab(p))).toContain('missing-parent');
    });

    it('flags a missing child reference', () => {
        const p = clean();
        p.entities[0].children = ['weapon', 'ghost'];
        expect(codes(validatePrefab(p))).toContain('missing-child');
    });

    it('flags parent/children disagreement', () => {
        const p = clean();
        p.entities[0].children = []; // root no longer lists weapon, but weapon.parent='root'
        expect(codes(validatePrefab(p))).toContain('inconsistent-topology');
    });

    it('flags an entity unreachable from the root', () => {
        const p = clean();
        // A well-formed but disconnected pair reachable from neither root nor each-other-via-root.
        p.entities.push(
            { prefabEntityId: 'floatA', name: 'A', parent: 'floatB', children: [], components: [], visible: true },
            { prefabEntityId: 'floatB', name: 'B', parent: null, children: ['floatA'], components: [], visible: true },
        );
        const d = validatePrefab(p);
        expect(codes(d)).toContain('unreachable');
        expect(codes(d)).toContain('detached-entity'); // floatB is a second parentless root
    });

    it('flags a parent cycle', () => {
        const p: PrefabData = {
            version: PREFAB_FORMAT_VERSION, name: 'Cyc', rootEntityId: 'a',
            entities: [
                { prefabEntityId: 'a', name: 'A', parent: 'b', children: ['b'], components: [], visible: true },
                { prefabEntityId: 'b', name: 'B', parent: 'a', children: ['a'], components: [], visible: true },
            ],
        };
        expect(codes(validatePrefab(p))).toContain('parent-cycle');
    });

    it('flags a duplicate component type on one entity', () => {
        const p = clean();
        p.entities[0].components = [{ type: 'Transform', data: {} }, { type: 'Transform', data: { x: 1 } }];
        const d = validatePrefab(p);
        expect(codes(d)).toContain('duplicate-component');
        expect(d.find((x) => x.code === 'duplicate-component')?.field).toBe('Transform');
    });

    it('warns on a dangling entity-ref field', () => {
        defineComponent('FollowTargetV', { target: 0 }, { entityFields: ['target'] });
        const p = clean();
        p.entities[1].components = [{ type: 'FollowTargetV', data: { target: 'ghost' } }];
        const d = validatePrefab(p);
        const ref = d.find((x) => x.code === 'dangling-entity-ref');
        expect(ref?.severity).toBe('warning');
        expect(ref?.field).toBe('FollowTargetV.target');
    });

    it('accepts an entity-ref that resolves within the prefab', () => {
        defineComponent('FollowTargetV', { target: 0 }, { entityFields: ['target'] });
        const p = clean();
        p.entities[1].components = [{ type: 'FollowTargetV', data: { target: 'root' } }];
        expect(codes(validatePrefab(p))).not.toContain('dangling-entity-ref');
    });

    it('flags a malformed override (missing componentType)', () => {
        const p = clean();
        p.overrides = [{ prefabEntityId: 'root', type: 'property', propertyName: 'x', value: 1 }];
        expect(codes(validatePrefab(p))).toContain('invalid-override');
    });

    it('warns on a stale override targeting a missing entity', () => {
        const p = clean();
        const d = validatePrefab(p, { instanceOverrides: [{ prefabEntityId: 'ghost', type: 'name', value: 'X' }] });
        const stale = d.find((x) => x.code === 'stale-override');
        expect(stale?.severity).toBe('warning');
    });

    it('flags a nested/variant dependency cycle via the loader', () => {
        const self: PrefabData = {
            version: PREFAB_FORMAT_VERSION, name: 'Self', rootEntityId: '0',
            entities: [
                { prefabEntityId: '0', name: 'Root', parent: null, children: ['1'], components: [], visible: true },
                { prefabEntityId: '1', name: 'Slot', parent: '0', children: [], components: [], visible: true, nestedPrefab: { prefabPath: 'self', overrides: [] } },
            ],
        };
        const d = validatePrefab(self, { loadPrefab: (p) => (p === 'self' ? self : null) });
        expect(codes(d)).toContain('dependency-cycle');
    });

    it('separates errors from warnings', () => {
        const p = clean();
        p.rootEntityId = 'ghost'; // error
        p.overrides = [{ prefabEntityId: 'nope', type: 'name', value: 'X' }]; // warning (stale)
        const d = validatePrefab(p);
        expect(errors(d).map((x) => x.code)).toContain('root-missing');
        expect(d.some((x) => x.code === 'stale-override' && x.severity === 'warning')).toBe(true);
    });
});
