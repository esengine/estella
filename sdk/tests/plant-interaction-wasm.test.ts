// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The real engine and the real 3D solver under plants that can be touched: a character is stopped by a tree it walks into and not by one that was
 * felled, and what the engine is told to draw is read as it is told.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { MeshRenderer, Transform } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Assets } from '../src/asset/AssetPlugin';
import type { Assets as AssetsApi } from '../src/asset/Assets';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';
import { buildPlacements } from '../src/foliage/builder';
import { PlacedFoliage, PlacedFoliagePlugin } from '../src/foliage/placedFoliage';
import { FoliageContact, PlantInteractionRes, PlantProxy, plantInteractionOf, type PlantEvent, type PlantRef } from '../src/foliage/plantInteraction';
import { contactMemory, contactPlaces } from '../src/foliage/foliageContacts';
import type { PlacedKind } from '../src/foliage/plantKind';
import { WorldStreamingSource } from '../src/residency/components';
import { Physics3D, Physics3DPlugin } from '../src/physics3d/Physics3DPlugin';
import { Physics3DRuntime } from '../src/physics3d/physics3dRuntime';
import { CapsuleCollider3D, CharacterController3D, RigidBody3D, BoxCollider3D } from '../src/physics3d/Physics3DComponents';
import { expandPlants } from '../src/worldgen/plants';
import { WorldGen, WorldGenPlugin } from '../src/worldgen/worldgenPlugin';
import type { WorldRules } from '../src/worldgen/rules';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

const part = (mesh: string): PlacedKind['parts'][number] => ({ mesh, lod1Mesh: '', material: '', texture: '', tint: [1, 1, 1, 1], opaque: true });
const TREE: PlacedKind = {
    parts: [part('tree.mesh')], lodDistance: 0, drawDistance: 500, far: [], farDistance: 0,
    interaction: { activationDistance: 10, radius: 0.5, height: 6, health: 3, felledKind: 1, fallSeconds: 1, lieSeconds: 1, regrowSeconds: 0 },
};
const STUMP: PlacedKind = { parts: [part('stump.mesh')], lodDistance: 0, drawDistance: 500, far: [], farDistance: 0 };
const BUSH: PlacedKind = {
    parts: [part('bush.mesh')], lodDistance: 0, drawDistance: 500, far: [], farDistance: 0,
    interaction: { activationDistance: 6, bend: 0.5, yields: 3, harvestedKind: 3, regrowSeconds: 2 },
};
const BARE: PlacedKind = { parts: [part('bare.mesh')], lodDistance: 0, drawDistance: 500, far: [], farDistance: 0 };
const FAR_TREE: PlacedKind = { ...TREE, far: [part('card.mesh')], farDistance: 2000, drawDistance: 40 };

function triangle(): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    return {
        channels, vertexStride, vertexCount: 3,
        vertices: new Uint8Array(new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]).buffer),
        indices: new Uint32Array([0, 1, 2]), aabbMin: [0, 0, 0], aabbMax: [1, 1, 0],
    };
}

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => {
    while (apps.length) apps.pop()!.quit?.();
    setEditorMode(false); setPlayMode(false);
    vi.restoreAllMocks();
});

interface Scene {
    app: App; world: App['world'];
    receipts: Set<number>;
    /** The last placements the engine was told for each set, by entity: x of each plant, and the whole floats. */
    drawn: Map<Entity, Float32Array>;
    writes: { n: number };
    /** The plants the engine draws of one mesh, all sets together. */
    countOf(mesh: string): number;
    meshHandle(mesh: string): number;
    tick(n?: number): Promise<void>;
    contact(x: number, z: number, fields?: Record<string, unknown>): Entity;
    plants(): ReturnType<typeof plantInteractionOf>;
    field(kinds: PlacedKind[], records: number[], fields?: Record<string, unknown>): Promise<Entity>;
}

