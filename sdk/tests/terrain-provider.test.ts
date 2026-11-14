// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';
import { Terrain, TerrainExtent, TerrainPlugin, TerrainsRes, paintWeights } from '../src/terrain/terrainPlugin';
import {
    noiseProvider, ProviderSource, registerTerrainProvider, TerrainUnavailable, type TerrainProvider, type TerrainRegion,
} from '../src/terrain/provider';
import { makePage, PAGE_SIDE, PAGE_TEXELS, type PageImage } from '../src/terrain/pages';
import { flattenModifier, type NoiseParams } from '../src/terrain/source';

// These scenes are written in metres: a project of one unit a metre, so the Terrain's own defaults are metres beside them.
beforeAll(() => setWorldUnitsPerMeter(1));
afterAll(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

const params: NoiseParams = { seed: 7, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.35, warp: 0.3, erosion: 1, sizeX: 2000, height: 300,
    rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 };
const paint = (h: number, ny: number) => paintWeights(h / 300, ny, params);
const ground = (provider: TerrainProvider, ox = 0, oz = 0, version = 1) => new ProviderSource(provider, 'planet-a', 7, version, ox, oz, 1, paint);

/** A provider of its own, as a game's generator would be: a function of the world position and the version, answering later. */
const terraced: TerrainProvider = {
    id: 'test:terraces',
    versions: [1, 2],
    range: () => [0, 100],
    sample(r: TerrainRegion) {
        const heights = new Float32Array(r.count * r.count);
        for (let j = 0; j < r.count; j++) for (let i = 0; i < r.count; i++) {
            const x = r.x0 + i * r.spacing, z = r.z0 + j * r.spacing;
            heights[j * r.count + i] = r.version === 1 ? 50 + 20 * Math.sin(x * 0.01) * Math.cos(z * 0.013) : 10;
        }
        return Promise.resolve({ heights });
    },
};

const heightOf = (page: PageImage, i: number, j: number): number => {
    const k = (j * PAGE_SIDE + i) * 4;
    return page.heights[k]! * 256 + page.heights[k + 1]!;
};

describe('ground from a provider', () => {
    it('is the same for the same world, seed, version and position', () => {
        const a = ground(noiseProvider(() => params)), b = ground(noiseProvider(() => params));
        for (const [x, z] of [[0, 0], [12345.5, -9876.25], [-77777, 31415]] as const) expect(a.height(x, z)).toBe(b.height(x, z));
    });

    it('is the same ground under two terrains placed apart: positions are the world\'s, not the terrain\'s', () => {
        const here = ground(noiseProvider(() => params), 0, 0), there = ground(noiseProvider(() => params), 5000, -3000);
        expect(there.height(100, 200)).toBe(here.height(5100, -2800));
    });

    it('fails, rather than growing other ground, for a version its provider does not have', () => {
        expect(() => ground(noiseProvider(() => params), 0, 0, 2)).toThrow(TerrainUnavailable);
    });

    it('shares every sample of an edge between two neighbouring pages, whichever is made first', () => {
        const src = ground(noiseProvider(() => params));
        const size = 64;
        const west = makePage(src, 0, 0, size) as PageImage, east = makePage(src, size, 0, size) as PageImage;
        const eastFirst = makePage(src, size, 0, size) as PageImage, westAfter = makePage(src, 0, 0, size) as PageImage;
        for (let j = 0; j < PAGE_SIDE; j++) {
            // The west page's far edge (its sample PAGE_TEXELS past the border) is the east page's near edge (its first past the border).
            expect(heightOf(west, PAGE_TEXELS + 1, j)).toBe(heightOf(east, 1, j));
            // The normals there are made from the same samples on both sides.
            const kw = (j * PAGE_SIDE + PAGE_TEXELS + 1) * 4, ke = (j * PAGE_SIDE + 1) * 4;
            expect(west.heights[kw + 2]).toBe(east.heights[ke + 2]);
            expect(west.heights[kw + 3]).toBe(east.heights[ke + 3]);
        }
        expect(Array.from(eastFirst.heights)).toEqual(Array.from(east.heights));
        expect(Array.from(westAfter.heights)).toEqual(Array.from(west.heights));
    });

    it('agrees between a coarse page and a fine one where their samples meet', () => {
        const src = ground(noiseProvider(() => params));
        const coarse = makePage(src, 0, 0, 128) as PageImage, fine = makePage(src, 0, 0, 64) as PageImage;
        // Every second sample of the fine page is a sample of the coarse one.
        for (let k = 0; k <= PAGE_TEXELS; k += 2) expect(heightOf(fine, 1 + k, 1)).toBe(heightOf(coarse, 1 + k / 2, 1));
    });

    it('takes a game\'s own provider, which may answer later, and keeps its versions apart', async () => {
        registerTerrainProvider(terraced);
        const v1 = new ProviderSource(terraced, 'planet-b', 1, 1, 0, 0, 1, paint);
        const v2 = new ProviderSource(terraced, 'planet-b', 1, 2, 0, 0, 1, paint);
        const p1 = makePage(v1, 0, 0, 64), p2 = makePage(v2, 0, 0, 64);
        expect(p1).toBeInstanceOf(Promise);
        const [a, b] = await Promise.all([p1, p2]);
        expect(a.max).toBeGreaterThan(b.max);
        // A point is answered once its tile has come in.
        expect(v1.height(10, 10)).toBeNull();
        await new Promise((r) => setTimeout(r, 0));
        expect(v1.height(10, 10)).toBeCloseTo(50 + 20 * Math.sin(0.1) * Math.cos(0.13), 3);
    });
});

describe('a Terrain with no renderer (a server)', () => {
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
    const settle = async (app: App) => { for (let i = 0; i < 4; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };

    it('answers the height of ground without end, the same as the provider', async () => {
        const app = boot();
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, ...params });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.status(e)).toEqual({ state: 'ready' });
        // On a lattice node the surface is the provider's sample itself.
        expect(terrains.heightAt(322, -654)).toBeCloseTo(ground(noiseProvider(() => params)).height(322, -654)!, 6);
    });

    it('fails, and answers nothing, when its provider is not registered or its version is gone', async () => {
        const app = boot();
        const missing = app.world.spawn(), old = app.world.spawn();
        for (const e of [missing, old]) app.world.insert(e, Transform, {});
        app.world.insert(missing, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, provider: 'test:nowhere' });
        app.world.insert(old, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, generatorVersion: 9 });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.status(missing)!.state).toBe('failed');
        expect(terrains.status(old)!.state).toBe('failed');
        expect(terrains.status(old)!.reason).toMatch(/version 9/);
        expect(terrains.heightAt(0, 0)).toBeNull();
    });

    it('reads an area with no heightmap from its provider where it stands, so areas side by side are one ground', async () => {
        const app = boot();
        const area = (x: number) => {
            const e = app.world.spawn();
            app.world.insert(e, Transform, { position: { x, y: 0, z: 0 }, worldPosition: { x, y: 0, z: 0 } });
            app.world.insert(e, Terrain, { ...Terrain._default, ...params, erosion: 0, sizeX: 1000, sizeZ: 1000, resolution: 257, cellSize: 2 });
            return e;
        };
        const west = area(-500), east = area(500);
        const endless = app.world.spawn();
        app.world.insert(endless, Transform, { position: { x: 0, y: 0, z: 9000 }, worldPosition: { x: 0, y: 0, z: 9000 } });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.status(west)!.state).toBe('ready');
        expect(terrains.status(east)!.state).toBe('ready');
        // Either side of the seam, and the same ground the provider gives there without end (its hills spread over the areas' size).
        const noise = ground(noiseProvider(() => ({ ...params, erosion: 0, sizeX: 1000 })));
        for (const z of [-300, 0, 220]) {
            const a = terrains.heightAt(-0.001, z)!, b = terrains.heightAt(0.001, z)!;
            expect(Math.abs(a - b)).toBeLessThan(0.5);
            expect(a).toBeCloseTo(noise.height(0, z)!, -1);
        }
    });

    it('stands on the same world ground when it is moved', async () => {
        const app = boot();
        const e = app.world.spawn();
        app.world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(e, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, ...params });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        const before = terrains.heightAt(1234, -566)!;
        app.world.insert(e, Transform, { position: { x: 700, y: 0, z: -300 }, worldPosition: { x: 700, y: 0, z: -300 } });
        await settle(app);
        expect(terrains.heightAt(1234, -566)).toBeCloseTo(before, 6);
    });

    it('fails an area with no heightmap whose provider has not the version asked for', async () => {
        const app = boot();
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, Terrain, { ...Terrain._default, generatorVersion: 4 });
        await settle(app);
        expect(app.getResource(TerrainsRes).status(e)!.reason).toMatch(/version 4/);
    });

    it('fails when its heightmap cannot be read, instead of growing noise in its place', async () => {
        const app = boot();
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, Terrain, { ...Terrain._default, heightmap: 'assets/missing.png' });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        expect(terrains.status(e)!.state).toBe('failed');
        expect(terrains.status(e)!.reason).toMatch(/heightmap/);
        expect(terrains.heightAt(0, 0)).toBeNull();
    });
});

