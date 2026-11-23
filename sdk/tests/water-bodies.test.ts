// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which water a place is: the sea only where it reaches, a lake only over its own ground, the same whatever order bodies come in;
 *        and the basins and drainage a game decides its lakes and rivers by.
 */
import { worldUnitsPerMeter } from '../src/ecs/worldUnits';
import { describe, expect, it } from 'vitest';
import { WaterField, type ZoneExclusion, type ZoneGrid, type ZoneLake, type ZoneOcean, type ZoneRiver } from '../src/water/zone';
import { drainPath, findBasins } from '../src/water/basins';
import type { Point2 } from '../src/water/shore';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Camera, Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { UnderwaterLook, WaterBody, WaterForm, WaterPlugin, WatersRes } from '../src/water/waterPlugin';
import { UnderwaterPlugin } from '../src/water/underwater';
import { currentUnderwater } from '../src/postprocess/underwater';
import { WaterZone } from '../src/water/zone';
import { warmShaders } from '../src/render/shaderWarmup';
import { bakesOf } from '../src/runtime/bakes';

const grid: ZoneGrid = { minX: -100, minZ: -100, sizeX: 200, sizeZ: 200, nx: 201, nz: 201 };
const ocean: ZoneOcean = { kind: 'ocean', key: 3, level: 0, waveHeight: 1, shoreWidth: 4 };
const square = (half: number): Point2[] => [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
const lakeAt = (cx: number, cz: number, half: number, level: number, key = 1): ZoneLake => ({
    kind: 'lake', key, level, waveHeight: 0.2, shoreWidth: 2, outline: square(half),
    toLocal: (x, z) => [x - cx, z - cz], toWorld: (x, z) => [x + cx, z + cz],
});

/**
 * An island rising from the sea, with two hollows in it below the sea's level: one walled off (a dry basin), one with a channel cut
 * through the island's rim out to the sea.
 */
function island(x: number, z: number): number {
    const r = Math.hypot(x, z);
    let h = 20 - r * 0.3;                                       // a cone, its shore about 67 out
    const pit = (cx: number, cz: number, depth: number, radius: number) => depth * Math.max(0, 1 - Math.hypot(x - cx, z - cz) / radius);
    h -= pit(-25, 0, 40, 15);                                   // walled off: its bottom about 6 below the sea
    h -= pit(30, 0, 42, 15);                                    // the second hollow
    if (x > 30 && Math.abs(z) < 4) h = Math.min(h, -3);        // and its channel out to the sea
    return h;
}

describe('the sea', () => {
    const field = WaterField.bake(grid, [ocean], island);

    it('fills low ground joined to it, and leaves a basin below its level that nothing joins to it dry', () => {
        expect(island(-25, 0)).toBeLessThan(0);
        expect(field.sample(-25, 0)).toBeNull();
        expect(field.sample(30, 0)?.key).toBe(3);
        expect(field.sample(90, 90)?.key).toBe(3);
        expect(field.sample(0, 0)).toBeNull();
    });
});

describe('a lake', () => {
    it('is water only where its surface is over its ground: a hill inside its outline is land', () => {
        const ground = (x: number, z: number) => (Math.hypot(x, z) < 6 ? 5 : -4);
        const field = WaterField.bake(grid, [lakeAt(0, 0, 30, 0)], ground);
        expect(field.sample(15, 15)?.key).toBe(1);
        expect(field.sample(0, 0)).toBeNull();
    });

    it('above the sea keeps its own water, and the bodies\' order changes nothing', () => {
        // A lake held up in the island's walled-off hollow, at 2 over the sea.
        const high = lakeAt(-25, 0, 12, 2, 7);
        const a = WaterField.bake(grid, [ocean, high], island), b = WaterField.bake(grid, [high, ocean], island);
        expect(a.sample(-25, 0)?.key).toBe(7);
        expect(a.sample(-25, 0)!.height).toBeCloseTo(2, 3);
        for (const name of ['height', 'shore', 'owner', 'depth'] as const) {
            const x = a[name], y = b[name];
            for (let k = 0; k < x.length; k += 97) {
                if (Number.isNaN(x[k]!)) expect(Number.isNaN(y[k]!)).toBe(true);
                else expect(y[k]).toBe(x[k]);
            }
        }
    });
});

describe('how deep the water is', () => {
    it('is the surface at rest down to the ground under it, which a sample in a running app hands on as waterDepth', () => {
        // A bowl: 8 under the lake's surface at its middle, rising to the shore.
        const bowl = (x: number, z: number): number => -6 + Math.hypot(x, z) * 0.1;
        const field = WaterField.bake(grid, [lakeAt(0, 0, 60, 2)], bowl);
        expect(field.sample(0, 0)!.depth).toBeCloseTo(8, 1);
        expect(field.sample(30, 0)!.depth).toBeCloseTo(5, 1);
        expect(field.sample(30, 0)!.depth).toBeLessThan(field.sample(0, 0)!.depth);
    });
});

describe('a place kept out of the water', () => {
    const box = (bottom: number, top: number): ZoneExclusion => ({
        key: 9, outline: square(15), toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z], scale: 1, bottom, top,
    });
    const deep = (): number => -20;

    it('takes the surface away over its outline where the surface lies between its bottom and top, and nowhere else', () => {
        const field = WaterField.bake(grid, [ocean], deep, 0, [box(-5, 5)]);
        expect(field.sample(0, 0)).toBeNull();
        expect(field.sample(10, 10)).toBeNull();
        expect(field.sample(30, 0)?.key).toBe(3);
        expect(field.sample(-60, 40)?.key).toBe(3);
    });

    it('leaves the surface above it where it lies wholly under the water: a room under the sea', () => {
        const field = WaterField.bake(grid, [ocean], deep, 0, [box(-15, -5)]);
        expect(field.sample(0, 0)?.key).toBe(3);
    });
});

