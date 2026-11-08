// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import { Assets } from '../src/asset/AssetPlugin';
import type { Assets as AssetsApi } from '../src/asset/Assets';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';
import { PlacedFoliage, PlacedFoliagePlugin } from '../src/foliage/placedFoliage';
import { prepareKinds, releaseKinds, PlantGrowth, type GrownCell } from '../src/foliage/plantGrowth';
import type { PlacedKind } from '../src/foliage/plantKind';
import { WorldGen, WorldGenPlugin, WorldGenRes } from '../src/worldgen/worldgenPlugin';
import type { WorldRules } from '../src/worldgen/rules';
import { WorldStreamingSource } from '../src/residency/components';
import { chunksOf } from '../src/residency/chunks';
import { createMockModule } from './mocks/wasm';

const kind: PlacedKind = {
    parts: [{ mesh: 'leaf.mesh', lod1Mesh: '', material: 'leaf.material', texture: 'leaf.png', soft: .5, tint: [1,1,1,1], opaque: true }],
    lodDistance: 20, drawDistance: 30, far: [], farDistance: 0,
};
const rules: WorldRules = {
    id: 'test:lifetime', versions: [1], plants: { leaf: kind },
    biomes: [{ id: 'plain', conditions: [], recipes: [{ recipe: 'leaf', layer: 'plants', density: 1 }] }],
    recipes: [{ id: 'leaf', version: 1, anchor: { id: 'leaf', plant: 'leaf', footprint: .1 } }],
    layers: [{ id: 'plants', spacing: 10, drawDistance: 30, chunkSize: 16 }],
};
function triangle(): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    return { channels, vertexStride, vertexCount: 3,
        vertices: new Uint8Array(new Float32Array([0,0,0,0,0,1, 1,0,0,0,0,1, 0,1,0,0,0,1]).buffer),
        indices: new Uint32Array([0,1,2]), aabbMin: [0,0,0], aabbMax: [1,1,0] };
}
function assetFixture() {
    let next = 1;
    const receipts = new Set<number>(), generated = new Set<number>(), handles = new Map<string, number>();
    const calls: string[] = [];
    let barrier: Promise<void> | undefined;
    let heldType = '';
    let fail = '';
    const acquire = async (type: string, path: string) => {
        calls.push(`${type}:${path}`);
        if (barrier && (!heldType || heldType === type)) await barrier;
        if (type === fail) throw new Error('test failed ' + type);
        const id = next++; receipts.add(id);
        const key = `${type}:${path}`;
        if (!handles.has(key)) handles.set(key, next++);
        const value = type === 'world-rules' ? rules : { handle: handles.get(key)! };
        return ownedAssetLease(key, 1, value, () => { receipts.delete(id); });
    };
    const api = {
        acquireTyped: acquire, acquireTexture: (path: string) => acquire('texture', path),
        readMeshData: async () => triangle(),
        createMesh: () => { const h = next++; generated.add(h); return h; },
        releaseBuiltMesh: (h: number) => { generated.delete(h); },
        onInvalidate: () => () => {}, resolveLoadPath: (path: string) => path,
    } as unknown as AssetsApi;
    return { api, receipts, generated, calls, hold: (p: Promise<void> | undefined, type = '') => { barrier = p; heldType = type; }, fail: (type: string) => { fail = type; } };
}
function boot(assets: AssetsApi) {
    setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
    const app = App.new(), module = createMockModule(); app.connectCpp(module.getRegistry(), module);
    app.insertResource(Assets, assets);
    const source = app.world.spawn(); app.world.insert(source, Transform, {}); app.world.insert(source, WorldStreamingSource, {});
    return app;
}
const tick = async (app: App, count = 20) => { for (let n=0;n<count;n++) { await app.tick(1/60); await Promise.resolve(); } };

