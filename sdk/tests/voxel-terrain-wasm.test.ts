// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The real engine and the real 3D solver on ground that is a volume: what rests on it stays, what it is dug out from under falls,
 * a character walks into a tunnel that was just cut, and a save brings the hole back for the solver too.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { MeshRenderer, Parent, RuntimeOnly, Transform, type TransformData } from '../src/ecs/component';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { Assets } from '../src/asset/AssetPlugin';
import type { Assets as AssetsApi } from '../src/asset/Assets';
import type { MeshData } from '../src/asset/meshFormat';
import { WorldStreamingSource } from '../src/residency/components';
import { Physics3DPlugin } from '../src/physics3d/Physics3DPlugin';
import { Physics3DRuntime } from '../src/physics3d/physics3dRuntime';
import { CapsuleCollider3D, CharacterController3D, RigidBody3D, SphereCollider3D } from '../src/physics3d/Physics3DComponents';
import { collisionGeometryOf } from '../src/runtime/collisionGeometry';
import { VoxelPlugin, VoxelTerrain, VoxelTerrainsRes, type VoxelTerrains } from '../src/voxel/voxelPlugin';
import type { VoxelSource } from '../src/voxel/field';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

const flat: VoxelSource = (_x, y, _z, out) => { out.distance = y; out.material = 2; };

let core: ESEngineModule;
const apps: App[] = [];
afterEach(() => {
    while (apps.length) apps.pop()!.quit?.();
    setEditorMode(false); setPlayMode(false);
    setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER);
});

interface Scene {
    app: App; world: App['world']; terrains: VoxelTerrains; volume: Entity;
    tick(n?: number): Promise<void>;
    meshes: Map<number, MeshData>;
    released: { n: number };
}

async function scene(options: { physics?: boolean; solver?: string; fields?: Record<string, unknown> } = {}): Promise<Scene> {
    core.setActiveContext(null);
    const app = App.new(); apps.push(app); app.connectCpp(new core.Registry(), core, { ownedRegistry: true });
    setPlayMode(true);
    if (options.physics !== false) {
        const module = await loadSideModule<Physics3DWasmModule>(options.solver ?? 'physics3d');
        // A metre world, as a project with world3d.unitsPerMeter 1 is: its defaults (a character's capsule) are in metres too.
        setWorldUnitsPerMeter(1);
        app.addPlugin(new Physics3DPlugin('', { fixedTimestep: 1 / 60, pixelsPerUnit: 1 }, async () => module));
        await app.getResource(Physics3DRuntime).initPromise;
    }
    let next = 1;
    const meshes = new Map<number, MeshData>(), released = { n: 0 };
    app.insertResource(Assets, {
        createMesh: (data: MeshData) => { const h = next++; meshes.set(h, data); return h; },
        releaseBuiltMesh: (h: number) => { if (meshes.delete(h)) released.n++; },
        onInvalidate: () => () => {}, resolveLoadPath: (p: string) => p,
    } as unknown as AssetsApi);
    const source = app.world.spawn(); app.world.insert(source, Transform, {}); app.world.insert(source, WorldStreamingSource, {});
    app.addPlugin(new VoxelPlugin());
    const terrains = app.getResource(VoxelTerrainsRes);
    const volume = app.world.spawn('Ground');
    app.world.insert(volume, Transform, {});
    app.world.insert(volume, VoxelTerrain, { cellSize: 1, chunkCells: 12, minY: -24, maxY: 24, drawDistance: 30, collisionDistance: 20, material: 1, ...options.fields });
    terrains.setSource(volume, flat);
    const tick = async (n = 1): Promise<void> => { for (let i = 0; i < n; i++) { await app.tick(1 / 60); await Promise.resolve(); } };
    return { app, world: app.world, terrains, volume, tick, meshes, released };
}

function ball(s: Scene, x: number, y: number, z: number): Entity {
    const e = s.world.spawn('Ball');
    s.world.insert(e, Transform, { position: { x, y, z } });
    s.world.insert(e, RigidBody3D, { bodyType: 2 });
    s.world.insert(e, SphereCollider3D, { radius: 0.5 });
    return e;
}

const yOf = (s: Scene, e: Entity): number => (s.world.get(e, Transform) as TransformData).position.y;

