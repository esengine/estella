// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planWorker.ts
 * @brief   The script a planning worker runs: what a planet's world places in a square of one of its faces, worked out off the main thread.
 *
 * @details This file is bundled on its own (sdk/scripts/build-worker.mjs) into text the engine starts workers from, so it imports only what planning
 *          needs, none of the engine's runtime. It speaks the pool's protocol (runtime/jobs.ts): a message `{ id, spec?, key, ... }` is answered with
 *          `{ id, result }` or `{ id, error }`.
 *
 *          A plan is made once for a key and kept, so what it works out (the groups of a layer, the viability of a candidate) is shared by every square asked
 *          of it. The planet's provider is the game's own generator, handed over as the text of a self-contained module and loaded here, which is what lets
 *          the ground be read in the worker with no help from the main thread.
 */
import type { Placement } from './plan';
import type { WorldPlan } from './plan';
import type { WorldRules } from './rules';
import type { ZoneDef } from './zones';
import { Zones } from './zones';
import { PlanetFace } from './planetSurface';
import { farRulesOf, makeFacePlan } from './facePlan';
import { makePlanePlan } from './planePlan';
import { GroundQuery, groundSourceOf, type GroundData } from '../terrain/groundQuery';
import type { TerrainSource } from '../terrain/source';
import { WaterQuery, type WaterQueryData } from '../water/waterQuery';
import type { PlanetFacts } from '../terrain/planetQuery';
import type { PlanetProvider } from '../terrain/planetProvider';
import type { PlanetPainter } from '../terrain/planetQuery';
import { faceOf, type SphereNode } from '../terrain/sphere';
import { makePlanetPage, type PlanetPageSource } from '../terrain/planetPages';
import { makePage, type PageImage } from '../terrain/pages';
import type { MeshData } from '../asset/meshFormat';
import { buildFoliageCell, cellTransfers, type CellSurroundings, type DensityMap, type FoliageCellSpec } from '../foliage/cellBuild';

/** What a plan is made from: everything the main thread knew when it made its own. */
export interface PlanSpec {
    rules: WorldRules;
    seed: number;
    world: string;
    seaLevel: number;
    face: number;
    radius: number;
    centre: [number, number, number];
    layers: string[];
    fieldNames: string[];
    /** The zones over the face, in its plane. */
    zones: ZoneDef[];
    /** The planet's provider: the text of a module whose default export is it, and what it is asked with. */
    provider: { source: string; seed: number; version: number; world: string };
}

/** What a plan on a plane is made from: the ground and the water as data, the rules and the zones. */
export interface PlaneSpec {
    plane: true;
    rules: WorldRules;
    seed: number;
    world: string;
    /** The ground, or null for a world flat at `flatY`. */
    ground: GroundData | null;
    flatY: number;
    water: WaterQueryData | null;
    layers: string[];
    zones: ZoneDef[];
}

