// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Children, Name, Transform } from '../src/ecs/component';
import type { ChildrenData, NameData } from '../src/ecs/component';
import { isEntityActive } from '../src/ecs/entityUtils';
import type { PrefabData } from '../src/prefab';
import type { Assets } from '../src/asset/Assets';
import type { Entity } from '../src/types';
import { UIPages } from '../src/ui/pages/ui-pages';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

const page = (name: string, kids: string[]): PrefabData => ({
    version: '2', name, rootEntityId: 'root',
    entities: [
        { prefabEntityId: 'root', name, parent: null, children: kids.map((k) => 'e-' + k), visible: true, components: [{ type: 'Transform', data: {} }] },
        ...kids.map((k) => ({ prefabEntityId: 'e-' + k, name: k, parent: 'root', children: [], visible: true, components: [{ type: 'Transform', data: {} }] })),
    ],
});

describe.skipIf(!HAS_WASM)('UIPages', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    const setup = (prefabs: Record<string, PrefabData>) => {
        const world = new World();
        world.connectCpp(new engine.Registry() as unknown as CppRegistry, engine);
        const loads: string[] = [];
        const assets = {
            loadPrefab: async (ref: string) => { loads.push(ref); const data = prefabs[ref]; if (!data) throw new Error('no such prefab ' + ref); return { data }; },
            acquireTyped: async () => { throw new Error('this test has no nested prefabs'); },
            // What loading a scene asks of the asset system: nothing to fetch here, nothing missing.
            preloadSceneAssets: async () => ({ scope: { releaseAll() {}, absorb() {} }, missing: [], textureHandles: new Map(), materialHandles: new Map() }),
            resolveSceneAssetPaths() {},
            trackSceneAssetReferences() {},
        } as unknown as Assets;
        return { world, pages: new UIPages(world, assets), loads };
    };
    const namesUnder = (world: World, root: Entity): string[] => {
        const out: string[] = [];
        const walk = (e: Entity): void => {
            if (world.has(e, Name)) out.push((world.get(e, Name) as NameData).value);
            if (world.has(e, Children)) for (const c of (world.get(e, Children) as ChildrenData).entities) walk(c);
        };
        walk(root);
        return out;
    };
    const mountIn = (world: World, name: string): Entity => {
        const e = world.spawn();
        world.insert(e, Name, { value: name });
        world.insert(e, Transform, {} as never);
        return e;
    };

    it('builds a page the first time it is opened, once however many ask, and finds its nodes by name', async () => {
        const { world, pages, loads } = setup({ home: page('home', ['title', 'ok']) });
        const parent = mountIn(world, 'canvas');
        pages.register('home', { prefab: 'home', parent });
        expect(pages.isBuilt('home')).toBe(false);
        let built = 0; pages.onBuilt(() => { built++; });
        const [a, b] = await Promise.all([pages.open('home'), pages.open('home')]);
        expect(a).toBe(b);
        expect(built).toBe(1);
        expect(loads).toEqual(['home']);
        expect(pages.isBuilt('home')).toBe(true); expect(pages.isOpen('home')).toBe(true);
        expect(a.has('ok')).toBe(true); expect(a.has('nope')).toBe(false);
        expect(world.has(a.find('ok')!, Name)).toBe(true);
        expect([...a.names()].sort()).toEqual(['e-title'.slice(2), 'ok', 'home'].sort());
        expect((world.get(parent, Children) as ChildrenData).entities).toContain(a.root);
    });

    it('builds a mounted page under the mount, in order, and leaves no root of its own behind', async () => {
        const { world, pages } = setup({ shop: page('shop', ['a', 'b', 'c']) });
        const canvas = mountIn(world, 'canvas'), first = mountIn(world, 'first'), mount = mountIn(world, 'shop-mount'), last = mountIn(world, 'last');
        for (const e of [first, mount, last]) world.setParent(e, canvas);
        const before = world.getAllEntities().length;
        pages.register('shop', { prefab: 'shop', mount });
        const handle = await pages.open('shop');
        expect(handle.root).toBe(mount);
        expect(namesUnder(world, mount)).toEqual(['shop-mount', 'a', 'b', 'c']);
        expect(world.getAllEntities().length).toBe(before + 3);                      // three children, and no stray root
        expect((world.get(canvas, Children) as ChildrenData).entities).toEqual([first, mount, last]);   // it kept its place
    });

    it('applies the overrides it was registered with', async () => {
        const { world, pages } = setup({ p: page('p', ['x']) });
        const mount = mountIn(world, 'm');
        pages.register('p', { prefab: 'p', mount, overrides: [{ type: 'name', prefabEntityId: 'e-x', value: 'renamed' }] });
        const handle = await pages.open('p');
        expect(handle.has('renamed')).toBe(true); expect(handle.has('x')).toBe(false);
    });

    it('closing a kept page switches it off and opening it again is instant: nothing is built twice', async () => {
        const { world, pages, loads } = setup({ p: page('p', ['x']) });
        const mount = mountIn(world, 'm');
        pages.register('p', { prefab: 'p', mount });
        let built = 0; pages.onBuilt(() => { built++; });
        const first = await pages.open('p');
        const x = first.find('x')!;
        pages.close('p');
        expect(pages.isOpen('p')).toBe(false); expect(pages.isBuilt('p')).toBe(true);
        expect(isEntityActive(world, mount)).toBe(false);
        const again = await pages.open('p');
        expect(again).toBe(first); expect(again.find('x')).toBe(x);
        expect(isEntityActive(world, mount)).toBe(true);
        expect(built).toBe(1); expect(loads).toEqual(['p']);
    });

    it('closing a destroyed page takes its contents out of the world and the next open builds them again', async () => {
        const { world, pages, loads } = setup({ p: page('p', ['x', 'y']) });
        const mount = mountIn(world, 'm');
        pages.register('p', { prefab: 'p', mount, onClose: 'destroy' });
        const first = await pages.open('p');
        const x = first.find('x')!;
        pages.close('p');
        expect(world.valid(x)).toBe(false);
        expect(pages.isBuilt('p')).toBe(false); expect(pages.page('p')).toBeNull();
        expect(world.valid(mount)).toBe(true);                                       // the scene's mount stays
        expect(world.has(mount, Children) ? (world.get(mount, Children) as ChildrenData).entities.length : 0).toBe(0);
        const again = await pages.open('p');
        expect(again.has('x')).toBe(true); expect(again.find('x')).not.toBe(x);
        expect(isEntityActive(world, mount)).toBe(true);
        expect(loads).toEqual(['p']);                                                // the prefab is fetched once
    });

    it('a page given a parent has a root of its own, and destroying it removes that root', async () => {
        const { world, pages } = setup({ p: page('p', ['x']) });
        const parent = mountIn(world, 'canvas');
        pages.register('p', { prefab: 'p', parent, onClose: 'destroy' });
        const handle = await pages.open('p');
        expect(handle.root).not.toBe(parent);
        expect((world.get(parent, Children) as ChildrenData).entities).toEqual([handle.root]);
        pages.close('p');
        expect(world.valid(handle.root)).toBe(false);
        expect(world.has(parent, Children) ? (world.get(parent, Children) as ChildrenData).entities.length : 0).toBe(0);
    });

    it('looks for a name inside its own page: two pages can use the same one', async () => {
        const { world, pages } = setup({ a: page('a', ['ok']), b: page('b', ['ok']) });
        pages.register('a', { prefab: 'a', mount: mountIn(world, 'ma') });
        pages.register('b', { prefab: 'b', mount: mountIn(world, 'mb') });
        const [a, b] = [await pages.open('a'), await pages.open('b')];
        expect(a.find('ok')).not.toBe(b.find('ok'));
        expect(namesUnder(world, a.root)).toContain('ok'); expect(namesUnder(world, b.root)).toContain('ok');
    });

    it('tells the listener about each build with the page already in place, and the listener can be removed', async () => {
        const { world, pages } = setup({ a: page('a', ['ok']), b: page('b', ['ok']) });
        pages.register('a', { prefab: 'a', mount: mountIn(world, 'ma') });
        pages.register('b', { prefab: 'b', mount: mountIn(world, 'mb') });
        const seen: string[] = [];
        const off = pages.onBuilt((h) => { seen.push(h.id + ':' + h.has('ok')); });
        await pages.open('a'); off(); await pages.open('b');
        expect(seen).toEqual(['a:true']);
    });

    it('refuses what cannot work: an unknown page, a page twice, a page with nowhere to go', () => {
        const { world, pages } = setup({});
        expect(() => pages.isOpen('nope')).toThrow(/no page "nope"/);
        pages.register('p', { prefab: 'p', mount: mountIn(world, 'm') });
        expect(() => pages.register('p', { prefab: 'p', mount: mountIn(world, 'm2') })).toThrow(/already registered/);
        expect(() => pages.register('q', { prefab: 'q' })).toThrow(/mount or a parent/);
    });

    it('a prefab that fails to load rejects the open and is asked for again next time', async () => {
        const prefabs: Record<string, PrefabData> = {};
        const { world, pages, loads } = setup(prefabs);
        pages.register('p', { prefab: 'p', mount: mountIn(world, 'm') });
        await expect(pages.open('p')).rejects.toThrow(/no such prefab/);
        expect(pages.isBuilt('p')).toBe(false); expect(pages.isOpen('p')).toBe(false);
        prefabs.p = page('p', ['x']);
        const handle = await pages.open('p');
        expect(handle.has('x')).toBe(true);
        expect(loads).toEqual(['p', 'p']);
    });
});
