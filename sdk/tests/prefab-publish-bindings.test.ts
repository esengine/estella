// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it } from 'vitest';
import { defineComponent } from '../src/ecs/component';
import { applyDeltaToSource, buildVariant, collectExternalEntityRefs, expandEntry, type SourceDelta } from '../src/prefab/sceneInstance';
import type { PrefabData, PrefabEntityData } from '../src/prefab/types';
import { validateOverrides, validatePrefab } from '../src/prefab/validate';
import type { DeferredRecord } from '../src/prefab/deferred';

const type = 'PublishBindings';
const component = (target: unknown, links: unknown[], amount = 17) => ({ type, data: { target, links, amount } });
const node = (id: string, parent: string | null, children: string[]): PrefabEntityData =>
    ({ prefabEntityId: id, name: id, parent, children, visible: true, components: [] });
const base: PrefabData = { version: '2', name: 'Rig', rootEntityId: 'root', entities: [
    { ...node('root', null, ['17', 'other']), components: [component('other', ['17', 'other'])] },
    node('17', 'root', []), node('other', 'root', []),
] };
beforeEach(() => { defineComponent(type, { target: 0, links: [], amount: 1 }, { entityFields: ['target', 'links'] }); });

for (const action of ['apply', 'variant'] as const) {
    it(action + ' shares only prefab-local targets across scalar, ordered and whole-component edits', () => {
        const delta: SourceDelta = { removed: [], overrides: [
            { prefabEntityId: 'root', type: 'property', componentType: type, propertyName: 'target', value: 17 },
            { prefabEntityId: 'root', type: 'property', componentType: type, propertyName: 'links', value: ['other', 17, 17, '17', 0, 'other'] },
            { prefabEntityId: '17', type: 'component_added', componentData: component(17, ['root', 17]) },
        ], added: [{ prefabEntityId: 'extra', parentId: 'root', name: 'Extra', visible: true, components: [component(17, ['17', 17, '17'])] }] };
        const original = structuredClone({ base, delta });
        const asset = action === 'apply' ? applyDeltaToSource(base, delta) : buildVariant(base, 'base', 'Variant', delta);
        let id = 500;
        const { entities } = expandEntry(asset, { id: 72, parent: null, prefab: 'result', overrides: [], added: [], removed: [] }, () => id++, () => base);
        const find = (name: string) => entities.find(e => e.prefabEntityId === name)!;
        const peer = find('17').id, other = find('other').id;
        expect(find('root').components[0].data).toEqual({ target: other, links: [other, other, 0, peer, 0, other], amount: 17 });
        expect(find('17').components[0].data).toEqual({ target: 0, links: [72, 0], amount: 17 });
        expect(find('extra').components[0].data).toEqual({ target: 0, links: [peer, 0, peer], amount: 17 });
        expect({ base, delta }).toEqual(original);
    });
    it(action + ' keeps inherited defaults inside a replaced component', () => {
        const delta: SourceDelta = { removed: [], added: [], overrides: [
            { prefabEntityId: 'root', type: 'component_replaced', componentData: component(17, [17, '17'], 99) },
        ] };
        const asset = action === 'apply' ? applyDeltaToSource(base, delta) : buildVariant(base, 'base', 'Variant', delta);
        let id = 600;
        const { entities } = expandEntry(asset, { id: 80, parent: null, prefab: 'result', overrides: [], added: [], removed: [] }, () => id++, () => base);
        const byName = new Map(entities.map(e => [e.prefabEntityId, e]));
        const peer = byName.get('17')!.id;
        expect(byName.get('root')!.components[0].data).toEqual({ target: byName.get('other')!.id, links: [peer, peer], amount: 99 });
    });
}
it('reports external entries in ordered entity fields before extracting a prefab', () => {
    const entities = [{ id: 11, name: 'Root', parent: null, children: [], components: [component(0, [11, 17, 0, 29])] }];
    expect(collectExternalEntityRefs(entities)).toEqual([17, 29].map(target => ({ entityId: 11, componentType: type, field: 'links', target })));
});

it('continues inheriting the joint list when only one scene target differs from the base', () => {
    const overrides = [{ type: 'property' as const, componentType: type, prefabEntityId: 'root', propertyName: 'links', value: [17, 'other'] }];
    const variant = buildVariant(base, 'rig', 'V', { added: [], overrides });
    expect(variant.overrides).toBeUndefined();
    const updated = structuredClone(base);
    updated.entities[0].components[0].data.links = ['other'];
    let id = 100;
    const { entities } = expandEntry(variant, { id: 42, parent: null, prefab: 'V', overrides: [], added: [], removed: [] }, () => id++, () => updated);
    expect(entities.find(e => e.id === 42)!.components[0].data.links).toEqual([entities.find(e => e.prefabEntityId === 'other')!.id]);
});