describe('owned asset receipts', () => {
    it('disposes once after the last holder and never resurrects a spent receipt', () => {
        const dispose = vi.fn(), owner = ownedAssetLease('mesh', 7, {}, dispose), child = owner.retain()!;
        owner.release(); owner.release(); expect(owner.retain()).toBeNull(); expect(dispose).not.toHaveBeenCalled();
        const last = child.retain()!; child.release(); expect(dispose).not.toHaveBeenCalled();
        last.release(); last.release(); expect(last.retain()).toBeNull(); expect(dispose).toHaveBeenCalledTimes(1);
    });
});
describe('foliage resource lifetime', () => {
    it('shares assets and softened geometry across tint variants, then returns every acquisition', async () => {
        const f=assetFixture(), ready=await prepareKinds(f.api,[kind,kind]);
        expect(f.calls).toEqual(['mesh:leaf.mesh','material:leaf.material','texture:leaf.png']);
        expect(ready.kinds[0]![0]!.mesh).toBe(ready.kinds[1]![0]!.mesh);
        expect(f.generated.size).toBe(1); releaseKinds(ready);
        expect(f.receipts.size).toBe(0); expect(f.generated.size).toBe(0);
    });
    it('rolls back partial preparation, including composed meshes, if a material fails', async () => {
        const f=assetFixture(); f.fail('material');
        await expect(prepareKinds(f.api,[kind])).rejects.toThrow('test failed');
        expect(f.receipts.size).toBe(0); expect(f.generated.size).toBe(0);
    });
    it('keeps a retiring generation alive for a published cell and cancels its queued growth on release', async () => {
        const f=assetFixture(),app=boot(f.api),ready=await prepareKinds(f.api,[kind]),growth=new PlantGrowth();
        const e=app.world.spawn();app.world.insert(e,Transform,{});
        const cell:GrownCell={entity:e,handles:[],dead:false};
        growth.growCell(app,cell,[kind],ready,new Map([[0,[{x:0,y:0,z:0,yaw:0,scale:1,phase:0,shade:1}]]]));
        releaseKinds(ready);expect(f.generated.size).toBe(1);expect(f.receipts.size).toBe(3);
        growth.release(app,cell);growth.step(app);expect(growth.made).toBe(0);
        expect(f.generated.size).toBe(0);expect(f.receipts.size).toBe(0);
    });
    it('releases late preparation after a placed field has disappeared', async () => {
        const f=assetFixture();let resume!:()=>void;f.hold(new Promise<void>(r=>{resume=r;}));
        const app=boot(f.api);app.addPlugin(new PlacedFoliagePlugin());const e=app.world.spawn();
        app.world.insert(e,Transform,{});app.world.insert(e,PlacedFoliage,{kinds:[kind],records:[0,0,0,0,0,1]});
        await tick(app,1);app.world.despawn(e);await tick(app,1);f.hold(undefined);resume();await tick(app);
        expect(f.receipts.size).toBe(0);expect(f.generated.size).toBe(0);
    });
    it('bounds resources across generated-world seed changes and releases them after removal', async () => {
        const f=assetFixture(),app=boot(f.api);app.addPlugin(new WorldGenPlugin());const e=app.world.spawn();
        app.world.insert(e,Transform,{});app.world.insert(e,WorldGen,{rules:'forest.esworld',world:'lifetime',seed:1});
        await tick(app,60);expect(app.getResource(WorldGenRes).status(e)?.state).toBe('ready');
        const baseline=f.receipts.size;expect(baseline).toBe(4);expect(f.generated.size).toBe(1);
        for(let seed=2;seed<6;seed++){
            app.world.insert(e,WorldGen,{rules:'forest.esworld',world:'lifetime',seed});await tick(app,60);
            expect(f.receipts.size).toBe(baseline);expect(f.generated.size).toBe(1);
        }
        app.world.despawn(e);await tick(app);expect(f.receipts.size).toBe(0);expect(f.generated.size).toBe(0);
        expect(chunksOf(app).pending).toBe(0);
    });
    it('releases a late world-rules acquisition after the generator was removed', async () => {
        const f=assetFixture();let resume!:()=>void;f.hold(new Promise<void>(r=>{resume=r;}));
        const app=boot(f.api);app.addPlugin(new WorldGenPlugin());const e=app.world.spawn();
        app.world.insert(e,Transform,{});app.world.insert(e,WorldGen,{rules:'forest.esworld',world:'late'});
        await tick(app,1);app.world.despawn(e);await tick(app,1);f.hold(undefined);resume();await tick(app);
        expect(f.receipts.size).toBe(0);expect(f.generated.size).toBe(0);
    });
    it('releases late plant preparation after a generated world was removed', async () => {
        const f=assetFixture();let resume!:()=>void;f.hold(new Promise<void>(r=>{resume=r;}),'mesh');
        const app=boot(f.api);app.addPlugin(new WorldGenPlugin());const e=app.world.spawn();
        app.world.insert(e,Transform,{});app.world.insert(e,WorldGen,{rules:'forest.esworld',world:'late-plants'});
        await tick(app,4);expect(f.calls).toContain('mesh:leaf.mesh');app.world.despawn(e);await tick(app,1);
        f.hold(undefined);resume();await tick(app);
        expect(f.receipts.size).toBe(0);expect(f.generated.size).toBe(0);
    });
    it('releases replaced placed-foliage generations after their cells have changed', async () => {
        const f=assetFixture(),app=boot(f.api);app.addPlugin(new PlacedFoliagePlugin());const e=app.world.spawn();
        app.world.insert(e,Transform,{});
        for(let x=0;x<4;x++) {
            app.world.insert(e,PlacedFoliage,{sizeX:32,sizeZ:32,cellSize:16,kinds:[kind],records:[0,x,0,0,0,1]});
            await tick(app,30);expect(f.receipts.size).toBe(3);expect(f.generated.size).toBe(1);
        }
        app.world.despawn(e);await tick(app);expect(f.receipts.size).toBe(0);expect(f.generated.size).toBe(0);
    });
});