/** A question: the square of the face's plane, and whether it is the far plan's. */
export interface PlacementsRequest {
    id: number;
    /** Names the plan; a worker that has not seen it is sent `spec` with it. */
    key: string;
    spec?: PlanSpec | PlaneSpec;
    layer: string;
    far: boolean;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

interface Made {
    plan: WorldPlan; farPlan: WorldPlan | null; face: PlanetFace | null;
    /** A plane's ground as its terrain reads it (in the terrain's own space) and where that terrain stands: what its pages are made from. */
    ground?: { source: TerrainSource; origin: { x: number; y: number; z: number } } | null;
}

/** The plans kept, newest last, and the providers loaded (by the text of their source). */
const plans = new Map<string, Made>();
const providers = new Map<string, Promise<PlanetProvider>>();
const PLANS_KEPT = 24;

/** How the text of a provider's module becomes the provider: a blob the worker imports. A test, which has no blob to import, gives its own. */
export type ProviderLoader = (source: string) => Promise<PlanetProvider>;

const blobLoader: ProviderLoader = (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    return import(/* @vite-ignore */ url).then((m: { default: PlanetProvider }) => m.default).finally(() => URL.revokeObjectURL(url));
};

function providerOf(source: string, load: ProviderLoader): Promise<PlanetProvider> {
    let p = providers.get(source);
    if (!p) { p = load(source); providers.set(source, p); }
    return p;
}

function makePlane(spec: PlaneSpec): Made {
    const zones = new Zones();
    for (const z of spec.zones) zones.set(z);
    return {
        face: null,
        ground: spec.ground ? { source: groundSourceOf(spec.ground), origin: spec.ground.origin } : null,
        ...makePlanePlan({
            rules: spec.rules, farRules: farRulesOf(spec.rules), seed: spec.seed, world: spec.world, zones,
            ground: spec.ground ? new GroundQuery(spec.ground) : null, flatY: spec.flatY, water: spec.water ? new WaterQuery(spec.water) : null, layers: spec.layers,
        }),
    };
}

async function makeFor(spec: PlanSpec, load: ProviderLoader): Promise<Made> {
    const provider = await providerOf(spec.provider.source, load);
    const facts: PlanetFacts = {
        centre: spec.centre, radius: spec.radius, gravity: 0, height: null, paint: null, layers: spec.layers, fieldNames: spec.fieldNames, fieldsAt: null,
        sampleMany: (directions, count) => {
            const got = provider.sample({ world: spec.provider.world, seed: spec.provider.seed, version: spec.provider.version, radius: spec.radius, directions, count });
            if (got instanceof Promise) throw new Error('a provider used in a worker must answer at once');
            return got;
        },
    };
    const face = new PlanetFace(spec.face, () => facts);
    const zones = new Zones();
    for (const z of spec.zones) zones.set(z);
    return { face, ...makeFacePlan(face, {
        rules: spec.rules, farRules: farRulesOf(spec.rules), seed: spec.seed, world: spec.world, seaLevel: spec.seaLevel,
        layers: spec.layers, fieldNames: spec.fieldNames, zones,
    }) };
}

/** The plan for `key`: the one this worker kept, or one made from `spec`. */
async function planFor(key: string, spec: PlanSpec | PlaneSpec | null | undefined, load: ProviderLoader): Promise<Made> {
    let made = plans.get(key);
    if (!made) {
        if (!spec) throw new Error(`the plan ${key} is not known to this worker`);
        made = 'plane' in spec ? makePlane(spec) : await makeFor(spec, load);
        plans.set(key, made);
        if (plans.size > PLANS_KEPT) plans.delete(plans.keys().next().value!);
    }
    return made;
}

/** The placements of a layer in a square, as the plan for `key` has them. @internal */
export async function placements(r: PlacementsRequest, load: ProviderLoader = blobLoader): Promise<Placement[]> {
    const made = await planFor(r.key, r.spec, load);
    const plan = r.far && made.farPlan ? made.farPlan : made.plan;
    return plan.placementsIn(r.x0, r.z0, r.x1, r.z1, [r.layer]);
}


/** A planet's page to make: its node, the planet's numbers, and (when a world paints the ground) the six faces' plans by key, each with its spec when this worker has none. */
export interface PageRequest {
    id: number;
    type: 'page';
    node: SphereNode;
    levels: number;
    radius: number;
    minHeight: number;
    maxHeight: number;
    provider: { source: string; seed: number; version: number; world: string };
    paintKeys: string[] | null;
    specs: (PlanSpec | null)[];
}

/** The page of a planet's node: heights, normals and paint, the paint by the biomes of the world when it is painted by one. @internal */
export async function page(r: PageRequest, load: ProviderLoader = blobLoader): Promise<{ result: PageImage; transfer: ArrayBuffer[] }> {
    const provider = await providerOf(r.provider.source, load);
    let painter: PlanetPainter | null = null;
    if (r.paintKeys) {
        const keys = r.paintKeys;
        const made = await Promise.all(keys.map((k, f) => planFor(k, r.specs[f], load)));
        painter = (dx, dy, dz, base) => {
            const m = made[faceOf(dx, dy, dz).face]!;
            const at = m.face!.planeOf(dx, dy, dz);
            return at ? m.plan.paint(at.x, at.z, base) : base;
        };
    }
    const src: PlanetPageSource = { provider, world: r.provider.world, seed: r.provider.seed, version: r.provider.version, radius: r.radius, levels: r.levels, minHeight: r.minHeight, maxHeight: r.maxHeight, ...(painter ? { paint: () => painter } : {}) };
    const image = await makePlanetPage(src, r.node);
    return { result: image, transfer: [image.heights.buffer as ArrayBuffer, image.paint.buffer as ArrayBuffer, image.paint2.buffer as ArrayBuffer] };
}

/** A page of a plane's terrain to make: the square of the terrain's own space, and the plan whose biomes paint it. */
export interface GroundPageRequest {
    id: number;
    type: 'groundPage';
    /** Names the plan, as a placements question does; a worker that has not seen it is sent `spec` with it. */
    key: string;
    spec?: PlaneSpec;
    x0: number;
    z0: number;
    size: number;
    /** Whether the world has the last word on the ground's paint. */
    paint: boolean;
}

/**
 * The page of a terrain's node, as the terrain would make it: the same source, sampled at the same points, painted by the same plan.
 * The paint is the part worth leaving the main thread for: a world's biomes are read at every sample, tens of milliseconds a page.
 * @internal
 */
export async function groundPage(r: GroundPageRequest, load: ProviderLoader = blobLoader): Promise<{ result: PageImage; transfer: ArrayBuffer[] }> {
    const made = await planFor(r.key, r.spec, load);
    const ground = made.ground;
    if (!ground) throw new Error(`the plan ${r.key} has no ground to make a page of`);
    const { origin } = ground;
    // The terrain hands its repaint world positions, and so does this.
    const image = await makePage(ground.source, r.x0, r.z0, r.size, r.paint ? (x, z, _h, _ny, w) => made.plan.paint(x + origin.x, z + origin.z, w) : undefined);
    return { result: image, transfer: [image.heights.buffer as ArrayBuffer, image.paint.buffer as ArrayBuffer, image.paint2.buffer as ArrayBuffer] };
}

/** What a Foliage's cells are grown against, as data: the ground (none for a flat area), the water, the zones that keep plants out. */
export interface FoliageSurroundingsSpec {
    ground: GroundData | null;
    flatY: number;
    water: WaterQueryData | null;
    zones: ZoneDef[];
    density?: DensityMap | null;
    scale?: DensityMap | null;
}

/** A cell of a Foliage to grow. */
export interface FoliageCellRequest {
    id: number;
    type: 'foliageCell';
    /** Names what the cell is grown against; a worker that has not seen it is sent `around` with it. */
    key: string;
    around?: FoliageSurroundingsSpec;
    /** Names the mesh a cell of copies copies; a worker that has not seen it is sent `source` with it. Absent for grass. */
    sourceKey?: string;
    source?: MeshData;
    cell: FoliageCellSpec;
}

const surroundings = new Map<string, CellSurroundings>();
const plantSources = new Map<string, MeshData>();
const SURROUNDINGS_KEPT = 8;

/** The geometry of a Foliage's cell, as the main thread would build it: the same function, given the same ground as data. @internal */
export function foliageCell(r: FoliageCellRequest): { result: MeshData[]; transfer: ArrayBuffer[] } {
    let around = surroundings.get(r.key);
    if (!around) {
        if (!r.around) throw new Error(`what the foliage ${r.key} grows against is not known to this worker`);
        const zones = new Zones();
        for (const z of r.around.zones) zones.set(z);
        around = {
            ground: r.around.ground ? new GroundQuery(r.around.ground) : null, flatY: r.around.flatY,
            water: r.around.water ? new WaterQuery(r.around.water) : null, zones, density: r.around.density ?? null, scale: r.around.scale ?? null,
        };
        surroundings.set(r.key, around);
        if (surroundings.size > SURROUNDINGS_KEPT) surroundings.delete(surroundings.keys().next().value!);
    }
    let source: MeshData | null = null;
    if (r.sourceKey !== undefined) {
        if (r.source) {
            plantSources.set(r.sourceKey, r.source);
            if (plantSources.size > SURROUNDINGS_KEPT) plantSources.delete(plantSources.keys().next().value!);
        }
        source = plantSources.get(r.sourceKey) ?? null;
        if (!source) throw new Error(`the mesh ${r.sourceKey} is not known to this worker`);
    }
    const meshes = buildFoliageCell(r.cell, around, source);
    return { result: meshes, transfer: cellTransfers(meshes) };
}

// The worker's loop. Absent where this file is imported as a module (a test), where `self` is not a worker's scope.
declare const self: { onmessage: ((e: { data: PlacementsRequest | PageRequest | GroundPageRequest | FoliageCellRequest }) => void) | null; postMessage(m: unknown, transfer?: ArrayBuffer[]): void } | undefined;
if (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function') {
    self.onmessage = (e) => {
        const m = e.data;
        const fail = (err: unknown): void => self!.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
        if ((m as { type?: string }).type === 'page') page(m as PageRequest).then((r) => self!.postMessage({ id: m.id, result: r.result }, r.transfer), fail);
        else if ((m as { type?: string }).type === 'groundPage') groundPage(m as GroundPageRequest).then((r) => self!.postMessage({ id: m.id, result: r.result }, r.transfer), fail);
        else if ((m as { type?: string }).type === 'foliageCell') {
            try { const r = foliageCell(m as FoliageCellRequest); self!.postMessage({ id: m.id, result: r.result }, r.transfer); } catch (err) { fail(err); }
        }
        else placements(m as PlacementsRequest).then((result) => self!.postMessage({ id: m.id, result }), fail);
    };
}
