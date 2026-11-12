// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import type { PlanetFacts } from '../src/terrain/planetQuery';
import { PlanetFace, FaceZones } from '../src/worldgen/planetSurface';
import { farRulesOf, makeFacePlan } from '../src/worldgen/facePlan';
import { foliageCell, groundPage, page, placements, type FoliageCellRequest, type FoliageSurroundingsSpec, type GroundPageRequest, type PageRequest, type PlacementsRequest, type PlanSpec, type PlaneSpec } from '../src/worldgen/planWorker';
import { makePlanePlan } from '../src/worldgen/planePlan';
import { GroundQuery, groundSourceOf, type GroundData } from '../src/terrain/groundQuery';
import { makePageJob, type PageImage } from '../src/terrain/pages';
import { noiseProvider, ProviderSource } from '../src/terrain/provider';
import { ModifiedSource } from '../src/terrain/source';
import { paintWeights } from '../src/terrain/paint';
import { buildFoliageCell, type FoliageCellSpec } from '../src/foliage/cellBuild';
import { buildGrassMesh } from '../src/foliage/builder';
import { WaterQuery, type WaterQueryData } from '../src/water/waterQuery';
import { Zones } from '../src/worldgen/zones';
import { makePlanetPage } from '../src/terrain/planetPages';
import { faceOf } from '../src/terrain/sphere';
import { PLAN_WORKER_SOURCE } from '../src/runtime/planWorkerBundle.generated';
import type { WorldRules } from '../src/worldgen/rules';
import { createJobPool } from '../src/runtime/jobs';

const radius = 4000;
/** A provider as a game writes it for a worker: a module of plain JavaScript whose default export answers. */
const providerSource = `
const fields = ['ecology.island', 'ecology.wild'];
export default {
    id: 'test', versions: [1], range: () => [-10, 40], fields,
    sample({ radius, directions, count }) {
        const heights = new Float32Array(count), paint = new Float32Array(count * 4), f = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            const x = directions[i * 3], y = directions[i * 3 + 1], z = directions[i * 3 + 2];
            heights[i] = 6 + 5 * Math.sin(x * 40) * Math.cos(z * 33) + 3 * y;
            paint[i * 4] = 0.7; paint[i * 4 + 1] = 0.3;
            f[i * 2] = 0.5 + 0.5 * Math.sin(x * 20); f[i * 2 + 1] = 1 - f[i * 2];
        }
        return { heights, paint, fields: f };
    },
};`;