describe.skipIf(!HAS_WASM)('ground that is a volume', () => {
    beforeAll(async () => { if (HAS_WASM) core = await loadWasmModule(); });

    describe.skipIf(!hasSideModule('physics3d'))('under the real solver', () => {
        it('holds what falls on it', async () => {
            const s = await scene();
            const b = ball(s, 3, 6, 3);
            await s.tick(180);
            expect(yOf(s, b)).toBeGreaterThan(0.3);
            expect(yOf(s, b)).toBeLessThan(0.8);
        });

        it('lets go of what it was dug out from under, even asleep', async () => {
            const s = await scene();
            const b = ball(s, 3, 3, 3);
            await s.tick(300);
            const rested = yOf(s, b);
            expect(rested).toBeLessThan(0.8);
            s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 3, y: -1, z: 3 }, radius: 4 });
            await s.tick(120);
            expect(yOf(s, b)).toBeLessThan(rested - 2);
            expect(yOf(s, b)).toBeGreaterThan(-6);
        });

        it.skipIf(!hasSideModule('physics3d-physx'))('lets go of it on the other solver too', async () => {
            const s = await scene({ solver: 'physics3d-physx' });
            const b = ball(s, 3, 3, 3);
            await s.tick(300);
            const rested = yOf(s, b);
            expect(rested).toBeLessThan(0.8);
            s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 3, y: -1, z: 3 }, radius: 4 });
            await s.tick(120);
            expect(yOf(s, b)).toBeLessThan(rested - 2);
        });

        it('stops a character at a wall until a tunnel is cut through it', async () => {
            const s = await scene({ fields: { collisionDistance: 30 } });
            s.terrains.fill(s.volume, { kind: 'box', center: { x: 8, y: 6, z: 3 }, halfExtents: { x: 2, y: 6, z: 8 } }, 2);
            const c = s.world.spawn('Walker');
            s.world.insert(c, Transform, { position: { x: 0, y: 1.2, z: 3 } });
            s.world.insert(c, CapsuleCollider3D, { radius: 0.4, halfHeight: 0.5 });
            s.world.insert(c, CharacterController3D, {});
            await s.tick(20);
            const walk = async (frames: number): Promise<void> => {
                for (let i = 0; i < frames; i++) {
                    s.world.update(c, CharacterController3D, (d: { velocity: { x: number; y: number; z: number } }) => { d.velocity = { x: 4, y: d.velocity?.y ?? 0, z: 0 }; });
                    await s.tick(1);
                }
            };
            const xOf = (): number => (s.world.get(c, Transform) as TransformData).position.x;
            await walk(120);
            expect(xOf()).toBeLessThan(6);
            expect(xOf()).toBeGreaterThan(4);
            s.terrains.carve(s.volume, { kind: 'capsule', from: { x: 3, y: 1.6, z: 3 }, to: { x: 14, y: 1.6, z: 3 }, radius: 1.5 });
            await s.tick(3);
            await walk(120);
            expect(xOf()).toBeGreaterThan(10.5);
        });

        it('falls through a hole, and stands on what is put back', async () => {
            const s = await scene();
            s.terrains.carve(s.volume, { kind: 'capsule', from: { x: 3, y: 2, z: 3 }, to: { x: 3, y: -10, z: 3 }, radius: 2.5 });
            await s.tick(2);
            const b = ball(s, 3, 4, 3);
            await s.tick(180);
            expect(yOf(s, b)).toBeLessThan(-10);
            s.terrains.fill(s.volume, { kind: 'capsule', from: { x: 3, y: 0, z: 3 }, to: { x: 3, y: -8, z: 3 }, radius: 3 });
            await s.tick(2);
            const c = ball(s, 3, 4, 3);
            await s.tick(180);
            expect(yOf(s, c)).toBeGreaterThan(-1);
        });

        it('keeps a hole across the border of chunks: nothing is left to stop a fall', async () => {
            const s = await scene();
            s.terrains.carve(s.volume, { kind: 'capsule', from: { x: 12, y: 2, z: 12 }, to: { x: 12, y: -10, z: 12 }, radius: 3 });
            await s.tick(2);
            const b = ball(s, 12, 4, 12);
            await s.tick(180);
            expect(yOf(s, b)).toBeLessThan(-10);
        });

        it('brings a saved hole back for the solver too', async () => {
            const a = await scene();
            a.terrains.carve(a.volume, { kind: 'capsule', from: { x: 3, y: 2, z: 3 }, to: { x: 3, y: -10, z: 3 }, radius: 2.5 });
            const save = JSON.parse(JSON.stringify(a.terrains.serialize(a.volume)));
            const b = await scene();
            await b.tick(2);
            expect(b.terrains.restore(b.volume, save)).toBe(true);
            await b.tick(10);
            const e = ball(b, 3, 4, 3);
            await b.tick(180);
            expect(yOf(b, e)).toBeLessThan(-10);
        });

        it('changes the ground under what stands on it when a save is put back', async () => {
            const a = await scene();
            a.terrains.carve(a.volume, { kind: 'capsule', from: { x: 3, y: 2, z: 3 }, to: { x: 3, y: -10, z: 3 }, radius: 2.5 });
            const save = JSON.parse(JSON.stringify(a.terrains.serialize(a.volume)));
            const b = await scene();
            const e = ball(b, 3, 3, 3);
            await b.tick(180);
            const rested = yOf(b, e);
            expect(rested).toBeLessThan(0.8);
            expect(b.terrains.restore(b.volume, save)).toBe(true);
            await b.tick(120);
            expect(yOf(b, e)).toBeLessThan(rested - 3);
        });

        it('builds collision only round what moves, and lets it go', async () => {
            const s = await scene();
            await s.tick(5);
            expect(collisionGeometryOf(s.app).size).toBe(0);
            const b = ball(s, 3, 2, 3);
            await s.tick(20);
            const near = collisionGeometryOf(s.app).size;
            expect(near).toBeGreaterThan(0);
            expect(s.terrains.collisionReadyAt(s.volume, 3, 3)).toBe(true);
            expect(s.terrains.collisionReadyAt(s.volume, 400, 3)).toBe(false);
            s.world.despawn(b);
            await s.tick(5);
            expect(collisionGeometryOf(s.app).size).toBe(0);
        });
    });

    describe('drawn', () => {
        const drawnOf = (s: Scene): Entity[] => [...s.world.getEntitiesWithComponents([RuntimeOnly, MeshRenderer])];

        it('is an entity a chunk, under the volume, that a saved scene does not hold', async () => {
            const s = await scene({ physics: false });
            await s.tick(30);
            const chunks = drawnOf(s);
            expect(chunks.length).toBeGreaterThan(4);
            for (const e of chunks) {
                expect((s.world.get(e, Parent) as { entity: Entity }).entity).toBe(s.volume);
                const r = s.world.get(e, MeshRenderer) as { mesh: number; material: number; cullBackfaces: boolean };
                expect(s.meshes.has(r.mesh)).toBe(true);
                expect(r.material).toBe(1);
                expect(r.cullBackfaces).toBe(true);
            }
        });

        it('makes again only the chunks an edit reached', async () => {
            const s = await scene({ physics: false });
            await s.tick(30);
            const before = new Map(drawnOf(s).map((e) => [e, (s.world.get(e, MeshRenderer) as { mesh: number }).mesh]));
            const dug = s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 6, y: -3, z: 6 }, radius: 2 })!;
            expect(dug.removed[2]!).toBeGreaterThan(20);
            await s.tick(1);
            const changed = drawnOf(s).filter((e) => before.get(e) !== (s.world.get(e, MeshRenderer) as { mesh: number }).mesh).length;
            expect(changed).toBeGreaterThan(0);
            expect(changed).toBeLessThanOrEqual(dug.chunks);
            expect(changed).toBeLessThan(before.size / 2);
            expect(s.terrains.status(s.volume)!.waitingChunks).toBe(0);
        });

        it('gives back the meshes it replaces and those it lets go', async () => {
            const s = await scene({ physics: false });
            await s.tick(30);
            const held = s.meshes.size;
            for (let i = 0; i < 20; i++) {
                s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 6, y: -3, z: 6 }, radius: 2 + i * 0.1 });
                await s.tick(1);
            }
            expect(s.meshes.size).toBeLessThan(held + 12);
            s.world.remove(s.volume, VoxelTerrain);
            await s.tick(2);
            expect(s.meshes.size).toBe(0);
            expect(drawnOf(s).length).toBe(0);
        });

        it('keeps what was dug when it is moved, and hears of every edit that changed something', async () => {
            const s = await scene({ physics: false });
            await s.tick(5);
            const heard: number[] = [];
            const stop = s.terrains.onEdit((e) => heard.push(e.result.chunks));
            s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 3, y: -4, z: 3 }, radius: 2 });
            s.terrains.carve(s.volume, { kind: 'sphere', center: { x: 3, y: 40, z: 3 }, radius: 1 });
            expect(heard.length).toBe(1);
            stop();
            s.world.update(s.volume, Transform, (t) => { t.position.x = 100; });
            await s.tick(2);
            expect(s.terrains.distanceAt(s.volume, { x: 103, y: -4, z: 3 })).toBeGreaterThan(0);
            expect(s.terrains.distanceAt(s.volume, { x: 3, y: -4, z: 3 })).toBeLessThan(0);
        });

        it('answers a ray in the world, wherever the volume stands', async () => {
            const s = await scene({ physics: false });
            s.world.update(s.volume, Transform, (t) => { t.position.y = 10; });
            await s.tick(2);
            const hit = s.terrains.raycast({ x: 3, y: 30, z: 3 }, { x: 0, y: -1, z: 0 })!;
            expect(hit.point.y).toBeCloseTo(10, 1);
            expect(hit.entity).toBe(s.volume);
            expect(s.terrains.materialAt(s.volume, { x: 3, y: 8, z: 3 })).toBe(2);
        });
    });
});
