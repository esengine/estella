// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { flattenPrefab, validatePrefab, type PrefabData, type PrefabEntityData, type PrefabOverride } from '../src/prefab/index';

const entity = (id: string, parent: string | null, children: string[] = []): PrefabEntityData => ({
    prefabEntityId: id, name: id, parent, children, visible: true, components: [],
});
function wide(n: number): PrefabData {
    return { version: '2', name: 'wide', rootEntityId: 'root', entities: [
        entity('root', null, Array.from({ length: n }, (_, i) => `c${i}`)),
        ...Array.from({ length: n }, (_, i) => entity(`c${i}`, 'root')),
    ] };
}
function flatten(p: PrefabData, base?: PrefabData) {
    let next = 0;
    return flattenPrefab(p, [], { allocateId: () => next++, visited: new Set(), loadPrefab: () => base ?? null });
}
function reverseChain(n: number): PrefabData {
    return { version: '2', name: 'deep', rootEntityId: '0', entities: Array.from({ length: n }, (_, i) =>
        entity(String(i), i ? String(i - 1) : null, i + 1 < n ? [String(i + 1)] : [])).reverse() };
}

describe('hierarchy authoring remains bounded by nodes and links', () => {
    for (const operation of ['flatten', 'validate'] as const) {
        it(`${operation} reads a wide authored children list linearly`, () => {
            const p = wide(1024); let reads = 0;
            p.entities[0].children = new Proxy(p.entities[0].children, {
                get(target, property, receiver) {
                    if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
                    return Reflect.get(target, property, receiver);
                },
            });
            if (operation === 'flatten') expect(flatten(p).entities).toHaveLength(1025);
            else expect(validatePrefab(p)).toEqual([]);
            // Count authored link reads, not wall time: a membership scan per
            // child must fail even on a fast machine, while legitimate passes fit.
            expect(reads).toBeLessThan(1024 * 12);
        });
    }

    it('validates a reversed 10,000-level hierarchy without a JS call-stack limit', () => {
        expect(validatePrefab(reverseChain(10000))).toEqual([]);
    });

    it('merges a reversed deep variant with stable links and unmodified sources', () => {
        const base = reverseChain(10000), original = JSON.stringify(base);
        const variant: PrefabData = { version: '2', name: 'deep-variant', rootEntityId: '0', basePrefab: 'base', entities: [] };
        const result = flatten(variant, base);
        expect(result.entities).toHaveLength(10000);
        expect(result.entities.find(e => e.id === result.rootId)!.children).toHaveLength(1);
        expect(JSON.stringify(base)).toBe(original);
    });

    it('reports a cycle at the end of a long reversed chain rather than throwing RangeError', () => {
        const p = reverseChain(10000);
        p.entities.find(e => e.prefabEntityId === '0')!.parent = '1';
        expect(validatePrefab(p).filter(d => d.code === 'parent-cycle')).toHaveLength(1);
    });

    it('appends and replaces wide variant entries without changing base children or ordering', () => {
        const base = wide(1024), original = JSON.stringify(base);
        const replacements = base.entities.slice(1).map(e => ({ ...e, name: `updated-${e.name}` }));
        const additions = Array.from({ length: 1024 }, (_, i) => entity(`extra${i}`, 'root'));
        const variant: PrefabData = { version: '2', name: 'wide-variant', rootEntityId: 'root', basePrefab: 'base', entities: [...replacements, ...additions] };
        const result = flatten(variant, base);
        expect(result.entities).toHaveLength(2049);
        expect(result.entities.find(e => e.id === result.rootId)!.children).toHaveLength(2048);
        expect(result.entities.slice(1, 1025).every(e => e.name.startsWith('updated-'))).toBe(true);
        expect(JSON.stringify(base)).toBe(original);
    });

    it('keeps authored sibling order when nested slots appear in a different entity-array order', () => {
        const p: PrefabData = { version: '2', name: 'slots', rootEntityId: 'root', entities: [
            entity('root', null, ['right', 'left']),
            { ...entity('left', 'root', ['extra']), nestedPrefab: { prefabPath: 'leaf', overrides: [] } },
            { ...entity('right', 'root'), nestedPrefab: { prefabPath: 'leaf', overrides: [] } },
            entity('extra', 'left'),
        ] };
        const leaf: PrefabData = { version: '2', name: 'leaf', rootEntityId: '0', entities: [
            entity('0', null, ['1']), entity('1', '0'),
        ] };
        const original = JSON.stringify({ p, leaf });
        const result = flatten(p, leaf);
        const byId = new Map(result.entities.map(e => [e.prefabEntityId, e]));
        expect(byId.get('root')!.children).toEqual([byId.get('right/0')!.id, byId.get('left/0')!.id]);
        expect(byId.get('left/0')!.children).toEqual([byId.get('left/1')!.id, byId.get('extra')!.id]);
        expect(byId.get('extra')!.parent).toBe(byId.get('left/0')!.id);
        expect(JSON.stringify({ p, leaf })).toBe(original);
    });

    it('routes overrides across wide nested slots with bounded address reads', () => {
        const ids = Array.from({ length: 256 }, (_, i) => `mount${i}`);
        const p: PrefabData = { version: '2', name: 'mounts', rootEntityId: 'root', entities: [
            entity('root', null, ids),
            ...ids.map(id => ({ ...entity(id, 'root'), nestedPrefab: { prefabPath: 'leaf', overrides: [] } })),
        ] };
        const leaf: PrefabData = { version: '2', name: 'leaf', rootEntityId: 'root', entities: [
            entity('root', null, ['child']), entity('child', 'root'),
        ] };
        let reads = 0, next = 1;
        const overrides: PrefabOverride[] = ids.flatMap(id => ['preview', id].map(name => ({
            get prefabEntityId() { reads++; return `${id}/child`; },
            type: 'name' as const, value: name,
        })));
        overrides.push({ prefabEntityId: 'mount0/missing', type: 'name', value: 'unresolved' });
        const result = flattenPrefab(p, overrides, { allocateId: () => next++, loadPrefab: () => leaf });
        const byAddress = new Map(result.entities.map(e => [e.prefabEntityId, e]));
        expect(ids.map(id => byAddress.get(`${id}/child`)!.name)).toEqual(ids);
        expect(result.unresolved.map(patch => patch.prefabEntityId)).toEqual(['mount0/missing']);
        expect(reads).toBeLessThan(overrides.length * 12);
    });
});