it('publishes a nested edit in the outer asset and preserves inherited list entries in a variant of it', () => {
    const slot = (id: string) => ({ ...node(id, 'root', []), nestedPrefab: { prefabPath: 'rig', overrides: [] } });
    const outer = { version: '2', name: 'Pair', rootEntityId: 'root', entities: [node('root', null, ['left', 'right']), slot('left'), slot('right')] };
    const links = (value: unknown): SourceDelta => ({ added: [], removed: [], overrides: [
        { prefabEntityId: 'left/root', type: 'property', componentType: type, propertyName: 'links', value },
    ] });
    const load = (ref: string) => ref === 'rig' ? base : null;
    const shared = applyDeltaToSource(outer, links(['right/17', 17]), load);
    const variant = buildVariant(shared, 'pair', 'Pair Variant', links([17, 'root']), load);
    const loadAll = (ref: string) => ref === 'pair' ? shared : load(ref);
    const published = applyDeltaToSource(variant, links([17, 'right/other']), loadAll);
    for (const [asset, expected] of [[shared, ['right/17', 'left/other']], [variant, ['right/17', 'root']], [published, ['right/17', 'right/other']]] as const) {
        let id = 300;
        const result = expandEntry(asset, { id: 42, parent: null, prefab: 'asset', overrides: [], added: [], removed: [] }, () => id++, loadAll);
        expect(result.unresolved).toEqual([]);
        const byName = new Map(result.entities.map(e => [e.prefabEntityId, e]));
        expect(byName.get('left/root')!.components[0].data.links).toEqual(expected.map(address => byName.get(address)!.id));
        expect(byName.get('right/root')!.components[0].data.links).toEqual(['right/17', 'right/other'].map(address => byName.get(address)!.id));
    }
    expect(outer.entities).toHaveLength(3);
    expect(validateOverrides(shared, { loadPrefab: load }).stale).toEqual([]);
    expect(validatePrefab(shared, { loadPrefab: load }).filter(d => d.code === 'stale-override')).toEqual([]);
    expect(validateOverrides(shared, { loadPrefab: load, instanceOverrides: [{ type: 'name', prefabEntityId: 'left/missing', value: 'Missing' }] }).stale).toHaveLength(1);
    const virtual = structuredClone(shared);
    virtual.entities.find(e => e.prefabEntityId === 'left')!.metadata = { deferred: true };
    const deferred: DeferredRecord[] = [];
    let next = 500;
    const empty = { id: 39, prefab: 'pair', parent: null, added: [], overrides: [], removed: [] };
    const first = expandEntry(virtual, empty, () => next++, load, deferred);
    expect(deferred).toHaveLength(1);
    const slotRecord = deferred[0]!;
    const opened = expandEntry(base, { ...empty, id: slotRecord.id, overrides: slotRecord.overrides }, () => next++, load);
    expect(opened.entities.find(e => e.id === slotRecord.id)!.components[0].data.links).toEqual([
        first.entities.find(e => e.prefabEntityId === 'right/17')!.id, opened.entities.find(e => e.prefabEntityId === 'other')!.id,
    ]);
    expect(base.entities[0].components[0].data.links).toEqual(['17', 'other']);
    expect(buildVariant(base, 'rig', 'V', { overrides: [{ ...links([17, 19]).overrides[0], prefabEntityId: 'root' }], added: [] }).overrides).toBeUndefined();
});

it('reopens a previously saved scene after one of its added members entered the shared asset', () => {
    const saved = { id: 42, parent: null, prefab: 'Rig', overrides: [], removed: [], added: [
        { prefabEntityId: 'mount', name: 'Mount', parentId: 'root', visible: true, components: [component(17, ['17', 17])] },
    ] };
    const asset = applyDeltaToSource(base, saved);
    let id = 300;
    const { entities } = expandEntry(asset, saved, () => id++);
    const mounts = entities.filter(e => e.prefabEntityId === 'mount');
    expect(mounts).toHaveLength(1);
    expect(mounts[0].parent).toBe(42);
    expect(mounts[0].components[0].data).toEqual({ target: 17, links: [entities.find(e => e.prefabEntityId === '17')!.id, 17], amount: 17 });
});

it('keeps additions below mounted members and links to those additions on the instance', () => {
    const slot = { ...node('slot', 'root', []), nestedPrefab: { prefabPath: 'rig', overrides: [] } };
    const source = { ...base, entities: [{ ...base.entities[0], children: [...base.entities[0].children, 'slot'] }, ...base.entities.slice(1), slot] };
    const added = (id: string, parentId: string) => ({ prefabEntityId: id, parentId, name: id, components: [], visible: true });
    const delta: SourceDelta = { added: [added('child', 'mount'), added('mount', 'slot/other')], removed: [], overrides: [
        { prefabEntityId: 'root', type: 'property', componentType: type, propertyName: 'target', value: 'child' },
    ] };
    expect(applyDeltaToSource(source, delta, () => base)).toEqual(source);
    expect(buildVariant(source, 'source', 'V', delta, () => base)).toMatchObject({ entities: [] });
});