const loader = async (source: string) => (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

const rules: WorldRules = {
    id: 't', versions: [1],
    biomes: [{ id: 'meadow', transition: 3, conditions: [{ field: 'height', min: -100, max: 100 }, { field: 'ecology.island', min: 0.3, blend: 0.2 }, { field: 'paint.grass', min: 0.2, blend: 0.2 }], recipes: [{ recipe: 'tuft', layer: 'cover', density: 1 }] }],
    recipes: [{ id: 'tuft', version: 1, anchor: { id: 'a', mesh: 1, material: 1, footprint: 0.4 }, members: [{ id: 'b', mesh: 1, material: 1, footprint: 0.2, ring: [0.5, 1.5], count: [1, 3] }] }],
    layers: [{ id: 'cover', spacing: 6, drawDistance: 100, farSpacing: 2 }],
    noise: { moisture: { scale: 40, octaves: 2 } },
};

const spec = (face: number): PlanSpec => ({
    rules, seed: 9, world: 'w', seaLevel: 0, face, radius, centre: [0, -radius, 0], layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'],
    zones: [], provider: { source: providerSource, seed: 9, version: 1, world: 'w' },
});

/** What the main thread makes for the same face, with the same provider. */
async function onMain(face: number, layer: string, far: boolean, sq: [number, number, number, number]) {
    const provider = await loader(providerSource);
    const facts: PlanetFacts = {
        centre: [0, -radius, 0], radius, gravity: 0, height: null, paint: null, layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'], fieldsAt: null,
        sampleMany: (directions, count) => provider.sample({ world: 'w', seed: 9, version: 1, radius, directions, count }),
    };
    const f = new PlanetFace(face, () => facts);
    const zones = new FaceZones(f);
    const { plan, farPlan } = makeFacePlan(f, { rules, farRules: farRulesOf(rules), seed: 9, world: 'w', seaLevel: 0, layers: facts.layers, fieldNames: facts.fieldNames, zones: zones.zones });
    return (far && farPlan ? farPlan : plan).placementsIn(sq[0], sq[1], sq[2], sq[3], [layer]);
}

describe('a planet\'s pages made in a worker', () => {
    it('are the pages the main thread makes, with the world\'s biomes painting the ground', async () => {
        const provider = await loader(providerSource);
        const facts: PlanetFacts = {
            centre: [0, -radius, 0], radius, gravity: 0, height: null, paint: null, layers: ['grass', 'dirt', 'snow', 'rock'], fieldNames: ['ecology.island', 'ecology.wild'], fieldsAt: null,
            sampleMany: (directions, count) => provider.sample({ world: 'w', seed: 9, version: 1, radius, directions, count }),
        };
        const faces = [0, 1, 2, 3, 4, 5].map((f) => {
            const face = new PlanetFace(f, () => facts);
            const zones = new FaceZones(face);
            return { face, ...makeFacePlan(face, { rules, farRules: null, seed: 9, world: 'w', seaLevel: 0, layers: facts.layers, fieldNames: facts.fieldNames, zones: zones.zones }) };
        });
        const painter = (dx: number, dy: number, dz: number, base: readonly number[]) => {
            const u = faces[faceOf(dx, dy, dz).face]!;
            const at = u.face.planeOf(dx, dy, dz);
            return at ? u.plan.paint(at.x, at.z, base) : base;
        };
        const node = { face: 2, level: 3, ix: 5, iz: 6 };
        const common = { levels: 8, radius, minHeight: -10, maxHeight: 40 };
        const here = await makePlanetPage({ provider, world: 'w', seed: 9, version: 1, ...common, paint: () => painter }, node);
        const keys = [0, 1, 2, 3, 4, 5].map((f) => `pk${f}`);
        const request: PageRequest = {
            id: 1, type: 'page', node, ...common, provider: { source: providerSource, seed: 9, version: 1, world: 'w' },
            paintKeys: keys, specs: keys.map((_k, f) => spec(f)),
        };
        const away = (await page(request, loader)).result;
        expect(Buffer.from(away.heights)).toEqual(Buffer.from(here.heights));
        expect(Buffer.from(away.paint)).toEqual(Buffer.from(here.paint));
        expect(away.min).toBe(here.min);
        expect(away.max).toBe(here.max);
        // And without a painter, the provider's own paint.
        const plainHere = await makePlanetPage({ provider, world: 'w', seed: 9, version: 1, ...common }, node);
        const plainAway = (await page({ ...request, id: 2, paintKeys: null, specs: [] }, loader)).result;
        expect(Buffer.from(plainAway.paint)).toEqual(Buffer.from(plainHere.paint));
    });
});

describe('a planet\'s world planned in a worker', () => {
    it('places exactly what the main thread places, near and far, on any face', async () => {
        for (const face of [0, 2, 5]) {
            for (const far of [false, true]) {
                const sq: [number, number, number, number] = [-40, 10, 56, 106];
                const request: PlacementsRequest = { id: 1, key: `k${face}`, spec: spec(face), layer: 'cover', far, x0: sq[0], z0: sq[1], x1: sq[2], z1: sq[3] };
                const away = await placements(request, loader);
                const here = await onMain(face, 'cover', far, sq);
                expect(away.length).toBeGreaterThan(5);
                expect(JSON.parse(JSON.stringify(away))).toEqual(JSON.parse(JSON.stringify(here)));
            }
        }
    });

    it('keeps a plan it was sent and answers later questions from it', async () => {
        const first: PlacementsRequest = { id: 1, key: 'kept', spec: spec(2), layer: 'cover', far: false, x0: 0, z0: 0, x1: 48, z1: 48 };
        await placements(first, loader);
        const second = await placements({ id: 2, key: 'kept', layer: 'cover', far: false, x0: 48, z0: 0, x1: 96, z1: 48 }, loader);
        expect(second.length).toBeGreaterThan(0);
        await expect(placements({ id: 3, key: 'unknown', layer: 'cover', far: false, x0: 0, z0: 0, x1: 8, z1: 8 }, loader)).rejects.toThrow(/not known/);
    });

    it('is a script a worker can start from: valid, and answering on the message loop', () => {
        expect(PLAN_WORKER_SOURCE.length).toBeGreaterThan(1000);
        expect(() => new Function(PLAN_WORKER_SOURCE)).not.toThrow();
        expect(PLAN_WORKER_SOURCE).toContain('onmessage');
    });

    it('has no pool where there is no Worker, so the caller plans in place', () => {
        expect(createJobPool(PLAN_WORKER_SOURCE)).toBeNull();
    });
});

describe('a flat world planned in a worker', () => {
    const ground: GroundData = {
        origin: { x: 0, y: 2, z: 0 }, cell: 2,
        source: { kind: 'noise', data: { seed: 5, frequency: 6, octaves: 3, persistence: 0.5, ridged: 0, warp: 0, erosion: 0, sizeX: 400, height: 30, rockSlope: 0.7, dirtHeight: 0.3, snowHeight: 0.9 } },
    };
    const n = 16;
    const water: WaterQueryData = {
        grid: { minX: -200, minZ: -200, sizeX: 400, sizeZ: 400, nx: n, nz: n },
        height: new Float32Array(n * n).fill(8),
        shore: Float32Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.37) * 6),
        ocean: null,
    };
    const flatRules: WorldRules = { ...rules, biomes: [{ ...rules.biomes![0]!, conditions: [{ field: 'height', min: -100, max: 100 }, { field: 'shoreDistance', max: 4 }] }] };
    const planeSpec: PlaneSpec = { plane: true, rules: flatRules, seed: 9, world: 'w', ground, flatY: 0, water, layers: ['grass', 'dirt', 'snow', 'rock'], zones: [] };

    it('places exactly what the main thread places from the same ground and water', async () => {
        const { plan, farPlan } = makePlanePlan({
            rules: flatRules, farRules: farRulesOf(flatRules), seed: 9, world: 'w', zones: new Zones(), ground: new GroundQuery(ground), flatY: 0,
            water: new WaterQuery(water), layers: planeSpec.layers,
        });
        for (const far of [false, true]) {
            const request: PlacementsRequest = { id: 1, key: `plane${far}`, spec: structuredClone(planeSpec), layer: 'cover', far, x0: -60, z0: -40, x1: 60, z1: 80 };
            const away = await placements(request, loader);
            const here = (far && farPlan ? farPlan : plan).placementsIn(-60, -40, 60, 80, ['cover']);
            expect(away.length).toBeGreaterThan(5);
            expect(JSON.parse(JSON.stringify(away))).toEqual(JSON.parse(JSON.stringify(here)));
        }
    });
});

