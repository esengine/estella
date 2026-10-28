// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Children, Name } from '../src/ecs/component';
import type { ChildrenData, NameData } from '../src/ecs/component';
import { instantiatePrefab, type PrefabData, type PrefabOverride } from '../src/prefab';
import { cutToRoot, isDeferredInstance, rootOnly } from '../src/prefab/deferred';
import { expandScenePrefabs, loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { deferredEntities, deferredRecord } from '../src/scene/deferredInstances';
import { UIPages } from '../src/ui/pages/ui-pages';
import type { Assets } from '../src/asset/Assets';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

type Meta = Record<string, unknown>;
const ent = (id: string, name: string, parent: string | null, children: string[], metadata?: Meta) =>
    ({ prefabEntityId: id, name, parent, children, visible: true, components: [{ type: 'Transform', data: {} }], ...(metadata ? { metadata } : {}) });
const prefab = (name: string, kids: string[], rootMeta?: Meta): PrefabData => ({
    version: '2', name, rootEntityId: 'root',
    entities: [ent('root', name, null, kids.map((k) => 'e-' + k), rootMeta), ...kids.map((k) => ent('e-' + k, k, 'root', []))],
});
const mark = (id = 'root', value = true): PrefabOverride => ({ prefabEntityId: id, type: 'metadata_set', metadataKey: 'deferred', value });
const entry = (id: number, ref: string, overrides: PrefabOverride[] = []) => ({ id, parent: 1, prefab: ref, overrides, added: [], removed: [] });
const sceneOf = (...entries: unknown[]): SceneData => ({
    version: 4, name: 's',
    entities: [{ id: 1, name: 'canvas', parent: null, children: [], components: [{ type: 'Transform', data: {} }], visible: true }, ...entries] as never,
});
const loader = (prefabs: Record<string, PrefabData>) => async (ref: string) => prefabs[ref] ?? null;

describe('virtual prefab instances: the marks', () => {
    it('reads the mark from the prefab root and lets an override on the instance change it', () => {
        const plain = prefab('p', ['a']), marked = prefab('p', ['a'], { deferred: true });
        expect(isDeferredInstance(plain, [])).toBe(false);
        expect(isDeferredInstance(plain, [mark()])).toBe(true);
        expect(isDeferredInstance(marked, [])).toBe(true);
        expect(isDeferredInstance(marked, [mark('root', false)])).toBe(false);
        expect(isDeferredInstance(marked, [{ prefabEntityId: 'root', type: 'metadata_removed', metadataKey: 'deferred' }])).toBe(false);
        expect(isDeferredInstance(plain, [mark('e-a')])).toBe(false);                    // only the root's mark counts
    });
    it('cuts a prefab to its root, and cannot cut a variant', () => {
        const cut = rootOnly(prefab('p', ['a', 'b']))!;
        expect(cut.entities.map((e) => e.prefabEntityId)).toEqual(['root']); expect(cut.entities[0]!.children).toEqual([]);
        expect(rootOnly({ ...prefab('v', ['a']), basePrefab: 'base' } as PrefabData)).toBeNull();
        expect(cutToRoot([{ id: 7, prefabEntityId: 'root', name: 'r', parent: null, children: [8], components: [], visible: true }, { id: 8, prefabEntityId: 'x', name: 'x', parent: 7, children: [], components: [], visible: true }], 7).map((e) => e.id)).toEqual([7]);
    });
});

describe('virtual prefab instances: loading a scene', () => {
    it('expands an unmarked instance whole and a marked one to its root, with a record of what it would be made from', async () => {
        const prefabs = { home: prefab('home', ['a', 'b', 'c']), shop: prefab('shop', ['x', 'y']) };
        const scene = sceneOf(entry(2, 'home'), entry(3, 'shop', [mark()]));
        const out = await expandScenePrefabs(scene, loader(prefabs));
        const names = out.entities.map((e) => e.name);
        expect(names).toEqual(expect.arrayContaining(['home', 'a', 'b', 'c', 'shop']));
        expect(names).not.toContain('x'); expect(names).not.toContain('y');
        expect(out.entities.find((e) => e.id === 3)!.children).toEqual([]);
        expect(out.deferredInstances).toEqual([{ id: 3, prefab: 'shop', overrides: [mark()] }]);
    });
    it('a prefab marked on its root is virtual wherever it is used, and an override can switch it off for one instance', async () => {
        const prefabs = { page: prefab('page', ['a'], { deferred: true }) };
        const out = await expandScenePrefabs(sceneOf(entry(2, 'page'), entry(3, 'page', [mark('root', false)])), loader(prefabs));
        expect(out.deferredInstances!.map((r) => r.id)).toEqual([2]);
        expect(out.entities.filter((e) => e.name === 'a')).toHaveLength(1);
    });
    it('does not make virtual what moves its parts about: added or removed entities and re-parenting', async () => {
        const prefabs = { p: prefab('p', ['a', 'b']) };
        const added = { ...entry(2, 'p', [mark()]), added: [{ prefabEntityId: 'extra', name: 'extra', components: [], visible: true, parentId: null }] };
        const reparent = entry(3, 'p', [mark(), { prefabEntityId: 'e-a', type: 'parent', value: 'e-b' }]);
        const out = await expandScenePrefabs(sceneOf(added, reparent), loader(prefabs));
        expect(out.deferredInstances).toBeUndefined();
        expect(out.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['extra', 'a', 'b']));
    });
    it('an instance override on a nested prefab inside a virtual instance is kept in the record, in the prefab\'s own address space', async () => {
        const out = await expandScenePrefabs(sceneOf(entry(2, 'p', [mark(), { prefabEntityId: 'e-a', type: 'name', value: 'renamed' }])), loader({ p: prefab('p', ['a']) }));
        expect(out.deferredInstances![0]!.overrides).toEqual([mark(), { prefabEntityId: 'e-a', type: 'name', value: 'renamed' }]);
        expect(out.entities.map((e) => e.name)).not.toContain('renamed');
    });
});