describe('each body’s own colour', () => {
    it('is baked where the body is, runs into its neighbour’s across their junction, and is no share where a body has none', () => {
        const red = { ...lakeAt(30, 0, 25, 0, 1), color: [1, 0, 0] as const };
        const plain = lakeAt(-60, 60, 15, 0, 3);
        const river: ZoneRiver = { kind: 'river', key: 2, waveHeight: 0, shoreWidth: 0, color: [0, 1, 0],
            stations: Array.from({ length: 21 }, (_, i) => ({ x: -60 + i * 4, z: 0, y: 0, half: 4, dx: 1, dz: 0, speed: 1 })) };
        const field = WaterField.bake(grid, [red, river, plain], () => -5);
        const at = (x: number, z: number): { rgb: number[]; share: number } => {
            const i = Math.round((x - grid.minX) / grid.sizeX * (grid.nx - 1)), j = Math.round((z - grid.minZ) / grid.sizeZ * (grid.nz - 1));
            const k = j * grid.nx + i;
            return { rgb: [field.look[k * 3]!, field.look[k * 3 + 1]!, field.look[k * 3 + 2]!], share: field.lookShare[k]! };
        };
        expect(at(40, 0)).toEqual({ rgb: [1, 0, 0], share: 1 });
        expect(at(-40, 0).rgb).toEqual([0, 1, 0]);
        expect(at(-60, 60).share).toBe(0);
        // The river's mouth: part river green, part lake red.
        const mouth = at(5, 0);
        expect(mouth.rgb[0]).toBeGreaterThan(0.05);
        expect(mouth.rgb[1]).toBeGreaterThan(0.05);
        const encoded = field.encode(field.ranges()).look;
        const k = Math.round((-60 - grid.minZ) / grid.sizeZ * (grid.nz - 1)) * grid.nx + Math.round((-60 - grid.minX) / grid.sizeX * (grid.nx - 1));
        expect(encoded[k * 4 + 3]).toBe(255);
    });
});