// A terrain's pages cost the frame tens of milliseconds each once a world's biomes paint them, so they are made where the plan is.
// What comes back has to be the page the terrain would have made itself, byte for byte: a seam between a page made here and one
// made there is a line across the ground.
describe("a terrain's pages made in a worker", () => {
    const params = { seed: 5, frequency: 6, octaves: 4, persistence: 0.5, ridged: 0.3, warp: 0.35, erosion: 1, sizeX: 400, height: 60, rockSlope: 0.5, dirtHeight: 0.4, snowHeight: 0.9 };
    // The engine's noise as a provider is the world's ground: a terrain standing at (120, 3, -30) reads it there.
    const origin = { x: 120, y: 3, z: -30 };
    const ground: GroundData = { origin, cell: 2, source: { kind: 'noise', data: params }, shift: { x: origin.x, z: origin.z } };
    const paintRules: WorldRules = { ...rules, biomes: [{ ...rules.biomes![0]!, conditions: [{ field: 'height', min: -100, max: 100 }], paint: { grass: 0.2, dirt: 0.8 } } as never] };
    const planeSpec: PlaneSpec = { plane: true, rules: paintRules, seed: 9, world: 'w', ground, flatY: 0, water: null, layers: ['grass', 'dirt', 'snow', 'rock'], zones: [] };

    /** The terrain's own source for that ground, as terrainPlugin makes it, and the page it makes on the main thread. */
    const here = (x0: number, z0: number, size: number, paint: boolean): PageImage => {
        const provider = noiseProvider(() => params);
        const base = new ProviderSource(provider, 'w', params.seed, 1, origin.x, origin.z, 2, (h, ny) => paintWeights(h / Math.max(params.height, 1e-6), ny, params));
        const source = new ModifiedSource(base, () => [], origin, 2);
        const { plan } = makePlanePlan({
            rules: paintRules, farRules: farRulesOf(paintRules), seed: 9, world: 'w', zones: new Zones(), ground: new GroundQuery(ground), flatY: 0, water: null, layers: planeSpec.layers,
        });
        const job = makePageJob(source, x0, z0, size, paint ? (x, z, _h, _ny, w) => plan.paint(x + origin.x, z + origin.z, w) : undefined);
        for (;;) { const next = job.next(); if (next.done) return next.value; }
    };

    it("reads the same ground as the terrain standing on a provider's world", () => {
        const provider = noiseProvider(() => params);
        const base = new ProviderSource(provider, 'w', params.seed, 1, origin.x, origin.z, 2, () => [1, 0, 0, 0]);
        const away = groundSourceOf(ground);
        for (const [x, z] of [[0, 0], [17.5, -3], [-400, 912.25], [3000, -2000]] as const) {
            expect(away.height(x, z)).toBe(base.height(x, z));
        }
        // And it is not the terrain's own noise read at its own origin, which is other ground.
        expect(groundSourceOf({ ...ground, shift: undefined }).height(17.5, -3)).not.toBe(base.height(17.5, -3));
    });

    it('are the pages the terrain makes, at every level, painted by the world or not', async () => {
        let k = 0;
        for (const [x0, z0, size] of [[0, 0, 128], [-256, 128, 128], [-2048, 0, 2048], [4096, -4096, 4096]] as const) {
            for (const paint of [true, false]) {
                const request: GroundPageRequest = { id: 1, type: 'groundPage', key: `ground${paint}`, ...(k++ < 2 ? { spec: structuredClone(planeSpec) } : {}), x0, z0, size, paint };
                const away = await groundPage(request, loader);
                const mine = here(x0, z0, size, paint);
                expect(away.result.min).toBe(mine.min);
                expect(away.result.max).toBe(mine.max);
                expect(Buffer.from(away.result.heights).equals(Buffer.from(mine.heights))).toBe(true);
                expect(Buffer.from(away.result.paint).equals(Buffer.from(mine.paint))).toBe(true);
                expect(Buffer.from(away.result.paint2).equals(Buffer.from(mine.paint2))).toBe(true);
                // Handed back, not copied: three buffers a page.
                expect(away.transfer).toHaveLength(3);
            }
        }
    });

    it('says so when its plan has no ground to make a page of', async () => {
        const request: GroundPageRequest = { id: 1, type: 'groundPage', key: 'flat', spec: { ...structuredClone(planeSpec), ground: null }, x0: 0, z0: 0, size: 128, paint: true };
        await expect(groundPage(request, loader)).rejects.toThrow(/no ground/);
    });
});