describe.skipIf(!HAS_WASM)('virtual prefab instances: in a world', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });
    const world = () => { const w = new World(); w.connectCpp(new engine.Registry() as unknown as CppRegistry, engine); return w; };
    const assetsFor = (prefabs: Record<string, PrefabData>): Assets => ({
        loadPrefab: async (ref: string) => { const data = prefabs[ref]; if (!data) throw new Error('no such prefab ' + ref); return { data }; },
        acquireTyped: async (_t: string, ref: string) => ({ value: { data: prefabs[ref] }, release() {} }),
        preloadSceneAssets: async () => ({ scope: { releaseAll() {}, absorb() {} }, missing: [], textureHandles: new Map(), materialHandles: new Map() }),
        resolveSceneAssetPaths() {}, trackSceneAssetReferences() {},
    } as unknown as Assets);
    const nameOf = (w: World, e: Entity): string => (w.get(e, Name) as NameData).value;
    const under = (w: World, e: Entity): string[] => {
        const out: string[] = [];
        const walk = (x: Entity): void => { out.push(nameOf(w, x)); if (w.has(x, Children)) for (const c of (w.get(x, Children) as ChildrenData).entities) walk(c); };
        walk(e); return out;
    };
    const find = (w: World, name: string): Entity => { const e = w.getAllEntities().find((x) => w.has(x, Name) && nameOf(w, x) === name); if (e === undefined) throw new Error('no entity ' + name); return e; };

    it('loads only the root of a virtual instance, registers it, and opens it on demand under that root', async () => {
        const prefabs = { home: prefab('home', ['a', 'b']), shop: prefab('shop', ['x', 'y', 'z']) };
        const w = world(), assets = assetsFor(prefabs);
        await loadSceneWithAssets(w, sceneOf(entry(2, 'home'), entry(3, 'shop', [mark()])), { assets });
        expect(w.getAllEntities()).toHaveLength(1 + 3 + 1);                       // canvas, home + 2, the shop's root alone
        const shop = find(w, 'shop');
        expect(deferredEntities(w)).toEqual([shop]);
        expect(deferredRecord(w, shop)!.prefab).toBe('shop');
        expect(under(w, shop)).toEqual(['shop']);

        const pages = new UIPages(w, assets);
        expect(pages.registerDeferredAll()).toEqual(['shop']);
        expect(pages.isBuilt('shop')).toBe(false);
        const handle = await pages.open('shop');
        expect(handle.root).toBe(shop);
        expect(under(w, shop)).toEqual(['shop', 'x', 'y', 'z']);
        expect(w.getAllEntities()).toHaveLength(1 + 3 + 4);
    });

    it('keeps a virtual instance where it was in the draw order', async () => {
        const prefabs = { p: prefab('p', ['a']) };
        const w = world();
        await loadSceneWithAssets(w, sceneOf(entry(2, 'p', [mark()]), entry(3, 'p'), entry(4, 'p', [mark()])), { assets: assetsFor(prefabs) });
        const canvas = find(w, 'canvas');
        const kids = (w.get(canvas, Children) as ChildrenData).entities;
        expect(kids).toHaveLength(3);
        expect(deferredEntities(w)).toEqual([kids[0], kids[2]]);
        const pages = new UIPages(w, assetsFor(prefabs));
        expect(pages.registerDeferred(kids[0]!)).toBe('p');
        await pages.open('p');
        expect((w.get(canvas, Children) as ChildrenData).entities).toEqual(kids);   // nothing moved
    });

    it('makes a nested virtual slot as its root when the prefab around it is built, and opens it from there', async () => {
        const outer: PrefabData = {
            version: '2', name: 'outer', rootEntityId: 'root',
            entities: [
                ent('root', 'outer', null, ['plain', 'slot']),
                ent('plain', 'plain', 'root', []),
                { prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [], visible: true, components: [],
                    nestedPrefab: { prefabPath: 'inner', overrides: [mark()] } } as never,
            ],
        };
        const prefabs = { outer, inner: prefab('inner', ['i1', 'i2']) };
        const w = world(), assets = assetsFor(prefabs);
        const host = w.spawn(); w.insert(host, Name, { value: 'host' });
        const made = await instantiatePrefab(w, outer, { assets, parent: host });
        expect(under(w, made.root)).toEqual(['outer', 'plain', 'inner']);        // the inner prefab is its root only
        const inner = find(w, 'inner');
        expect(deferredRecord(w, inner)!.prefab).toBe('inner');

        const pages = new UIPages(w, assets);
        pages.register('outer', { prefab: 'outer', parent: host });
        expect(pages.has('inner')).toBe(false);
        const outerPage = await pages.open('outer');
        expect(pages.has('inner')).toBe(true);                                     // adopted when its page was built
        const innerHandle = await pages.open('inner');
        expect(innerHandle.root).toBe(outerPage.find('inner'));                    // the inner root of the page just built, not of the first copy
        expect(under(w, innerHandle.root)).toEqual(['inner', 'i1', 'i2']);
        expect(under(w, inner)).toEqual(['inner']);                                // the first copy was left as it was
    });

    it('makes a nested virtual slot whole when asked to', async () => {
        const outer: PrefabData = { version: '2', name: 'outer', rootEntityId: 'root', entities: [
            ent('root', 'outer', null, ['slot']),
            { prefabEntityId: 'slot', name: 'slot', parent: 'root', children: [], visible: true, components: [], nestedPrefab: { prefabPath: 'inner', overrides: [mark()] } } as never] };
        const prefabs = { outer, inner: prefab('inner', ['i1']) };
        const w = world();
        const made = await instantiatePrefab(w, outer, { assets: assetsFor(prefabs), expandDeferred: true });
        expect(under(w, made.root)).toEqual(['outer', 'inner', 'i1']);
        expect(deferredEntities(w)).toEqual([]);
    });

    it('forgets a virtual instance with its entity', async () => {
        const prefabs = { p: prefab('p', ['a']) };
        const w = world();
        await loadSceneWithAssets(w, sceneOf(entry(2, 'p', [mark()])), { assets: assetsFor(prefabs) });
        const p = find(w, 'p');
        expect(deferredRecord(w, p)).toBeDefined();
        w.despawn(p);
        expect(deferredRecord(w, p)).toBeUndefined(); expect(deferredEntities(w)).toEqual([]);
    });

    it('a page that is not a virtual instance, or has no name, cannot be registered as one', async () => {
        const w = world();
        const pages = new UIPages(w, assetsFor({}));
        const plain = w.spawn(); w.insert(plain, Name, { value: 'plain' });
        expect(pages.registerDeferred(plain)).toBeNull();
    });
});
