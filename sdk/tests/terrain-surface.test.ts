// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ground is one set of triangles: what is drawn near the eye, what bodies collide with and what heightAt answers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import { createMockModule } from './mocks/wasm';
import { Terrain, TerrainExtent, TerrainPlugin, TerrainsRes } from '../src/terrain/terrainPlugin';
import { TerrainSurface, TILE_CELLS } from '../src/terrain/surface';
import { NoiseSource, type NoiseParams } from '../src/terrain/source';
import { makePage, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS, type PageImage } from '../src/terrain/pages';
import { buildPatchMesh } from '../src/terrain/patch';
import { CollisionGeometryRes, type CollisionPiece } from '../src/runtime/collisionGeometry';
import { RigidBody3D, SphereCollider3D } from '../src/physics3d/Physics3DComponents';
import { Physics3D, Physics3DPlugin, Physics3DRuntime } from '../src/physics3d/Physics3DPlugin';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

// These scenes are written in metres: a project of one unit a metre, so the Terrain's own defaults are metres beside them.
beforeAll(() => setWorldUnitsPerMeter(1));
afterAll(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

const params: NoiseParams = { seed: 3, frequency: 4, octaves: 5, persistence: 0.5, ridged: 0.3, warp: 0.2, erosion: 1, sizeX: 400, height: 40,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
const terrainOf = (over: Record<string, unknown> = {}) => ({ ...Terrain._default, extent: TerrainExtent.Infinite, cellSize: 2, ...params, ...over });

/** The height at (x, z) on a piece's triangles, found the way a ray straight down would. */
function onPiece(piece: CollisionPiece, x: number, z: number): number | null {
    const p = piece.positions, ix = piece.indices;
    const lx = x - piece.origin[0], lz = z - piece.origin[2];
    for (let t = 0; t < ix.length; t += 3) {
        const [a, b, c] = [ix[t]!, ix[t + 1]!, ix[t + 2]!].map((v) => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!]) as [number[], number[], number[]];
        const d = (b[2]! - c[2]!) * (a[0]! - c[0]!) + (c[0]! - b[0]!) * (a[2]! - c[2]!);
        const wa = ((b[2]! - c[2]!) * (lx - c[0]!) + (c[0]! - b[0]!) * (lz - c[2]!)) / d;
        const wb = ((c[2]! - a[2]!) * (lx - c[0]!) + (a[0]! - c[0]!) * (lz - c[2]!)) / d;
        const wc = 1 - wa - wb;
        if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return piece.origin[1] + wa * a[1]! + wb * b[1]! + wc * c[1]!;
    }
    return null;
}

describe('ground without end', () => {
    it('is continuous where its ridges are worn: no step, however finely it is read', () => {
        const worn = new NoiseSource({ ...params, ridged: 1, erosion: 2, warp: 0.35 });
        const steepest = (step: number) => {
            let w = 0;
            for (let x = -3000; x < 3000; x += step) w = Math.max(w, Math.abs(worn.height(x + step, 300) - worn.height(x, 300)) / step);
            return w;
        };
        // A step would show as a slope that grows as the reading gets finer.
        expect(steepest(0.02)).toBeLessThan(steepest(0.5) * 1.05);
    });
});

describe('the surface', () => {
    const surface = new TerrainSurface(new NoiseSource(params), 2);

    it('is the source at every lattice node, and flat across each triangle', () => {
        const source = new NoiseSource(params);
        for (const [i, k] of [[0, 0], [17, -9], [-300, 41]] as const) expect(surface.height(i * 2, k * 2)).toBeCloseTo(source.height(i * 2, k * 2), 9);
        // Halfway along the cut from (1, 0) to (0, 1) is the mean of those two corners, not of all four.
        const b = surface.node(4, 3)!, c = surface.node(3, 4)!;
        expect(surface.height(7, 7)).toBeCloseTo((b + c) / 2, 9);
    });

    it('is cut the way the drawn patch is, and its nodes are the drawn finest page\'s vertices', () => {
        const tile = surface.tile(0, 0)!;
        expect(Array.from(tile.indices)).toEqual(Array.from(buildPatchMesh(TILE_CELLS).indices));
        expect(TILE_CELLS).toBe(PATCH_CELLS);
        // A level-0 node is a patch of `cellSize` cells; its vertices read every second sample of its page.
        const page = makePage(new NoiseSource(params), 0, 0, PATCH_CELLS * 2) as PageImage;
        const span = params.height;
        for (const [i, k] of [[0, 0], [5, 9], [32, 32]] as const) {
            const at = ((1 + 2 * k) * PAGE_SIDE + 1 + 2 * i) * 4;
            const drawn = (page.heights[at]! * 256 + page.heights[at + 1]!) / 65535 * span;
            expect(Math.abs(drawn - surface.node(i, k)!)).toBeLessThanOrEqual(span / 65535);
        }
        expect(PAGE_TEXELS).toBe(PATCH_CELLS * 2);
    });

    it('faces the way its triangle does', () => {
        const n = surface.normal(7.2, 6.1)!;
        const h = (x: number, z: number) => surface.height(x, z)!;
        const e = 0.01;
        const sx = (h(7.2 + e, 6.1) - h(7.2 - e, 6.1)) / (2 * e), sz = (h(7.2, 6.1 + e) - h(7.2, 6.1 - e)) / (2 * e);
        const len = Math.hypot(sx, 1, sz);
        expect(n[0]).toBeCloseTo(-sx / len, 6);
        expect(n[1]).toBeCloseTo(1 / len, 6);
        expect(n[2]).toBeCloseTo(-sz / len, 6);
    });
});

describe('a ray against the surface', () => {
    const surface = new TerrainSurface(new NoiseSource(params), 2);

    it('meets the ground where heightAt says it is, straight down or slanting, and faces the way normalAt does', () => {
        for (const [x, z] of [[3.3, 7.9], [-120.5, 44.25], [999.1, -12.6]] as const) {
            const down = surface.raycast(x, 500, z, 0, -1, 0, 1000)!;
            expect(down.point[1]).toBeCloseTo(surface.height(x, z)!, 6);
            const slant = surface.raycast(x, 300, z, 0.4, -1, 0.3, 2000)!;
            expect(slant.point[1]).toBeCloseTo(surface.height(slant.point[0], slant.point[2])!, 5);
            const n = surface.normal(slant.point[0], slant.point[2])!;
            for (let c = 0; c < 3; c++) expect(slant.normal[c]).toBeCloseTo(n[c]!, 3);
        }
    });

    it('finds a hillside far along a low ray, and nothing past its reach or pointing at the sky', () => {
        const ground = surface.height(0, 0)!;
        const far = surface.raycast(0, ground + 1, 0, 1, 0, 0.2, 20000);
        expect(far).not.toBeNull();
        expect(far!.distance).toBeGreaterThan(1);
        expect(surface.raycast(0, ground + 1, 0, 1, 0, 0.2, 0.5)).toBeNull();
        expect(surface.raycast(0, ground + 1, 0, 0, 1, 0, 1000)).toBeNull();
    });
});

describe('collision tiles', () => {
    const boot = (): App => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const app = App.new();
        const module = createMockModule();
        app.connectCpp(module.getRegistry(), module);
        app.addPlugin(new TerrainPlugin());
        return app;
    };
    // The mock engine composes no transforms: an entity without a parent is given its world pose as well.
    const placed = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });
    const tick = async (app: App, n = 1) => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };
    const spawn = (app: App, over: Record<string, unknown> = {}, at = { x: 0, y: 0, z: 0 }): Entity => {
        const e = app.world.spawn();
        app.world.insert(e, Transform, placed(at.x, at.y, at.z));
        app.world.insert(e, Terrain, terrainOf(over));
        return e;
    };
    const mover = (app: App, x: number, z: number): Entity => {
        const e = app.world.spawn();
        app.world.insert(e, Transform, placed(x, 50, z));
        app.world.insert(e, RigidBody3D, { bodyType: 2 });
        return e;
    };
    const pieces = (app: App) => [...app.getResource(CollisionGeometryRes).entries()];

    it('are built round what moves, agree with heightAt everywhere on them, and go when it does', async () => {
        const app = boot();
        const terrain = spawn(app, {}, { x: 10, y: -5, z: 3 });
        await tick(app);
        expect(pieces(app)).toHaveLength(0);
        const body = mover(app, 100, -40);
        await tick(app, 10);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.collisionReadyAt(100, -40)).toBe(true);
        const built = pieces(app);
        expect(built.length).toBeGreaterThan(1);
        for (const [, piece] of built) {
            expect(piece.owner).toBe(terrain);
            for (let s = 0; s < 20; s++) {
                const x = piece.origin[0] + ((s * 37) % 64) + 0.31, z = piece.origin[2] + ((s * 53) % 64) + 0.77;
                expect(onPiece(piece, x, z)!).toBeCloseTo(terrains.heightAt(x, z)!, 4);
            }
        }
        app.world.insert(body, Transform, placed(5000, 50, -40));
        await tick(app, 10);
        expect(terrains.collisionReadyAt(100, -40)).toBe(false);
        app.world.despawn(body);
        await tick(app);
        expect(pieces(app)).toHaveLength(0);
    });

    it('keep the old ground under what stands on it until the new ground is built, and go with the terrain', async () => {
        const app = boot();
        const terrain = spawn(app);
        mover(app, 0, 0);
        await tick(app, 10);
        const before = new Map(pieces(app));
        app.world.insert(terrain, Terrain, terrainOf({ seed: 99 }));
        app.tick(1 / 60);
        // Never a frame with nothing under the body.
        expect(app.getResource(TerrainsRes).collisionReadyAt(0, 0) || pieces(app).length >= before.size).toBe(true);
        await tick(app, 10);
        const after = new Map(pieces(app));
        expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
        for (const [key, piece] of after) expect(piece).not.toBe(before.get(key));
        app.world.insert(terrain, Terrain, terrainOf({ seed: 99, collision: false }));
        await tick(app);
        expect(pieces(app)).toHaveLength(0);
        app.world.insert(terrain, Terrain, terrainOf({ seed: 99 }));
        await tick(app, 10);
        expect(pieces(app).length).toBeGreaterThan(0);
        app.world.despawn(terrain);
        await tick(app);
        expect(pieces(app)).toHaveLength(0);
    });

    it('cover an area only where it is, including its last partial tile', async () => {
        const app = boot();
        spawn(app, { extent: TerrainExtent.Area, sizeX: 100, sizeZ: 100, resolution: 65 });
        mover(app, 49, 49);
        await tick(app, 20);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.collisionReadyAt(49.5, 49.5)).toBe(true);
        expect(terrains.heightAt(51, 0)).toBeNull();
        for (const [, piece] of pieces(app)) expect(piece.origin[0]).toBeLessThan(50);
    });
});

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

