// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from '../src/ecs/component';
import { flattenPrefab } from '../src/prefab/flatten';
import { collapseEntry, expandEntry, type PrefabInstanceEntry } from '../src/prefab/sceneInstance';
import type { ComponentData, PrefabData, PrefabEntityData, PrefabOverride, ProcessedEntity } from '../src/prefab/types';

const type = 'InstanceBindingTest';
const binding = (target: unknown, links: unknown[], amount = 1): ComponentData =>
    ({ type, data: { target, links, amount } });
const row = (id: string, parent: string | null, children: string[], components: ComponentData[] = []): PrefabEntityData =>
    ({ prefabEntityId: id, name: id, parent, children, components, visible: true });
const set = (id: string, propertyName: string, value: unknown): PrefabOverride =>
    ({ prefabEntityId: id, type: 'property', componentType: type, propertyName, value });
const inner: PrefabData = {
    name: 'Inner', version: '2', rootEntityId: 'root', entities: [
        row('root', null, ['hand', '17']),
        row('hand', 'root', [], [binding('root', ['17'])]),
        row('17', 'root', []),
    ],
};
const slot = (id: string): PrefabEntityData => ({
    ...row(id, 'root', []),
    nestedPrefab: { prefabPath: 'inner', overrides: [set('hand', 'links', [17, 'root'])] },
});
const outer: PrefabData = {
    name: 'Outer', version: '2', rootEntityId: 'root', entities: [
        row('root', null, ['left', 'right', '17']), slot('left'), slot('right'), row('17', 'root', []),
    ],
};
const load = (ref: string) => ref === 'inner' ? inner : ref === 'outer' ? outer : null;
const empty = (): PrefabInstanceEntry => ({ id: 42, parent: null, prefab: 'outer', overrides: [], added: [], removed: [] });
const allocate = (start: number) => () => start++;
const find = (rows: ProcessedEntity[], id: string) => rows.find(e => e.prefabEntityId === id)!;
beforeEach(() => { defineComponent(type, { target: 0, links: [], amount: 1 }, { entityFields: ['target', 'links'] }); });

describe('entity references written by prefab instance edits', () => {
    it('interprets a picked target in the instance that saved it, even when two nested slots reuse its name', () => {
        const entry = empty();
        entry.overrides.push(set('left/hand', 'target', 'root'), set('left/hand', 'links', ['right/17', 'left/root', 17, 0, 'right/17']));
        const original = structuredClone({ outer, inner, entry });
        for (const start of [500, 900]) {
            const { entities, unresolved } = expandEntry(outer, entry, allocate(start), load);
            expect(unresolved).toEqual([]);
            expect(find(entities, 'left/hand').components[0].data).toEqual({
                target: 42, links: [find(entities, 'right/17').id, find(entities, 'left/root').id, 17, 0, find(entities, 'right/17').id], amount: 1,
            });
            expect(find(entities, 'right/hand').components[0].data.links).toEqual([find(entities, 'right/17').id, find(entities, 'right/root').id]);
            expect(collapseEntry(outer, entry.prefab, entities, entry.id, null, load)).toEqual(entry);
        }
        expect({ outer, inner, entry }).toEqual(original);
    });

    it('persists new components and added members by stable address, including forward and mutual bindings', () => {
        const entry = empty();
        const { entities } = expandEntry(outer, entry, allocate(100), load);
        const left = find(entities, 'left/hand'), right = find(entities, 'right/hand'), root = find(entities, 'root');
        const a: ProcessedEntity = { ...row('a', null, []), id: 700, parent: root.id, children: [],
            components: [binding(701, [right.id, 17, 0, 700])] };
        const b: ProcessedEntity = { ...row('b', null, []), id: 701, parent: a.id, children: [], components: [binding(700, [])] };
        entities.push(a, b);
        left.components[0].data.target = b.id;
        root.components.push(binding(a.id, [b.id, right.id, 17]));
        const saved = collapseEntry(outer, entry.prefab, entities, entry.id, null, load);
        expect(saved.added[0].components).toEqual([binding('b', ['right/hand', 17, 0, 'a'])]);
        expect(saved.overrides).toContainEqual({ prefabEntityId: 'root', type: 'component_added',
            componentData: binding('a', ['b', 'right/hand', 17]) });
        a.components[0].data.amount = 99;
        const reopened = expandEntry(outer, JSON.parse(JSON.stringify(saved)), allocate(930), load).entities;
        const id = (pid: string) => find(reopened, pid).id;
        expect(find(reopened, 'left/hand').components[0].data.target).toBe(id('b'));
        expect(find(reopened, 'a').components).toEqual([binding(id('b'), [id('right/hand'), 17, 0, id('a')])]);
        expect(find(reopened, 'b').components).toEqual([binding(id('a'), [])]);
        expect(find(reopened, 'root').components).toEqual([binding(id('a'), [id('b'), id('right/hand'), 17])]);
        expect(collapseEntry(outer, entry.prefab, reopened, entry.id, null, load)).toEqual(saved);
    });

    it('applies variant reference overrides in the variant scope, above the authored nested slot', () => {
        const variant: PrefabData = { ...outer, name: 'Variant', basePrefab: 'outer', entities: [],
            overrides: [set('left/hand', 'target', 'right/root')] };
        const { entities } = flattenPrefab(variant, [], { allocateId: allocate(300), loadPrefab: load });
        expect(find(entities, 'left/hand').components[0].data.target).toBe(find(entities, 'right/root').id);
        expect(find(entities, 'left/hand').components[0].data.links).toEqual([find(entities, 'left/17').id, find(entities, 'left/root').id]);
        const child = { ...variant, name: 'Child', basePrefab: 'variant', overrides: [set('left/hand', 'links', ['right/hand'])] };
        const chained = flattenPrefab(child, [], { allocateId: allocate(600), loadPrefab: ref => ref === 'variant' ? variant : load(ref) }).entities;
        expect(find(chained, 'left/hand').components[0].data).toEqual({
            target: find(chained, 'right/root').id, links: [find(chained, 'right/hand').id], amount: 1,
        });
    });
});