describe('a river that runs into a lake', () => {
    it('is the lake\'s water inside the lake, at the lake\'s level, and its own outside it', () => {
        const stations = [];
        for (let x = -90; x <= 10; x += 1) stations.push({ x, z: 0, y: -3, half: 3, dx: 1, dz: 0, speed: 2 });
        const river = { kind: 'river' as const, key: 2, waveHeight: 0.2, shoreWidth: 1, stations };
        const field = WaterField.bake(grid, [river, lakeAt(20, 0, 30, 0)]);
        // Well inside the lake, on the river's course: no trench where the river's lower surface would be.
        expect(field.sample(20, 0)!.key).toBe(1);
        expect(field.sample(20, 0)!.height).toBeCloseTo(0, 3);
        expect(Math.hypot(field.sample(20, 0)!.flowX, field.sample(20, 0)!.flowZ)).toBeLessThan(1e-3);
        expect(field.sample(-60, 0)!.key).toBe(2);
        expect(field.sample(-60, 0)!.height).toBeCloseTo(-3, 3);
    });
});

describe('basins and drainage', () => {
    it('finds each hollow, filled to where it runs over, and where that is', () => {
        const map = findBasins(grid, island, { minDepth: 0.5 });
        const walled = map.basins.find((b) => Math.hypot(b.deepest.x + 25, b.deepest.z) < 3)!;
        expect(walled).toBeDefined();
        expect(walled.deepest.y).toBeLessThan(0);
        // It fills to the lowest point of its rim, and runs over there.
        expect(walled.level).toBeGreaterThan(walled.deepest.y + 10);
        expect(walled.outlet.y).toBeCloseTo(walled.level, 0);
        expect(Math.hypot(walled.outlet.x + 25, walled.outlet.z)).toBeLessThan(20);
    });

    it('with a sea level, takes the hollow the sea reaches for sea, and keeps the walled-off one a basin', () => {
        const map = findBasins(grid, island, { seaLevel: 0, minDepth: 0.5 });
        const k = (x: number, z: number) => (z + 100) * grid.nx + (x + 100);
        expect(map.sea[k(30, 0)]).toBe(1);
        expect(map.sea[k(-25, 0)]).toBe(0);
        expect(map.basin[k(-25, 0)]).toBeGreaterThanOrEqual(0);
        expect(map.basin[k(30, 0)]).toBe(-1);
    });

    it('drains every place to the edge, gathering as it goes', () => {
        const map = findBasins(grid, island);
        const path = drainPath(map, 10, 10);
        expect(path.length).toBeGreaterThan(2);
        const last = path[path.length - 1]!;
        expect(Math.max(Math.abs(last.x), Math.abs(last.z))).toBeCloseTo(100, 6);
        // Water only goes down (or level, across a filled basin) along its course.
        for (let i = 1; i < path.length; i++) expect(path[i]!.y).toBeLessThanOrEqual(path[i - 1]!.y + 1e-4);
        const total = map.accumulation.reduce((s, v, k) => (map.downstream[k] === -1 ? s + v : s), 0);
        expect(total).toBe(grid.nx * grid.nz);
    });
});