describe.skipIf(!HAS_WASM || !hasSideModule('physics3d'))('the ground in the 3D world (Jolt)', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    const world = async () => {
        engine.setActiveContext(null);
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<Physics3DWasmModule>('physics3d');
        app.addPlugin(new Physics3DPlugin('', { pixelsPerUnit: 1 }, async () => module));
        await app.getResource(Physics3DRuntime).initPromise;
        app.addPlugin(new TerrainPlugin());
        const terrain = app.world.spawn();
        app.world.insert(terrain, Transform, { position: { x: 0, y: 0, z: 0 } });
        app.world.insert(terrain, Terrain, terrainOf());
        return { app, terrain };
    };

    it('a ray down meets the ground heightAt answers, across tile seams', async () => {
        const { app, terrain } = await world();
        const e = app.world.spawn();
        app.world.insert(e, Transform, { position: { x: 64, y: 80, z: 64 } });
        app.world.insert(e, RigidBody3D, { bodyType: 1 });
        await app.stepFrames(6, 1 / 60);
        const physics = app.getResource(Physics3D)!, terrains = app.getResource(TerrainsRes);
        for (const [x, z] of [[64, 64], [63.99, 64.01], [70.3, 41.7], [100.5, 90.25], [128, 127.5]] as const) {
            const hit = physics.raycast({ x, y: 200, z }, { x: 0, y: -400, z: 0 });
            expect(hit?.entity).toBe(terrain);
            expect(hit!.y).toBeCloseTo(terrains.heightAt(x, z)!, 3);
        }
    });

    it('a ray through the physics world and a ray against the surface meet the ground at the same point', async () => {
        const { app } = await world();
        const e = app.world.spawn();
        app.world.insert(e, Transform, { position: { x: 30, y: 80, z: 30 } });
        app.world.insert(e, RigidBody3D, { bodyType: 1 });
        await app.stepFrames(6, 1 / 60);
        const physics = app.getResource(Physics3D)!, terrains = app.getResource(TerrainsRes);
        for (const [x, z] of [[30, 30], [41.3, 17.8]] as const) {
            const origin = { x, y: 200, z }, dir = { x: 0.2, y: -1, z: 0.1 };
            const viaPhysics = physics.raycast(origin, { x: dir.x * 400, y: dir.y * 400, z: dir.z * 400 })!;
            const viaSurface = terrains.raycast(origin, dir, 1000)!;
            expect(viaSurface.point.x).toBeCloseTo(viaPhysics.x, 2);
            expect(viaSurface.point.y).toBeCloseTo(viaPhysics.y, 2);
            expect(viaSurface.point.z).toBeCloseTo(viaPhysics.z, 2);
        }
    });

    it('a ball dropped on it comes to rest on it, not through it', async () => {
        const { app } = await world();
        const terrains = app.getResource(TerrainsRes);
        await app.stepFrames(1, 1 / 60);
        const ball = app.world.spawn();
        const ground = terrains.heightAt(20, 20)!;
        app.world.insert(ball, Transform, { position: { x: 20, y: ground + 3, z: 20 } });
        app.world.insert(ball, RigidBody3D, { bodyType: 2, linearDamping: 2, angularDamping: 2 });
        app.world.insert(ball, SphereCollider3D, { radius: 0.5 });
        await app.stepFrames(180, 1 / 60);
        const p = (app.world.get(ball, Transform) as TransformData).worldPosition;
        const under = terrains.heightAt(p.x, p.z)!;
        expect(p.y).toBeGreaterThan(under + 0.3);
        expect(p.y).toBeLessThan(under + 1.2);
    });
});

describe('heightfieldFromPixels', () => {
    it('reads heights as its format says, never by what the pixels hold', async () => {
        const { heightfieldFromPixels, HeightmapFormat } = await import('../src/terrain/heightfield');
        // Two texels whose green happens to differ from red: grey reads red alone, red+green reads both.
        const pixels = [0x80, 0x40, 0, 255, 0xff, 0xff, 0, 255];
        const grey = heightfieldFromPixels(2, 1, pixels).data, wide = heightfieldFromPixels(2, 1, pixels, HeightmapFormat.RedGreen16).data;
        expect(grey[0]).toBeCloseTo(0x80 / 255, 6);
        expect(wide[0]).toBeCloseTo(0x8040 / 65535, 6);
        expect([grey[1], wide[1]]).toEqual([1, 1]);
        expect(heightfieldFromPixels(2, 1, pixels, HeightmapFormat.Grey, [0x8001, 0]).data[0]).toBeCloseTo(0x8001 / 65535, 6);
    });
});
