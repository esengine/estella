// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ground is one set of triangles: what is drawn near the eye, what bodies collide with and what heightAt answers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/AssetPlugin';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import { createMockModule } from './mocks/wasm';
import { Terrain, TerrainExtent, TerrainPlugin, TerrainsRes } from '../src/terrain/terrainPlugin';
import { TerrainSurface, TILE_CELLS } from '../src/terrain/surface';
import { groundPaintAt } from '../src/terrain/groundQuery';
import { defaultTerrainLayers } from '../src/terrain/paintLayers';
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

    it('paints both triangles from the same four height samples as the surface', () => {
        const heights = new Map([['0,0', 1], ['1,0', 3], ['0,1', 4], ['1,1', 10]]);
        const height = vi.fn((x: number, z: number) => heights.get(`${x},${z}`) ?? null);
        const paint = vi.fn(() => [0.1, 0.2, 0.3, 0.4] as const);
        const source = { infinite: false, bounds: [0, 0, 1, 1] as const, minHeight: 1, maxHeight: 10,
            height, normal: () => null, paint };
        const area = new TerrainSurface(source, 1);
        const origin = { x: 10, y: 50, z: -20 };
        for (const [x, z, expectedHeight, sx, sz] of [
            [0.25, 0.25, 2.25, 2, 3], [0.75, 0.75, 6.75, 6, 7], [0.25, 0.75, 3.75, 2, 3],
        ] as const) {
            const expectedUp = 1 / Math.hypot(sx, 1, sz);
            expect(area.height(x, z)).toBe(expectedHeight);
            expect(area.normal(x, z)?.[1]).toBe(expectedUp);
            height.mockClear();
            expect(groundPaintAt(source, area, origin, origin.x + x, origin.z + z)).toEqual([0.1, 0.2, 0.3, 0.4]);
            expect(paint).toHaveBeenLastCalledWith(x, z, expectedHeight, expectedUp);
            expect(height).toHaveBeenCalledTimes(4);
        }

        paint.mockClear();
        expect(groundPaintAt(source, area, origin, 15, -20)).toBeNull();
        heights.delete('1,1');
        expect(groundPaintAt(source, area, origin, 10.25, -19.75)).toBeNull();
        expect(paint).not.toHaveBeenCalled();
    });

    it('picks a distant finite area without sampling empty space or the sky', () => {
        const sample = vi.fn(() => 0);
        const area = new TerrainSurface({ infinite: false, bounds: [-10, -10, 10, 10],
            minHeight: 0, maxHeight: 0, height: sample, normal: () => [0, 1, 0], paint: () => [1, 0, 0, 0] }, 1);
        const hit = area.raycast(-100000, 100000, 0, 1, -1, 0, 200000);
        expect(hit?.point[0]).toBeCloseTo(0, 6);
        expect(hit?.point[1]).toBeCloseTo(0, 6);
        expect(sample.mock.calls.length).toBeLessThanOrEqual(8);
        sample.mockClear();
        expect(area.raycast(0, 100, 0, 0, 1, 0, Infinity)).toBeNull();
        expect(area.raycast(40, 30, 0, 0, -1, 0, Infinity)).toBeNull();
        expect(sample).not.toHaveBeenCalled();
    });

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

    it('keeps collision index buffers independent across terrain tiles and render patches', () => {
        const a = surface.tile(0, 0)!, b = surface.tile(1, 0)!;
        const patch = buildPatchMesh(TILE_CELLS);
        expect(a.indices).toEqual(b.indices);
        expect(a.indices).toEqual(patch.indices);
        a.indices[0] = 17;
        patch.indices[0] = 29;
        expect(b.indices[0]).toBe(0);
        expect(surface.tile(0, 0)!.indices[0]).toBe(0);
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

    it('picks the nearer of two triangles hit in the same cell from either direction', () => {
        const valley = new TerrainSurface({ infinite: false, bounds: [0, 0, 1, 1], minHeight: 0, maxHeight: 2,
            height: (x, z) => x === z ? 2 : 0, normal: () => null, paint: () => [1, 0, 0, 0] }, 1);
        for (const [x, dx, nearest] of [[0.9, -1, 0.75], [0.1, 1, 0.25]] as const) {
            const hit = valley.raycast(x, 0.5, 0.5, dx, 0, 0, 1)!;
            expect(hit.point[0]).toBeCloseTo(nearest, 10);
            expect(hit.distance).toBeCloseTo(0.15, 10);
            expect(hit.point[1]).toBe(valley.height(nearest, 0.5));
            expect(hit.normal).toEqual(valley.normal(nearest, 0.5));
            expect(valley.raycast(x, 0.5, 0.5, dx, 0, 0, 0.1)).toBeNull();
        }
    });

    it('reads each traversed lattice node once before a hit along either grid axis', () => {
        const height = vi.fn((x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) === 6 ? 2 : 0);
        const hill = new TerrainSurface({ infinite: true, bounds: null, minHeight: 0, maxHeight: 2,
            height, normal: () => null, paint: () => [1, 0, 0, 0] }, 1);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            height.mockClear();
            const hit = hill.raycast(dx * 0.25 + Math.abs(dz) * 0.25, 1, dz * 0.25 + Math.abs(dx) * 0.25, dx, 0, dz, 10);
            expect(hit?.distance).toBeCloseTo(5.25, 10);
            expect(height).toHaveBeenCalledTimes(14);
            expect(new Set(height.mock.calls.map(([x, z]) => `${x},${z}`)).size).toBe(14);
        }
    });

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

    it.each(['direct', 'layer info'] as const)('loads %s physical material bindings and keeps the live material during reload', async mode => {
        const app = boot();
        const ref = 'ground.esphysmat';
        let invalidate = () => {};
        let resolveReload!: (text: string) => void;
        const reload = new Promise<string>(resolve => { resolveReload = resolve; });
        const fetchPhysical = vi.fn(async (_path: string) => { throw new Error('Unavailable physical material'); })
            .mockImplementationOnce(async () => JSON.stringify({ friction: 0.2, restitution: 0.4 }))
            .mockImplementationOnce(() => reload);
        app.insertResource(Assets, {
            fetchText: async (path: string) => path === ref ? fetchPhysical(path)
                : JSON.stringify({ name: path.replace('.esterrainlayerinfo', ''), blend: 'weight', physicalMaterial: ref }),
            onInvalidate: (listener: () => void) => { invalidate = listener; return () => {}; },
            load: () => new Promise(() => {}),
        } as never);
        const paintLayers = defaultTerrainLayers.map((name, slot) => ({ name, slot,
            info: mode === 'direct' ? 'builtin:' + name : name + '.esterrainlayerinfo',
            blend: 'weight', hardness: 0.5, physicalMaterial: mode === 'direct' ? ref : '' }));
        const terrain = spawn(app, { extent: TerrainExtent.Area, sizeX: 64, sizeZ: 64, resolution: 17,
            erosion: 0, friction: 0.6, collisionDistance: 1, paintLayers });
        mover(app, 8, 8);
        await tick(app, 12);
        expect(fetchPhysical.mock.calls).toEqual([[ref]]);
        const first = pieces(app);
        expect(first).toHaveLength(1);
        expect(first[0]![1]).toMatchObject({ friction: 0.2, restitution: 0.4 });

        invalidate();
        await tick(app, 6);
        expect(fetchPhysical.mock.calls).toEqual([[ref], [ref]]);
        expect(pieces(app)[0]![1]).toBe(first[0]![1]);

        resolveReload(JSON.stringify({ friction: 0.8, restitution: 0.1 }));
        await tick(app, 8);
        expect(pieces(app)).toHaveLength(1);
        expect(pieces(app)[0]![1]).toMatchObject({ friction: 0.8, restitution: 0.1 });
        invalidate();
        await tick(app, 8);
        expect(pieces(app)[0]![1]).toMatchObject({ friction: 0.6, restitution: 0 });
        app.world.update(terrain, Terrain, data => { data.paintLayers = []; });
        await tick(app, 4);
        expect(fetchPhysical).toHaveBeenCalledTimes(3);
    });

    it('are owed where a mover stands until they are published, inside the area only, and no longer once the terrain goes', async () => {
        const app = boot();
        // An area whose heights take a while (eroded): its ground is owed from the frame after it is declared, while they are made.
        const terrain = spawn(app, { extent: TerrainExtent.Area, sizeX: 512, sizeZ: 512, resolution: 65 }, { x: 0, y: 0, z: 0 });
        mover(app, 100, -40);
        await tick(app, 2);
        const terrains = app.getResource(TerrainsRes);
        const geometry = app.getResource(CollisionGeometryRes);
        // Frames with no turn between them: nothing that answers later has answered, and the tiles are not there.
        app.tick(1 / 60);
        app.tick(1 / 60);
        if (!terrains.collisionReadyAt(100, -40)) {
            expect(geometry.owedAt(100, 50, -40)).toBe(true);
            // Beyond the area there is no ground to wait for.
            expect(geometry.owedAt(4000, 50, -40)).toBe(false);
        }
        await tick(app, 12);
        expect(terrains.collisionReadyAt(100, -40)).toBe(true);
        expect(geometry.owing).toBe(true);
        expect(geometry.owedAt(100, 50, -40)).toBe(false);
        expect(geometry.owedAt(4000, 50, -40)).toBe(false);
        app.world.despawn(terrain);
        await tick(app, 2);
        expect(geometry.owing).toBe(false);
    });

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

    it('refreshes both sides of an edited collision boundary and restores them when the height range shrinks', async () => {
        const app = boot();
        const origin = { x: 10, y: 7, z: 3 };
        spawn(app, { collisionDistance: 150 }, origin);
        const seam = origin.x + TILE_CELLS * 2;
        mover(app, seam, 12);
        await tick(app, 16);
        const terrains = app.getResource(TerrainsRes);
        const points = [seam - 0.5, seam + 0.5];
        const z = 12;
        const heights = () => points.map(x => terrains.heightAt(x, z)!);
        const collision = () => points.map(x => pieces(app).map(([, piece]) => onPiece(piece, x, z)).find(h => h !== null));
        const expectCollisionAt = (expected: number[]) => {
            for (const [i, h] of collision().entries()) expect(h).toBeCloseTo(expected[i]!, 4);
        };
        const original = heights();
        expectCollisionAt(original);
        const distant = pieces(app).find(([, piece]) => piece.origin[0] >= seam + TILE_CELLS * 2)!;
        expect(distant).toBeDefined();

        const bounds = [seam, z - 4, seam + 8, z + 4] as const;
        terrains.setModifier({ id: 'plot', bounds, heights: [123, 123], apply: () => 123 });
        const edited = heights();
        expect(edited[0]).toBeGreaterThan(original[0]! + 10);
        expect(edited[1]).toBeCloseTo(123, 6);
        await tick(app, 8);
        expectCollisionAt(edited);

        terrains.deleteModifier('plot');
        expect(heights()).toEqual(original);
        await tick(app, 8);
        expectCollisionAt(original);
        expect(new Map(pieces(app)).get(distant[0])).toBe(distant[1]);
    });

    it('cover an area only where it is, including its last partial tile', async () => {
        const app = boot();
        spawn(app, { extent: TerrainExtent.Area, sizeX: 101, sizeZ: 101, resolution: 65, collisionDistance: 200 });
        mover(app, 49, 49);
        await tick(app, 20);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.collisionReadyAt(50.25, 50.25)).toBe(true);
        const collision = (x: number, z: number) => pieces(app).map(([, piece]) => onPiece(piece, x, z)).find(h => h !== null);
        for (const [x, z] of [[50.25, 50.25], [-50.25, 49.5], [49.5, -50.25], [-50.25, -50.25], [50.5, -50.5]] as const) {
            expect(collision(x, z)).toBeCloseTo(terrains.heightAt(x, z)!, 4);
        }
        for (const [x, z] of [[50.75, 49.5], [-50.75, 49.5], [49.5, 50.75], [49.5, -50.75]] as const) {
            expect(terrains.heightAt(x, z)).toBeNull();
            expect(collision(x, z)).toBeUndefined();
        }
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