async function scene(options: { physics?: boolean; rules?: WorldRules } = {}): Promise<Scene> {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    if (options.physics) {
        const module = await loadSideModule<Physics3DWasmModule>('physics3d');
        app.addPlugin(new Physics3DPlugin('', { fixedTimestep: 1 / 60, pixelsPerUnit: 1 }, async () => module));
        await app.getResource(Physics3DRuntime).initPromise;
    }
    let next = 1;
    const handles = new Map<string, number>(), receipts = new Set<number>();
    const acquire = async (type: string, path: string) => {
        const id = next++; receipts.add(id);
        const key = `${type}:${path}`;
        if (!handles.has(key)) handles.set(key, next++);
        return ownedAssetLease(key, 1, type === 'world-rules' ? options.rules : { handle: handles.get(key)! }, () => { receipts.delete(id); });
    };
    app.insertResource(Assets, {
        acquireTyped: acquire, acquireTexture: (path: string) => acquire('texture', path),
        readMeshData: async () => triangle(), createMesh: () => next++, releaseBuiltMesh: () => {},
        onInvalidate: () => () => {}, resolveLoadPath: (p: string) => p,
    } as unknown as AssetsApi);
    const drawn = new Map<Entity, Float32Array>(), writes = { n: 0 };
    // Read as the engine is told it: through the module, whichever way it is called.
    const mod = core as unknown as { HEAPU8: Uint8Array; meshInstances_set: (registry: unknown, entity: number, ptr: number, count: number) => void };
    const real = mod.meshInstances_set.bind(mod);
    vi.spyOn(mod, 'meshInstances_set').mockImplementation((registry, entity, ptr, count) => {
        writes.n++;
        drawn.set(entity as Entity, count > 0 ? new Float32Array(mod.HEAPU8.buffer, ptr, count * 16).slice() : new Float32Array(0));
        real(registry, entity, ptr, count);
    });
    const source = app.world.spawn(); app.world.insert(source, Transform, {}); app.world.insert(source, WorldStreamingSource, {});
    app.addPlugin(new PlacedFoliagePlugin());
    const world = app.world;
    const s: Scene = {
        app, world, receipts, drawn, writes,
        meshHandle: (mesh) => handles.get(`mesh:${mesh}`) ?? -1,
        countOf: (mesh) => {
            let n = 0;
            for (const [e, data] of drawn) {
                if (!world.valid(e)) continue;
                const r = world.tryGet(e, MeshRenderer) as { mesh: number } | null;
                if (r?.mesh === handles.get(`mesh:${mesh}`)) n += data.length / 16;
            }
            return n;
        },
        tick: async (n = 1) => { for (let i = 0; i < n; i++) { await app.tick(1 / 60); await Promise.resolve(); } },
        contact: (x, z, fields = {}) => {
            const e = world.spawn();
            world.insert(e, Transform, { position: { x, y: 0, z } });
            world.insert(e, FoliageContact, { radius: 3, ...fields });
            return e;
        },
        plants: () => plantInteractionOf(app),
        field: async (kinds, records, fields = {}) => {
            const e = world.spawn('Wood');
            world.insert(e, Transform, {});
            world.insert(e, PlacedFoliage, { sizeX: 400, sizeZ: 400, cellSize: 50, kinds, records, ...fields });
            await s.tick(30);
            return e;
        },
    };
    return s;
}

const move = (s: Scene, e: Entity, x: number, z: number): void => {
    s.world.update(e, Transform, (t) => { t.position.x = x; t.position.z = z; });
};
const proxies = (s: Scene): Entity[] => [...s.world.getEntitiesWithComponents([PlantProxy])];
const one = (s: Scene, key = '0'): PlantRef => s.plants().find('placed:Wood', key)!;