// A cell of grass is 4 to 12 ms of arithmetic, which is a frame's whole budget: it is made on a worker and only landed here.
describe("a Foliage's cells made in a worker", () => {
    const params = { seed: 5, frequency: 6, octaves: 4, persistence: 0.5, ridged: 0.3, warp: 0.35, erosion: 1, sizeX: 400, height: 60, rockSlope: 0.5, dirtHeight: 0.4, snowHeight: 0.9 };
    const ground: GroundData = { origin: { x: 0, y: 0, z: 0 }, cell: 2, source: { kind: 'noise', data: params }, shift: { x: 0, z: 0 } };
    const around: FoliageSurroundingsSpec = {
        ground, flatY: 0, water: null,
        zones: [{ id: 'home', kind: 'reserve', shape: { type: 'circle', x: 10, z: 10, radius: 6 }, falloff: 2, priority: 0, excludes: ['*'] } as never],
    };
    const cell: FoliageCellSpec = {
        centerX: 8, centerZ: 8, size: 16, count: 600, seed: 11, cellKey: 3004, minScale: 0.8, maxScale: 1.25, minUp: 0.3, heightMin: -1e5, heightMax: 1e5,
        waterDepth: 0, zonePadding: 0, tags: ['foliage', 'grass'], baseY: 0, paint: null, look: { kind: 'grass', bladeHeight: 1.4, bladeWidth: 0.16 },
    };
    const here = (spec: FoliageCellSpec) => {
        const zones = new Zones();
        for (const z of around.zones) zones.set(z);
        return buildFoliageCell(spec, { ground: new GroundQuery(ground), flatY: 0, water: null, zones }, null);
    };
    const same = (a: { vertices: Uint8Array; indices: Uint32Array }[], b: { vertices: Uint8Array; indices: Uint32Array }[]) => {
        expect(a).toHaveLength(b.length);
        for (let i = 0; i < a.length; i++) {
            expect(Buffer.from(a[i]!.vertices).equals(Buffer.from(b[i]!.vertices))).toBe(true);
            expect(Buffer.from(a[i]!.indices.buffer).equals(Buffer.from(b[i]!.indices.buffer))).toBe(true);
        }
    };

    it('are the cells the main thread grows, from the ground, the water and the zones as data', () => {
        const request: FoliageCellRequest = { id: 1, type: 'foliageCell', key: 'field', around: structuredClone(around), cell };
        const away = foliageCell(request);
        const mine = here(cell);
        expect(mine).toHaveLength(2);
        expect(mine[0]!.vertexCount).toBeGreaterThan(1000);
        same(away.result, mine);
        // Two meshes, a vertex and an index buffer each, handed back and not copied.
        expect(away.transfer).toHaveLength(4);
        // The zone is read: without it the cell grows more.
        const open = buildFoliageCell(cell, { ground: new GroundQuery(ground), flatY: 0, water: null, zones: null }, null);
        expect(open[0]!.vertexCount).toBeGreaterThan(mine[0]!.vertexCount);
    });

    it('keeps what a field grows against, and answers later cells from it', () => {
        foliageCell({ id: 1, type: 'foliageCell', key: 'kept', around: structuredClone(around), cell });
        const next = { ...cell, centerX: 24, cellKey: 3005 };
        same(foliageCell({ id: 2, type: 'foliageCell', key: 'kept', cell: next }).result, here(next));
        expect(() => foliageCell({ id: 3, type: 'foliageCell', key: 'never sent', cell })).toThrow(/not known to this worker/);
    });

    it('grows copies of a mesh it was sent once, and nothing where nothing can stand', () => {
        const blade = buildGrassMesh([{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 1 }], { height: 2, width: 0.5, paint: null, segments: 2, thin: 1 });
        const trees: FoliageCellSpec = { ...cell, count: 40, tags: ['foliage', 'tree'], look: { kind: 'mesh', card: { u0: 0, v0: 0, u1: 1, v1: 1 }, tent: false } };
        const first = foliageCell({ id: 1, type: 'foliageCell', key: 'trees', around: structuredClone(around), sourceKey: 'trees:mesh', source: structuredClone(blade), cell: trees });
        expect(first.result).toHaveLength(2);
        const zones = new Zones();
        for (const z of around.zones) zones.set(z);
        same(first.result, buildFoliageCell(trees, { ground: new GroundQuery(ground), flatY: 0, water: null, zones }, blade));
        // The mesh is not sent again.
        const again = foliageCell({ id: 2, type: 'foliageCell', key: 'trees', sourceKey: 'trees:mesh', cell: { ...trees, cellKey: 9 } });
        expect(again.result).toHaveLength(2);
        expect(() => foliageCell({ id: 3, type: 'foliageCell', key: 'trees', sourceKey: 'other:mesh', cell: trees })).toThrow(/not known to this worker/);
        // Too steep everywhere to grow on: no meshes, and nothing to hand back.
        const none = foliageCell({ id: 4, type: 'foliageCell', key: 'trees', cell: { ...cell, minUp: 2 } });
        expect(none.result).toEqual([]);
        expect(none.transfer).toEqual([]);
    });
});