describe('modifiers on the ground', () => {
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
    const settle = async (app: App) => { for (let i = 0; i < 4; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };

    it('level a plot for every reader, blend back at its edge, and leave the ground as it was when taken off', async () => {
        const app = boot();
        const e = app.world.spawn();
        app.world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
        app.world.insert(e, Terrain, { ...Terrain._default, extent: TerrainExtent.Infinite, ...params });
        await settle(app);
        const terrains = app.getResource(TerrainsRes);
        const before = [terrains.heightAt(0, 0)!, terrains.heightAt(60, 0)!, terrains.heightAt(200, 0)!];
        const revision = terrains.revision_;
        terrains.setModifier(flattenModifier('plot', { type: 'circle', x: 0, z: 0, radius: 40 }, 123, 30));
        expect(terrains.heightAt(0, 0)).toBeCloseTo(123, 6);
        expect(terrains.heightAt(20, -20)).toBeCloseTo(123, 6);
        expect(terrains.normalAt(10, 10)![1]).toBeCloseTo(1, 6);
        // Halfway through its edge, between the plot and the ground; past it, the ground untouched.
        const mid = terrains.heightAt(55, 0)!;
        expect(Math.min(123, terrains.heightBeneathAt(55, 0)!) - 1e-6).toBeLessThanOrEqual(mid);
        expect(terrains.heightAt(200, 0)).toBeCloseTo(before[2]!, 9);
        expect(terrains.heightBeneathAt(0, 0)).toBeCloseTo(before[0]!, 9);
        expect(terrains.revision_).toBeGreaterThan(revision);
        terrains.deleteModifier('plot');
        expect(terrains.heightAt(0, 0)).toBeCloseTo(before[0]!, 9);
        expect(terrains.heightAt(60, 0)).toBeCloseTo(before[1]!, 9);
    });
});