describe.skipIf(!HAS_WASM)('plants that can be touched', () => {
    beforeAll(async () => { core = await loadWasmModule(); });

    describe('from data to an entity and back', () => {
        it('stays data with nothing near, and is one entity with something near', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1, 0, 100, 0, 0, 0, 1]);
            expect(proxies(s)).toHaveLength(0);
            expect(s.countOf('tree.mesh')).toBe(2);
            const c = s.contact(5, 0);
            await s.tick(10);
            expect(proxies(s)).toHaveLength(1);
            const p = s.world.get(proxies(s)[0]!, PlantProxy);
            expect(p.key).toBe('0');
            // The picture never changes hands, so nothing pops.
            expect(s.countOf('tree.mesh')).toBe(2);
            move(s, c, 100, 100);
            await s.tick(10);
            expect(proxies(s)).toHaveLength(0);
            expect(s.plants().activeCount).toBe(0);
        });

        it('does not flicker at the edge of its reach', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            const heard: PlantEvent[] = [];
            const c = s.contact(9.9, 0);
            await s.tick(1);
            s.plants().on((e) => heard.push(e));
            await s.tick(10);
            const entered = proxies(s).length;
            expect(entered).toBe(1);
            for (let i = 0; i < 10; i++) { move(s, c, i % 2 ? 9.9 : 11, 0); await s.tick(7); }
            expect(heard.filter((e) => e.type === 'deactivated')).toHaveLength(0);
        });

        it('makes only so many a frame, and no more than it holds', async () => {
            const s = await scene();
            const records: number[] = [];
            for (let i = 0; i < 40; i++) records.push(0, i * 0.1, 0, 0, 0, 1);
            await s.field([TREE, STUMP], records);
            s.plants().maxActivatedPerFrame = 8;
            s.plants().maxActive = 20;
            s.contact(2, 0);
            await s.tick(7);
            expect(proxies(s).length).toBeGreaterThan(0);
            expect(proxies(s).length).toBeLessThanOrEqual(8);
            await s.tick(60);
            expect(proxies(s)).toHaveLength(20);
        });

        it('lets go of its entities with its cell', async () => {
            const s = await scene();
            const f = await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            s.contact(1, 0);
            await s.tick(10);
            expect(proxies(s)).toHaveLength(1);
            s.world.despawn(f);
            // Sooner than the next look round for what is near.
            await s.tick(2);
            expect(proxies(s)).toHaveLength(0);
            await s.tick(10);
            expect(s.receipts.size).toBe(0);
        });

        it('does nothing in the editor', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            setEditorMode(true); setPlayMode(false);
            s.contact(1, 0);
            await s.tick(10);
            expect(proxies(s)).toHaveLength(0);
        });

        it('gives no body to a kind with no capsule', async () => {
            const s = await scene({ physics: true });
            await s.field([BUSH], [0, 0, 0, 0, 0, 1]);
            s.contact(1, 0);
            await s.tick(10);
            expect(proxies(s)).toHaveLength(1);
            expect(s.world.has(proxies(s)[0]!, RigidBody3D)).toBe(false);
        });

        it('leaves a kind with no interaction exactly as it was', async () => {
            const s = await scene();
            await s.field([STUMP], [0, 0, 0, 0, 0, 1]);
            s.contact(0.5, 0);
            await s.tick(10);
            expect(s.app.hasResource(PlantInteractionRes)).toBe(false);
            expect(s.countOf('stump.mesh')).toBe(1);
        });
    });

    describe.skipIf(!hasSideModule('physics3d'))('on the real solver', () => {
        const walker = (s: Scene, x: number) => {
            const e = s.world.spawn();
            s.world.insert(e, Transform, { position: { x, y: 1, z: 0 } });
            s.world.insert(e, CharacterController3D, { radius: 0.3, halfHeight: 0.5, velocity: { x: 3, y: 0, z: 0 } });
            s.world.insert(e, FoliageContact, { radius: 1 });
            return e;
        };
        const floor = (s: Scene) => {
            const e = s.world.spawn();
            s.world.insert(e, Transform, { position: { x: 0, y: -1, z: 0 } });
            s.world.insert(e, RigidBody3D, { bodyType: 0 });
            s.world.insert(e, BoxCollider3D, { halfExtents: { x: 100, y: 1, z: 100 } });
        };
        const at = (s: Scene, e: Entity) => s.world.get(e, Transform).position;

        it('gives a near plant a capsule its size, standing on its foot', async () => {
            const s = await scene({ physics: true });
            await s.field([TREE, STUMP], [0, 3, 0, 0, 0, 2]);
            s.contact(4, 0);
            await s.tick(10);
            const [proxy] = proxies(s);
            const c = s.world.get(proxy!, CapsuleCollider3D);
            expect(c.radius).toBeCloseTo(1);
            expect(c.halfHeight).toBeCloseTo(6 - 1);
            expect(c.center!.y).toBeCloseTo(6);
            expect(s.world.get(proxy!, RigidBody3D).bodyType).toBe(0);
        });

        it('stops a character that walks into it, and a ray finds which plant', async () => {
            const s = await scene({ physics: true });
            floor(s);
            await s.field([TREE, STUMP], [0, 8, 0, 0, 0, 1]);
            const w = walker(s, 0);
            await s.tick(240);
            expect(at(s, w).x).toBeGreaterThan(6);
            expect(at(s, w).x).toBeLessThan(7.5);
            const hit = s.app.getResource(Physics3D)!.raycast({ x: 0, y: 2, z: 0 }, { x: 100, y: 0, z: 0 });
            expect(hit).not.toBeNull();
            expect(s.plants().of(hit!.entity as Entity)?.key).toBe('0');
        });

        it('is stopped by a tree that came down across its path, while it lies', async () => {
            const s = await scene({ physics: true });
            floor(s);
            const lying = { ...TREE, interaction: { ...TREE.interaction, lieSeconds: 100 } };
            await s.field([lying, STUMP], [0, 8, 0, -3, 0, 1]);
            const heard: string[] = [];
            s.plants().on((e) => heard.push(e.type));
            s.plants().fell(one(s), { x: 0, z: 1 });
            await s.tick(90);
            expect(heard).toContain('landed');
            const w = walker(s, 0);
            await s.tick(240);
            expect(at(s, w).x).toBeGreaterThan(5);
            expect(at(s, w).x).toBeLessThan(8);
        });

        it('lets it through once the tree is felled and gone', async () => {
            const s = await scene({ physics: true });
            floor(s);
            await s.field([TREE, STUMP], [0, 8, 0, 0, 0, 1]);
            const w = walker(s, 0);
            await s.tick(240);
            const stopped = at(s, w).x;
            s.plants().fell(one(s), { x: 0, z: 1 });
            await s.tick(300);
            expect(at(s, w).x).toBeGreaterThan(stopped + 3);
        });
    });

    describe('felling', () => {
        it('takes health a blow at a time, and comes down away from the last', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            const heard: string[] = [];
            s.plants().on((e) => heard.push(e.type));
            expect(s.plants().damage(one(s), 1)).toBe(true);
            expect(one(s).health).toBe(2);
            s.plants().damage(one(s), 1);
            expect(one(s).health).toBe(1);
            expect(one(s).state).toBe('standing');
            expect(s.countOf('tree.mesh')).toBe(1);
            s.plants().damage(one(s), 5, { x: -3, z: 0 });
            expect(one(s).state).toBe('felled');
            expect(heard).toEqual(['damaged', 'damaged', 'damaged', 'felled']);
            await s.tick(40);
            // Away from the blow: toward +x, so the top of it has gone that way.
            const root = s.world.getEntitiesWithComponents([PlantProxy, Transform]).find((e) => s.world.get(e, PlantProxy).key === '0');
            const r = s.world.get(root!, Transform).rotation;
            const topX = 2 * (r.x * r.y + r.w * r.z);
            expect(-Math.abs(r.z)).toBeLessThan(-0.1);
            expect(topX).toBeLessThan(0);
        });

        it('leaves the placements at once and a stump in its place', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1]);
            s.plants().fell(one(s));
            expect(s.countOf('tree.mesh')).toBe(1);
            expect(s.countOf('stump.mesh')).toBe(1);
        });

        it('comes down, tells when it lands, lies, and goes, giving back what it held', async () => {
            const s = await scene();
            const f = await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            const heard: string[] = [];
            s.plants().on((e) => heard.push(e.type));
            s.plants().fell(one(s), { x: 1, z: 0 });
            const count = () => s.world.getEntitiesWithComponents([PlantProxy]).length;
            expect(count()).toBe(1);
            await s.tick(30);
            expect(heard).not.toContain('landed');
            await s.tick(40);
            expect(heard).toContain('landed');
            s.world.despawn(f);
            await s.tick(30);
            // The field has gone and the tree is still lying: what it draws with is still held.
            expect(s.receipts.size).toBeGreaterThan(0);
            await s.tick(180);
            expect(count()).toBe(0);
            expect(s.receipts.size).toBe(0);
        });

        it('does not fell what is not standing, nor hurt what has no health', async () => {
            const s = await scene();
            await s.field([{ ...TREE, interaction: { ...TREE.interaction, health: 0 } }, STUMP], [0, 0, 0, 0, 0, 1]);
            expect(s.plants().damage(one(s), 1)).toBe(false);
            expect(one(s).state).toBe('standing');
            expect(s.plants().fell(one(s))).toBe(true);
            expect(s.plants().fell(one(s))).toBe(false);
            expect(s.countOf('stump.mesh')).toBe(1);
        });

        it('takes it out of its far version too, and leaves the others', async () => {
            const s = await scene();
            await s.field([FAR_TREE, STUMP], [0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1]);
            expect(s.countOf('card.mesh')).toBe(2);
            s.plants().fell(one(s));
            expect(s.countOf('card.mesh')).toBe(1);
        });
    });

    describe('harvest', () => {
        it('gives what it has, then turns bare, then grows back', async () => {
            const s = await scene();
            await s.field([TREE, STUMP, BUSH, BARE], [2, 0, 0, 0, 0, 1]);
            const heard: string[] = [];
            s.plants().on((e) => heard.push(e.type));
            expect(s.plants().harvest(one(s), 2)).toBe(2);
            expect(one(s).yields).toBe(1);
            expect(s.countOf('bush.mesh')).toBe(1);
            expect(s.plants().harvest(one(s), 5)).toBe(1);
            expect(one(s).state).toBe('harvested');
            expect(s.countOf('bush.mesh')).toBe(0);
            expect(s.countOf('bare.mesh')).toBe(1);
            expect(s.plants().harvest(one(s), 1)).toBe(0);
            await s.tick(130);
            expect(heard).toContain('regrown');
            expect(one(s).state).toBe('standing');
            expect(one(s).yields).toBe(3);
            expect(s.countOf('bush.mesh')).toBe(1);
            expect(s.countOf('bare.mesh')).toBe(0);
        });

        it('grows back from small, and ends at its own size', async () => {
            const s = await scene();
            const e = await s.field([TREE, STUMP, BUSH, BARE], [2, 0, 0, 0, 0, 2]);
            void e;
            s.plants().harvest(one(s), 3);
            await s.tick(125);
            const scales = (): number[] => [...s.drawn.values()].filter((d) => d.length === 16).map((d) => d[5]!);
            expect(Math.min(...scales())).toBeLessThan(0.6);
            await s.tick(100);
            expect(Math.max(...scales())).toBeCloseTo(2, 3);
        });

        it('cannot be harvested where the kind has nothing to give', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            expect(s.plants().harvest(one(s))).toBe(0);
        });
    });

    describe('what lasts', () => {
        it('keeps a felled tree felled when its cell is let go and grown again', async () => {
            const s = await scene();
            await s.field([{ ...TREE, drawDistance: 60 }, { ...STUMP, drawDistance: 60 }], [0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1], { sizeX: 2000, sizeZ: 2000 });
            s.plants().fell(one(s));
            const source = s.world.getEntitiesWithComponents([WorldStreamingSource])[0]!;
            move(s, source, 900, 900);
            await s.tick(60);
            expect(s.plants().find('placed:Wood', '0')).toBeNull();
            move(s, source, 0, 0);
            await s.tick(60);
            expect(one(s).state).toBe('felled');
            expect(s.countOf('tree.mesh')).toBe(1);
            expect(s.countOf('stump.mesh')).toBe(1);
        });

        it('saves what became of each plant, and a new game reads it back', async () => {
            const first = await scene();
            await first.field([TREE, STUMP, BUSH, BARE], [0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1, 2, 6, 0, 0, 0, 1, 0, 9, 0, 0, 0, 1]);
            await first.tick(300);
            first.plants().fell(one(first, '0'));
            first.plants().damage(one(first, '1'), 1);
            first.plants().harvest(one(first, '2'), 3);
            const saved = JSON.parse(JSON.stringify(first.plants().saveState())) as ReturnType<ReturnType<typeof plantInteractionOf>['saveState']>;
            expect(saved.plants).toHaveLength(3);

            const second = await scene();
            await second.field([TREE, STUMP, BUSH, BARE], [0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 1, 2, 6, 0, 0, 0, 1, 0, 9, 0, 0, 0, 1]);
            second.plants().loadState(saved);
            expect(one(second, '0').state).toBe('felled');
            expect(one(second, '1').health).toBe(2);
            expect(one(second, '2').state).toBe('harvested');
            expect(one(second, '3').state).toBe('standing');
            expect(second.countOf('tree.mesh')).toBe(2);
            expect(second.countOf('stump.mesh')).toBe(1);
            expect(second.countOf('bare.mesh')).toBe(1);
            expect(second.countOf('bush.mesh')).toBe(0);
            // The clock came with it: a bush that had two seconds left still has them.
            await second.tick(130);
            expect(one(second, '2').state).toBe('standing');
        });

        it('applies a save before its cells are grown', async () => {
            const first = await scene();
            await first.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            first.plants().fell(one(first));
            const saved = first.plants().saveState();
            const second = await scene();
            second.plants().loadState(saved);
            await second.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            expect(second.countOf('tree.mesh')).toBe(0);
            expect(second.countOf('stump.mesh')).toBe(1);
        });

        it('keeps states of two fields apart by their names', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1], { stateKey: 'north' });
            await s.field([TREE, STUMP], [0, 20, 0, 0, 0, 1], { stateKey: 'south' });
            s.plants().fell(s.plants().find('placed:north', '0')!);
            expect(s.plants().find('placed:south', '0')!.state).toBe('standing');
        });

        it('refuses a save from a version it does not read', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 0, 0, 0, 0, 1]);
            expect(() => s.plants().loadState({ version: 9 } as never)).toThrow(/version 9/);
        });

        it('finds what is near, nearest first, and not what is cut', async () => {
            const s = await scene();
            await s.field([TREE, STUMP], [0, 10, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 100, 0, 0, 0, 1]);
            expect(s.plants().near(0, 0, 20).map((p) => p.key)).toEqual(['1', '0']);
            s.plants().remove(one(s, '1'));
            expect(s.plants().near(0, 0, 20).map((p) => p.key)).toEqual(['0']);
        });
    });

    describe('leaning', () => {
        it('leans a shrub away from what touches it, and stands up after, with any material', async () => {
            const s = await scene();
            await s.field([TREE, STUMP, BUSH, BARE], [2, 0, 0, 0, 0, 1]);
            const c = s.contact(-1, 0);
            await s.tick(60);
            const set = [...s.drawn.values()].find((d) => d.length === 16)!;
            const lean = () => [...s.drawn.values()].filter((d) => d.length === 16).map((d) => d[1]!)[0]!;
            expect(set).toBeDefined();
            expect(lean()).toBeGreaterThan(0.05);
            expect(lean()).toBeLessThan(Math.tan(0.5) + 0.01);
            move(s, c, 100, 100);
            await s.tick(60);
            expect(lean()).toBeCloseTo(0, 3);
        });

        it('writes nothing while nothing moves', async () => {
            const s = await scene();
            await s.field([TREE, STUMP, BUSH, BARE], [2, 0, 0, 0, 0, 1]);
            s.contact(-1, 0);
            await s.tick(180);
            const before = s.writes.n;
            await s.tick(30);
            expect(s.writes.n).toBe(before);
        });

        it('shears the placement along its height', () => {
            const [m] = [buildPlacements([{ x: 5, y: 0, z: 0, yaw: 0, scale: 2, phase: 0, shade: 1, shear: [0.25, -0.5] }])];
            // A point at height 1 of the model: 2 up, and over by what the shear says, scaled with it.
            expect(m![1]).toBeCloseTo(0.5);
            expect(m![9]).toBeCloseTo(-1);
            expect(m![5]).toBeCloseTo(2);
            expect(m![3]).toBe(5);
        });
    });

    describe('the contacts grass is told about', () => {
        const contact = (id: number, x: number, z = 0, radius = 10) => ({ id, x, y: 0, z, radius, strength: 1, recovery: 1 });

        it('fills the four places, the rest reaching nowhere', () => {
            const p = contactPlaces([contact(1, 3, 4)], contactMemory(), null, 1 / 60);
            expect(p).toHaveLength(4);
            expect(p[0]).toEqual({ x: 3, y: 0, z: 4, w: 10 });
            expect(p[1]!.w).toBe(0);
        });

        it('takes the contacts nearest what is looked from', () => {
            const p = contactPlaces([contact(1, 100), contact(2, 5), contact(3, 50), contact(4, 200), contact(5, 1)], contactMemory(), { x: 0, z: 0 }, 1 / 60);
            expect(p.map((c) => c.x)).toEqual([1, 5, 50, 100]);
        });

        it('leaves a place behind as it moves on, which closes', () => {
            const memory = contactMemory();
            contactPlaces([contact(1, 0)], memory, null, 0);
            let p = contactPlaces([contact(1, 8)], memory, null, 0);
            expect(p[1]).toEqual({ x: 0, y: 0, z: 0, w: 10 });
            p = contactPlaces([contact(1, 8)], memory, null, 0.5);
            expect(p[1]!.w).toBeCloseTo(5);
            p = contactPlaces([contact(1, 8)], memory, null, 0.6);
            expect(p[1]!.w).toBe(0);
        });

        it('leaves nothing behind while it stands', () => {
            const memory = contactMemory();
            for (let i = 0; i < 10; i++) contactPlaces([contact(1, i * 0.1)], memory, null, 1 / 60);
            expect(memory.trails.size).toBe(0);
        });

        it('keeps a contact above what it left, however many it left', () => {
            const memory = contactMemory();
            for (let i = 0; i < 12; i++) contactPlaces([contact(1, i * 10)], memory, null, 0.01);
            const p = contactPlaces([contact(1, 120)], memory, null, 0.01);
            expect(p[0]!.x).toBe(120);
            expect(p[1]!.x).toBe(110);
        });

        it('reaches nowhere at no strength', () => {
            const p = contactPlaces([{ ...contact(1, 0), strength: 0 }], contactMemory(), null, 0);
            expect(p[0]!.w).toBe(0);
        });
    });

    describe('in a world\'s rules', () => {
        it('grows plants that can be felled, known by their places in the plan', async () => {
            const rules: WorldRules = {
                id: 'test:plants', versions: [1],
                plants: { oak: { ...TREE, interaction: { ...TREE.interaction, felledKind: 'stump' } }, stump: STUMP },
                biomes: [{ id: 'plain', conditions: [], recipes: [{ recipe: 'oak', layer: 'plants', density: 1 }] }],
                recipes: [{ id: 'oak', version: 1, anchor: { id: 'oak', plant: 'oak', footprint: 0.1 } }],
                layers: [{ id: 'plants', spacing: 10, drawDistance: 60, chunkSize: 16 }],
            } as WorldRules;
            const s = await scene({ rules });
            s.app.addPlugin(new WorldGenPlugin());
            const e = s.world.spawn();
            s.world.insert(e, Transform, {});
            s.world.insert(e, WorldGen, { rules: 'forest.esworld', world: 'wood', seed: 3 });
            await s.tick(90);
            const plants = s.plants().near(0, 0, 40);
            expect(plants.length).toBeGreaterThan(0);
            expect(plants[0]!.source).toBe('world:wood');
            const trees = s.countOf('tree.mesh');
            expect(trees).toBeGreaterThan(0);
            expect(s.plants().fell(plants[0]!)).toBe(true);
            expect(s.countOf('tree.mesh')).toBe(trees - 1);
            expect(s.countOf('stump.mesh')).toBe(1);
            // The plan is the same however the world is grown: the same key is the same tree in a save.
            const saved = s.plants().saveState();
            expect(saved.plants[0]!.source).toBe('world:wood');
            expect(saved.plants[0]!.key).toBe(plants[0]!.key);
        });

        it('names the kinds a plant turns into, whatever colours come before them', () => {
            const set = expandPlants({
                oak: { ...TREE, tints: [[1, 1, 1], [1, 0.9, 0.8]], interaction: { ...TREE.interaction, felledKind: 'stump' } },
                stump: { ...STUMP },
            } as never);
            expect(set.kinds).toHaveLength(3);
            expect(set.kinds[0]!.interaction!.felledKind).toBe(2);
            expect(set.kinds[1]!.interaction!.felledKind).toBe(2);
        });
    });
});