describe('the water in a running app with no renderer', () => {
    it('keeps scene warm-up open until a budgeted water bake can answer a surface query', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const app = App.new();
        const module = Object.assign(createMockModule(), { renderer_getPendingShaders: () => 0 });
        app.connectCpp(module.getRegistry(), module);
        app.addPlugin(new WaterPlugin());
        const sea = app.world.spawn();
        app.world.insert(sea, Transform);
        app.world.insert(sea, WaterBody, { ...WaterBody._default, form: WaterForm.Ocean, waveHeight: 0 });
        const bakes = bakesOf(app);
        bakes.budgetMs = 0;
        const pendingByFrame: number[] = [];
        const warmed = await warmShaders(app, {
            onProgress: (_pending, making) => {
                pendingByFrame.push(making);
                if (pendingByFrame.length === 4) bakes.budgetMs = 100;
            },
        });
        expect(warmed.timedOut).toBe(false);
        expect(pendingByFrame.slice(0, 4)).toEqual([1, 1, 1, 1]);
        expect(app.getResource(WatersRes).sample(0, 0, 0)?.entity).toBe(sea);
    });

    it('names the body a place belongs to by the id the game gave it, the same in every session', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const app = App.new();
        const module = createMockModule();
        app.connectCpp(module.getRegistry(), module);
        app.addPlugin(new WaterPlugin());
        app.addPlugin(new UnderwaterPlugin());
        const zone = app.world.spawn();
        app.world.insert(zone, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(zone, WaterZone, { ...WaterZone._default, sizeX: 200, sizeZ: 200 });
        const lake = app.world.spawn();
        app.world.insert(lake, Transform, { position: { x: 0, y: 2, z: 0 }, worldPosition: { x: 0, y: 2, z: 0 } });
        app.world.insert(lake, WaterBody, { ...WaterBody._default, form: WaterForm.Lake, bodyId: 'mirror-lake', sizeX: 60, sizeZ: 60 });
        for (let i = 0; i < 40; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); }
        const waters = app.getResource(WatersRes);
        expect(waters.bodyAt(0, 0)).toMatchObject({ entity: lake, bodyId: 'mirror-lake', form: WaterForm.Lake });
        expect(waters.bodyAt(0, 0)!.level).toBeCloseTo(2, 3);
        expect(waters.sample(0, 0, 0)?.bodyId).toBe('mirror-lake');
        // No terrain under it: the depth of water nothing is known of.
        expect(waters.sample(0, 0, 0)!.waterDepth).toBeGreaterThan(1e5);
        // A room kept out of the lake under its surface: dry inside, water above it and beside it.
        const room = app.world.spawn();
        app.world.insert(room, Transform, { position: { x: 0, y: -3, z: 0 }, worldPosition: { x: 0, y: -3, z: 0 } });
        app.world.insert(room, WaterBody, { ...WaterBody._default, form: WaterForm.Exclusion, sizeX: 10, sizeZ: 10, sizeY: 4 });
        for (let i = 0; i < 10; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); }
        expect(waters.sample(0, -3, 0)).toBeNull();
        expect(waters.sample(0, 0, 0)?.bodyId).toBe('mirror-lake');
        expect(waters.sample(8, -3, 0)?.bodyId).toBe('mirror-lake');
        // Seen from under the lake: the zone material's look, until the lake has its own.
        const eye = app.world.spawn();
        app.world.insert(eye, Transform, { position: { x: 20, y: 0, z: 0 }, worldPosition: { x: 20, y: 0, z: 0 } });
        app.world.insert(eye, Camera, { isActive: true, nearPlane: 0.1 });
        const step = async (): Promise<void> => { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); };
        await step();
        expect(currentUnderwater()?.absorption).toEqual([0.45, 0.09, 0.05]);
        app.world.insert(lake, WaterBody, { ...app.world.get(lake, WaterBody), underwaterLook: UnderwaterLook.Own,
            underwaterColor: { r: 0.4, g: 0.3, b: 0.1, a: 1 }, underwaterAbsorption: { r: 0.1, g: 0.2, b: 0.9, a: 1 }, underwaterDensity: 2, underwaterCaustics: 0 });
        await step();
        const own = currentUnderwater()!;
        expect(own.absorption).toEqual([0.1, 0.2, 0.9]);
        // The body's density is per metre; the effect takes it per world unit (100 a metre here).
        expect(own.density).toBeCloseTo(2 / worldUnitsPerMeter(), 9);
        expect(own.causticStrength).toBe(0);
        expect(own.scatter[0]).toBeGreaterThan(own.scatter[2]);
        app.world.despawn(eye);
        expect(waters.bodyAt(90, 90)).toBeNull();
        // How far from the water's edge: across the dry ground beside it, and in from the shore on it.
        expect(waters.shoreAt(45, 0)).toBeCloseTo(15, -0.5);
        expect(waters.shoreAt(0, 0)).toBeLessThan(-20);
    });
});
