// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldgenPlugin.ts
 * @brief   A generated world in the scene: a `WorldGen` names the game's rules, `WorldZone`s plan it, and what the rules place is
 *          published in chunks round the streaming sources.
 *
 * @details One plan (plan.ts) a WorldGen, read from the terrain's surface and the water, and laid over by the world's changes
 *          (diffs.ts) before anything is shown. Each of the rules' layers is a layer of procedural chunks (residency/chunks.ts), so
 *          it is made nearest first within the frame's budget, let go past its `drawDistance`, and made again with its old chunk kept
 *          until then when the ground or the water changes; a zone or a change touches only the chunks it reaches.
 *
 *            - Plant parts use shared geometry and per-instance LOD; other decoration is merged per mesh and material in a chunk.
 *            - What a game interacts with is an entity of its own, carrying a `PlacedObject` with its placement id and kind, so the
 *              game can find it, act on it and record what it did (`diffs.remove(id)` when it is felled).
 *            - The ground is painted by the biomes, when the WorldGen says so.
 *
 *          A server without a renderer makes the plan and the interactive entities, and nothing that is only drawn.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, RuntimeOnly, SceneOwner, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import { AssetScope, ownedAssetLease, type AssetLease } from '../asset/AssetLease';
import type { MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { Terrains, TerrainsRes } from '../terrain/terrainPlugin';
import { flattenModifier } from '../terrain/source';
import { buildBillboardMesh, buildInstancedMesh, type Plant } from '../foliage/builder';
import { chunksOf, ProceduralChunksRes, streamingSourcesOf, type ChunkLayerStatus, type ChunkSource } from '../residency/chunks';
import { plantGrowthOf, prepareKinds, type GrownCell, type ReadyKinds } from '../foliage/plantGrowth';
import { plantInteractionOf } from '../foliage/plantInteraction';
import { PlanetRegistryRes, type PlanetFacts } from '../terrain/planetQuery';
import { faceOf } from '../terrain/sphere';
import { Environment } from './fields';
import { farRulesOf, makeFacePlan } from './facePlan';
import { makePlanePlan } from './planePlan';
import type { WaterQueryData } from '../water/waterQuery';
import type { JobPool } from '../runtime/jobs';
import { firstSend, forgetSent, planPool } from '../runtime/planPool';
import type { PlacementsRequest, PlanSpec, PlaneSpec } from './planWorker';
import { FaceZones, faceHalf, planetFaces, type PlanetFace } from './planetSurface';
import { expandPlants, type PlantSet } from './plants';
import { WorldPlan, type Placement } from './plan';
import { worldRules, worldRulesRevision, type PlacementLayer, type RecipeMember, type WorldRules } from './rules';
import { Zones, type ZoneDef } from './zones';
import { PlacementDiffs } from './diffs';
import { isRulesFile } from './rulesAsset';
import { lodCullSizeWithin, lodSizeAtDistance, lodSphereRadius } from '../render/lodDistance';
import { enableSceneOrigins, sceneOriginOf } from '../scene/sceneOrigins';

/** The fields of the `WorldGen` component. @experimental */
export interface WorldGenData {
    /** The rules the world is laid out by, as the game registered them, and the version of them the world was made with. */
    rules: string;
    version: number;
    /** The world (a planet, a level) as the game names it, and its seed. */
    world: string;
    seed: number;
    /** Whether the biomes paint the terrain. */
    paintGround: boolean;
    /** {@link WorldSurface}: a plane (a Terrain of x and z), or a planet (the entity is also a `Planet`, and the world is laid out over its six faces). */
    surface: number;
    /** The height of the sea above a planet's radius: a point lower than this is under water. */
    seaLevel: number;
}

/** What a world is laid out on. */
export const WorldSurface = { Plane: 0, Planet: 1 } as const;

/**
 * A generated world: the rules it is laid out by. Presence is the opt-in; what the rules place is published as its children.
 *
 * @experimental
 */
export const WorldGen: ComponentDef<WorldGenData> = defineComponent<WorldGenData>('WorldGen', {
    rules: '', version: 1, world: '', seed: 1, paintGround: true, surface: WorldSurface.Plane, seaLevel: 0,
}, {
    fields: {
        rules: { tooltip: 'The rules the world is laid out by: a .esworld file, or the id of rules the game registered with registerWorldRules.' },
        version: { min: 1, step: 1, tooltip: 'The version of the rules the world was made with. A version the rules no longer have fails the world rather than laying out another one.' },
        world: { tooltip: 'The world (a planet, a level) as the game names it.' },
        seed: { step: 1, tooltip: 'Another seed lays out another world by the same rules.' },
        paintGround: { tooltip: 'Whether the biomes paint the terrain.' },
        surface: { enum: [{ label: 'Plane', value: WorldSurface.Plane }, { label: 'Planet', value: WorldSurface.Planet }], tooltip: 'Plane: laid out over a Terrain. Planet: this entity is also a Planet, and the world is laid out over its six faces.' },
        seaLevel: { shownWhen: { field: 'surface', values: [WorldSurface.Planet] }, tooltip: 'The height of the sea above the planet\'s radius: ground lower than this is under water.' },
    },
});

/** How a `WorldZone` is shaped. */
export const ZoneShapeKind = { Circle: 0, Box: 1 } as const;

/** The fields of the `WorldZone` component. @experimental */
export interface WorldZoneData {
    /** What the zone is for (home, road, landing, building, resource, view): the game's own words. */
    kind: string;
    shape: number;
    radius: number;
    sizeX: number;
    sizeZ: number;
    /** Over how many world units past its outline it fades out. */
    falloff: number;
    priority: number;
    /** The tags of what it keeps out, separated by commas; `*` keeps out everything. */
    excludes: string;
    /** A biome it holds over its area; empty holds none. */
    biome: string;
    /** Whether it levels the terrain under it to the ground's height at its centre. */
    flatten: boolean;
}

/**
 * An area of a generated world planned by hand: kept clear, held to a biome, or both. It follows its entity's position and its turn
 * about the vertical.
 *
 * @experimental
 */
export const WorldZone: ComponentDef<WorldZoneData> = defineComponent<WorldZoneData>('WorldZone', {
    kind: 'reserve', shape: ZoneShapeKind.Circle, radius: 10, sizeX: 20, sizeZ: 20, falloff: 4, priority: 0, excludes: '*', biome: '', flatten: false,
}, {
    fields: {
        kind: { tooltip: 'What the zone is for (home, road, landing, building, resource, view): the game\'s own words.' },
        shape: { enum: [{ label: 'Circle', value: ZoneShapeKind.Circle }, { label: 'Box', value: ZoneShapeKind.Box }] },
        radius: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Circle] }, tooltip: 'The circle\'s radius, in world units.' },
        sizeX: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Box] }, tooltip: 'The box\'s size along its own x.' },
        sizeZ: { min: 0, shownWhen: { field: 'shape', values: [ZoneShapeKind.Box] }, tooltip: 'The box\'s size along its own z.' },
        falloff: { min: 0, tooltip: 'Over how many world units past the outline the zone fades out: what it keeps out thins there.' },
        priority: { step: 1, tooltip: 'Where zones overlap, the higher priority holds the biome.' },
        excludes: { tooltip: 'The tags of what the zone keeps out, separated by commas (a layer, a recipe, its tags, decor, interactive); * keeps out everything; empty keeps nothing out.' },
        biome: { tooltip: 'A biome the zone holds over its area; empty holds none.' },
        flatten: { tooltip: 'Level the terrain under the zone to the ground\'s height at its centre, blending back over its falloff: a plot to build on.' },
    },
});

/** The fields of the `PlacedObject` component. @experimental */
export interface PlacedObjectData {
    /** The placement's id: what a save records when the game changes it. */
    id: string;
    /** What the game interacts with it as. */
    kind: string;
}

/**
 * Marks an entity a generated world placed for the game to interact with. Written by the engine; a scene does not author it.
 *
 * @experimental
 */
export const PlacedObject: ComponentDef<PlacedObjectData> = defineComponent<PlacedObjectData>('PlacedObject', { id: '', kind: '' });

/** Where a WorldGen stands: being made, ready, or failed (with why); and each of its layers' chunks. */
export interface WorldGenStatus {
    state: 'loading' | 'ready' | 'failed';
    reason?: string;
    layers: Record<string, ChunkLayerStatus>;
}

interface BuiltWorld {
    assets: AssetLease<AssetScope>;
    retired: boolean;
    meshData: Map<number, MeshData | null | Promise<MeshData | null>>;
    signature: string;
    data: WorldGenData;
    rules: WorldRules | null;
    plan: WorldPlan | null;
    /** The same plan with the sparser spacing the layers that have a `farSpacing` are planned at for their far versions; null when none has one. */
    farPlan: WorldPlan | null;
    failure: string | null;
    /** The terrain's and the water's revisions the plan was read from. */
    ground: string;
    /** Subscriptions and terrain effects owned by this generation, not by its retained chunks. */
    listeners: (() => void)[];
    levelled: Set<string>;
    paint: Terrains['paint_'];
    /** Zones that level their ground and wait for it to be known. */
    levelling: Set<string>;
    /** The rules' plants as kinds, and their parts once the assets are in hand (null while they are being loaded, or when the rules have no plants). */
    plants: PlantSet | null;
    plantsReady: ReadyKinds | null;
    /** A planet's six faces, each laid out as a plane (null for a world on a plane). */
    faces: FaceUnit[] | null;
    /** A world on a planet whose plan waits for the planet to say what it is (its ground and layers), which it does a frame after it is made. */
    waitingForPlanet: boolean;
}

/** One face of a planet's world: its plane, its plan (and the sparser one for far versions) and the zones over it. */
interface FaceUnit { face: PlanetFace; plan: WorldPlan; farPlan: WorldPlan | null; zones: FaceZones }

/** One piece of a world laid out and published in chunks: the whole of a plane, or a face of a planet. */
interface Unit {
    /** Names its layers' chunks: empty for a plane, `f0` to `f5` for a face. */
    key: string;
    /** What lays this unit out off the main thread, when something can: asked for the square of a layer, it answers with what is placed there. */
    away?: (layer: string, far: boolean, x0: number, z0: number, x1: number, z1: number) => Promise<Placement[]> | null;
    plan: WorldPlan;
    farPlan: WorldPlan | null;
    face: PlanetFace | null;
    /** The area in the unit's plane its chunks are counted over, or null for no end. */
    bounds: [number, number, number, number] | null;
    /** Whether the ground at a point of the plane is known (a chunk waits for the corners of its square). */
    known(x: number, z: number): boolean;
}

/** A chunk of a layer: what it places (its decoration merged by mesh, its interactive placements), and what it put in the world. */
interface PlacedChunk {
    assets?: AssetLease<AssetScope>;
    /** A kind of decoration: its near mesh and, when it has one, its far cards; drawn near out to `lodDistance`, out to `drawDistance`. */
    decor: { mesh: number; material: number; data: MeshData; far: MeshData | null; origin: [number, number, number]; lodDistance: number; drawDistance: number }[];
    objects: Placement[];
    /** The plants of the rules' `plants` in it, by kind, standing relative to `at` (the chunk's centre), and what grew them once published. */
    planted: Map<number, Plant[]> | null;
    at: [number, number, number];
    /** The chunk's side. */
    side: number;
    grown: GrownCell | null;
    /** Made for the far layer: only the far versions of its plants, which are shown from past what their kinds draw as themselves. */
    far: boolean;
    /** How many times thinner than the layer's own spacing the plants were planned (its `farSpacing` squared): the far version does not thin them again. */
    thinnedBy: number;
    entities: Entity[];
    meshes: number[];
}

/** The water, as worldgen asks it (the water module is optional: read by name, not imported). */
interface WaterQuery { depthAt(x: number, z: number, y: number): number | null; shoreAt?(x: number, z: number): number | null; queryData?(): WaterQueryData | null; revision_: number; baking: boolean }

function waterOf(app: App): WaterQuery | null {
    const w = (app as unknown as { getResourceByName?: (name: string) => unknown }).getResourceByName?.('Waters') as Partial<WaterQuery> | undefined;
    return w && typeof w.depthAt === 'function' ? w as WaterQuery : null;
}

const layerIdOf = (entity: Entity, layer: string, key = ''): string => `worldgen:${entity}:${key ? `${key}:` : ''}${layer}`;
function zoneIdOf(app: App, entity: Entity): string {
    const origin = sceneOriginOf(app, entity);
    const scene = app.world.tryGet(entity, SceneOwner)?.scene;
    return origin !== undefined && scene !== undefined
        ? `zone:scene:${JSON.stringify([scene, origin])}`
        : `zone:${entity}`;
}
const FACE_KEYS = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'] as const;

/** Lets go of a layer's chunks, near and far, on a plane and on every face of a planet. */
function dropLayer(app: App, entity: Entity, layer: string): void {
    const chunks = chunksOf(app);
    for (const key of ['', ...FACE_KEYS]) { chunks.remove(layerIdOf(entity, layer, key)); chunks.remove(layerIdOf(entity, `${layer}:far`, key)); }
}

/** Run-time access to the generated worlds. */
export class WorldGens {
    /** @internal */ readonly built_ = new Map<Entity, BuiltWorld>();
    /** @internal */ app_: App | null = null;
    private readonly zones_ = new Map<string, Zones>();
    private readonly diffs_ = new Map<string, PlacementDiffs>();
    /** @internal Authored projections belong to a named world, shared by all of its generators. */
    readonly authored_ = new Map<string, Set<string>>();
    /** @internal A flatten modifier remains until its last live plan lets it go. */
    readonly levelled_ = new Map<string, { signature: string; owners: Set<BuiltWorld> }>();
    /** @internal The interactive entity of each placement id published now. */
    readonly objects_ = new Map<string, Entity>();

    /** The zones of a world (by its name), which a game adds to as it plans and builds. Shared by every WorldGen of that world. */
    zones(world = this.first_()?.data.world ?? ''): Zones {
        let z = this.zones_.get(world);
        if (!z) { z = new Zones(); this.zones_.set(world, z); }
        return z;
    }

    /** The changes made to a world (by its name), which a save stores and reads back. */
    diffs(world = this.first_()?.data.world ?? ''): PlacementDiffs {
        let d = this.diffs_.get(world);
        if (!d) { d = new PlacementDiffs(); this.diffs_.set(world, d); }
        return d;
    }

    /** A WorldGen's plan, or the first one's: what stands where, asked of anywhere, loaded or not. Null until it is made or if it failed. */
    plan(entity?: Entity): WorldPlan | null {
        return (entity !== undefined ? this.built_.get(entity) : this.first_())?.plan ?? null;
    }

    /** The interactive entity standing for placement `id`, or null where its chunk is not published or the placement is removed. */
    objectOf(id: string): Entity | null {
        return this.objects_.get(id) ?? null;
    }

    status(entity: Entity): WorldGenStatus | null {
        const built = this.built_.get(entity);
        if (!built) return null;
        const layers: Record<string, ChunkLayerStatus> = {};
        const chunks = this.app_?.hasResource(ProceduralChunksRes) ? this.app_.getResource(ProceduralChunksRes) : null;
        for (const l of built.rules?.layers ?? []) {
            // A planet's layer is one of chunks on each of its six faces: counted together.
            for (const key of built.faces ? FACE_KEYS : ['']) {
                const s = chunks?.status(layerIdOf(entity, l.id, key));
                if (!s) continue;
                const had = layers[l.id];
                layers[l.id] = had
                    ? { ready: had.ready + s.ready, stale: had.stale + s.stale, pending: had.pending + s.pending, making: had.making + s.making, failed: had.failed + s.failed, reason: had.reason ?? s.reason }
                    : s;
            }
        }
        if (built.failure) return { state: 'failed', reason: built.failure, layers };
        return { state: built.plan ? 'ready' : 'loading', layers };
    }

    private first_(): BuiltWorld | undefined {
        return this.built_.values().next().value;
    }
}

/** The resource the plugin installs. @experimental */
export const WorldGenRes = defineResource<WorldGens>(new WorldGens(), 'WorldGens');

/**
 * Runs an asset load again when it fails, a few times and a little later each time. Reading a project's files is slowest while the project is still being
 * opened (the asset database is scanned and cooked against it), and a load that waited out its timeout then is not a world that cannot be shown.
 */
async function retried<T>(load: () => Promise<T>, attempts = 5): Promise<T> {
    for (let n = 1; ; n++) {
        try { return await load(); } catch (error) {
            if (n >= attempts) throw error;
            log.warn('worldgen', `loading the world's assets failed (${error instanceof Error ? error.message : String(error)}); trying again`);
            await new Promise<void>((resolve) => setTimeout(resolve, 2000 * n));
        }
    }
}

export class WorldGenPlugin implements Plugin {
    name = 'worldgen';

    /** Stops listening for edited rules files. */
    private watching_: (() => void) | null = null;

    build(app: App): void {
        enableSceneOrigins(app);
        const gens = new WorldGens();
        gens.app_ = app;
        app.insertResource(WorldGenRes, gens);
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            this.sweep(app, gens);
            for (const entity of app.world.getEntitiesWithComponents([WorldGen, Transform])) {
                const data = app.world.get(entity, WorldGen) as WorldGenData;
                const signature = `${JSON.stringify(data)}#${worldRulesRevision()}`;
                let built = gens.built_.get(entity);
                if (!built || built.signature !== signature) {
                    built = this.make(app, gens, entity, data, built);
                    gens.built_.set(entity, built);
                }
                if (built.waitingForPlanet && built.rules && app.hasResource(PlanetRegistryRes) && app.getResource(PlanetRegistryRes).planets.has(entity)) {
                    built.waitingForPlanet = false;
                    this.plan(app, gens, entity, built, built.rules);
                }
            }
            this.syncZones(app, gens);
            for (const [entity, built] of gens.built_) this.publish(app, gens, entity, built);
        }, { name: 'WorldGenSystem' }));
    }

    cleanup(app?: App): void {
        this.watching_?.();
        this.watching_ = null;
        if (!app?.hasResource(WorldGenRes)) return;
        const gens = app.getResource(WorldGenRes);
        for (const entity of [...gens.built_.keys()]) this.drop(app, gens, entity);
        this.syncZones(app, gens);
    }

    /** A WorldGen's rules and plan, or why it has none. */
    private make(app: App, gens: WorldGens, entity: Entity, data: WorldGenData, had: BuiltWorld | undefined): BuiltWorld {
        if (had) this.retire(app, gens, had);
        const meshData: BuiltWorld['meshData'] = new Map();
        const assets = ownedAssetLease(`worldgen:${entity}`, (had?.assets.generation ?? 0) + 1, new AssetScope(), scope => {
            try { scope.releaseAll(); } finally { meshData.clear(); }
        });
        const built: BuiltWorld = { assets, retired: false, meshData, signature: `${JSON.stringify(data)}#${worldRulesRevision()}`, data: { ...data }, rules: null, plan: null, farPlan: null, failure: null, ground: '', listeners: [], levelled: new Set(), paint: null, levelling: new Set(), plants: null, plantsReady: null, faces: null, waitingForPlanet: false };
        // Rules in a project file are read first, then made like rules registered by code.
        if (isRulesFile(data.rules)) {
            if (!app.hasResource(Assets)) {
                built.failure = `the world rules file ${data.rules} cannot be read without an asset system: register its rules in code instead`;
                log.error('worldgen', built.failure);
                return built;
            }
            const assets = app.getResource(Assets);
            // A rules file edited and saved is read again, and the world laid out by it again (its old chunks kept until then).
            if (!this.watching_) {
                this.watching_ = assets.onInvalidate(({ ref }) => {
                    const changed = assets.resolveLoadPath(ref);
                    for (const b of gens.built_.values()) if (isRulesFile(b.data.rules) && assets.resolveLoadPath(b.data.rules) === changed) b.signature = '';
                });
            }
            void assets.acquireTyped<WorldRules>('world-rules', data.rules).then((receipt) => {
                if (built.retired || gens.built_.get(entity) !== built) { receipt.release(); return; }
                built.assets.value.add(receipt);
                this.adopt(app, gens, entity, built, receipt.value, had);
            }, (e: unknown) => {
                if (gens.built_.get(entity) !== built) return;
                built.failure = `the world rules file ${data.rules} could not be read: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
            return built;
        }
        const rules = worldRules(data.rules);
        if (!rules) {
            built.failure = `no world rules ${data.rules || '(none named)'} are registered`;
            log.error('worldgen', `the world ${data.world} cannot be laid out: ${built.failure}`);
            for (const l of had?.rules?.layers ?? []) dropLayer(app, entity, l.id);
            return built;
        }
        this.adopt(app, gens, entity, built, rules, had);
        return built;
    }

    /** Takes a WorldGen's rules, once they are known: checks the version, and makes the plan (loading what the recipes name first). */
    private adopt(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, rules: WorldRules, had: BuiltWorld | undefined): void {
        const data = built.data;
        if (!rules.versions.includes(data.version)) built.failure = `the world rules ${rules.id} have no version ${data.version} (they have ${rules.versions.join(', ')})`;
        else built.rules = rules;
        if (built.failure) {
            log.error('worldgen', `the world ${data.world} cannot be laid out: ${built.failure}`);
            // A world that cannot be laid out shows nothing of the one before it.
            for (const l of had?.rules?.layers ?? []) dropLayer(app, entity, l.id);
            return;
        }
        // Layers the new rules no longer have are let go; the ones they keep keep their chunks until they are made again.
        for (const l of had?.rules?.layers ?? []) if (!rules.layers.some((n) => n.id === l.id)) dropLayer(app, entity, l.id);
        // The plants the recipes name: as kinds, and their parts read once there is a renderer to grow them with. A chunk waits for them.
        if (rules.plants && Object.keys(rules.plants).length > 0 && app.hasResource(Assets)) {
            const set = expandPlants(rules.plants);
            built.plants = set;
            void retried(() => prepareKinds(app.getResource(Assets), set.kinds)).then((ready) => {
                if (built.retired || gens.built_.get(entity) !== built) { ready.lease.release(); return; }
                built.assets.value.add(ready.lease);
                built.plantsReady = ready;
            }, (e: unknown) => {
                if (built.retired) return;
                built.failure = `the plants' assets could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
        }
        // Recipes name their meshes and materials by path: with a renderer they are loaded first, and the plan is made with them.
        const refs = assetRefsOf(rules);
        if (refs.length > 0 && app.hasResource(Assets)) {
            void retried(() => this.resolve(app, rules, refs)).then((resolved) => {
                if (built.retired || gens.built_.get(entity) !== built) { resolved.scope.releaseAll(); return; }
                built.assets.value.absorb(resolved.scope);
                built.rules = resolved.rules;
                this.plan(app, gens, entity, built, resolved.rules);
            }, (e: unknown) => {
                if (built.retired) return;
                built.failure = `the recipes' assets could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
                log.error('worldgen', built.failure);
            });
            return;
        }
        this.plan(app, gens, entity, built, rules);
    }

    /** Loads the meshes and materials `refs` name, and gives back the rules with each path replaced by its handle. */
    private async resolve(app: App, rules: WorldRules, refs: { kind: 'mesh' | 'material'; ref: string }[]): Promise<{ rules: WorldRules; scope: AssetScope }> {
        const assets = app.getResource(Assets);
        const scope = new AssetScope();
        const handles = new Map<string, number>();
        const results = await Promise.allSettled(refs.map(async ({ kind, ref }) => {
            const receipt = scope.add(await assets.acquireTyped<{ handle: number }>(kind, ref));
            handles.set(`${kind}:${ref}`, receipt.value.handle);
        }));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) { scope.releaseAll(); throw failed.reason; }
        const member = (m: RecipeMember): RecipeMember => ({
            ...m,
            mesh: typeof m.mesh === 'string' ? handles.get(`mesh:${m.mesh}`) ?? 0 : m.mesh,
            material: typeof m.material === 'string' ? handles.get(`material:${m.material}`) ?? 0 : m.material,
        });
        return { scope, rules: { ...rules, recipes: rules.recipes.map((r) => ({ ...r, anchor: member(r.anchor), members: r.members?.map(member) })) } };
    }

    /** Makes a WorldGen's plan from its rules, and what keeps it current. */
    private plan(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, rules: WorldRules): void {
        const data = built.data;
        if (data.surface === WorldSurface.Planet) { this.planPlanet(app, gens, entity, built, rules); return; }
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const zones = gens.zones(data.world);
        const t0 = app.world.tryGet(entity, Transform) as TransformData | null;
        const flatY = t0?.worldPosition.y ?? 0;
        const made = makePlanePlan({
            rules, farRules: farRulesOf(rules), seed: data.seed, world: data.world, zones,
            // A terrain can finish loading after the plan was created. Read its current
            // availability rather than capturing a flat fallback for the plan's lifetime.
            ground: terrains ? {
                heightAt: (x, z) => terrains.built_.size > 0 || terrains.loading ? terrains.heightAt(x, z) : flatY,
                normalAt: (x, z) => terrains.normalAt(x, z),
                paintAt: (x, z) => terrains.paintAt(x, z),
            } : null,
            flatY,
            water: { depthAt: (x, z, y) => waterOf(app)?.depthAt(x, z, y) ?? null, shoreAt: (x, z) => waterOf(app)?.shoreAt?.(x, z) ?? null },
            layers: terrains ? terrains.layerNames() : [],
        });
        built.plan = made.plan;
        const plan = built.plan;
        built.farPlan = made.farPlan;
        // A zone that changes, or a placement a player changes, makes again only the chunks it reaches.
        built.listeners.push(zones.subscribe((bounds, zone) => {
            plan.invalidate();
            built.farPlan?.invalidate();
            const chunks = chunksOf(app);
            for (const l of rules.layers) {
                // A group kept out lets a neighbour it had beaten stand, which may beat its own: a few cells round are made again.
                const reach = l.spacing * 3;
                chunks.invalidate(layerIdOf(entity, l.id), bounds[0] - reach, bounds[1] - reach, bounds[2] + reach, bounds[3] + reach);
            }
            // A zone that holds a biome or sets a field changes the ground's paint under it.
            if (terrains && data.paintGround && (zone.biome || zone.fields)) terrains.repaint();
            // One that levels its ground lays a modifier on the terrain, and takes it off when it goes or stops levelling.
            if (terrains) {
                const now = zones.get(zone.id);
                if (now?.flatten !== undefined) this.level(terrains, gens, built, now);
                else this.unlevel(terrains, gens, built, zone.id);
            }
        }));
        built.listeners.push(gens.diffs(data.world).subscribe((id) => {
            const at = this.anchorOf(plan, id);
            if (at) chunksOf(app).invalidate(layerIdOf(entity, at.layer), at.x, at.z, at.x, at.z);
        }));
        if (terrains && data.paintGround) {
            built.paint = this.painter(plan);
            terrains.setPaint(built.paint);
        }
        // Zones that were there before the plan was made level their ground now.
        if (terrains) for (const zone of zones.all()) if (zone.flatten !== undefined) this.level(terrains, gens, built, zone);
    }

    /**
     * Makes a planet's plans: one for each face of the cube, each on the face's plane. The plan of a face is the same plan as a plane's, read from the
     * planet's ground by direction and from noise in three dimensions, so a field wanders over an edge between two faces without a seam; a direction is
     * planned by the face it falls on, and the faces' plans paint the planet's ground by the same biomes that place what stands on it.
     */
    private planPlanet(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, rules: WorldRules): void {
        const data = built.data;
        if (!app.hasResource(PlanetRegistryRes)) { built.failure = 'a world on a planet needs the Planet plugin'; log.error('worldgen', built.failure); return; }
        const registry = app.getResource(PlanetRegistryRes);
        const facts = (): PlanetFacts | null => registry.planets.get(entity) ?? null;
        if (!facts()) { built.waitingForPlanet = true; return; }
        const farRules = farRulesOf(rules);
        built.faces = planetFaces(facts).map((face) => {
            const zones = new FaceZones(face);
            const { plan, farPlan } = makeFacePlan(face, {
                rules, farRules, seed: data.seed, world: data.world, seaLevel: data.seaLevel,
                layers: facts()?.layers ?? [], fieldNames: facts()?.fieldNames ?? [], zones: zones.zones,
            });
            // A zone that changes makes again only the chunks of this face it reaches, and paints the ground under it again.
            zones.zones.onChange = (bounds, zone) => {
                plan.invalidate();
                farPlan?.invalidate();
                const chunks = chunksOf(app);
                for (const l of rules.layers) {
                    const reach = l.spacing * 3;
                    chunks.invalidate(layerIdOf(entity, l.id, FACE_KEYS[face.face]), bounds[0] - reach, bounds[1] - reach, bounds[2] + reach, bounds[3] + reach);
                }
                if (data.paintGround && (zone.biome || zone.fields)) registry.setPaint(entity, registry.paintOf(entity), registry.remotePaintOf(entity));
            };
            return { face, plan, farPlan, zones };
        });
        built.plan = built.faces[2]!.plan;
        const faces = built.faces;
        const plugin = this;
        // The ground is painted where the direction falls: by the plan of the face it is on. A worker paints it the same way from the same plans.
        if (data.paintGround) {
            const remote = facts()?.worker ? { get keys() { return faces.map((u) => plugin.planKey(built, u)); }, spec: (face: number) => plugin.planSpec(built, faces[face]!, facts()!) } : null;
            registry.setPaint(entity, (dx, dy, dz, base) => {
                const unit = faces[faceOf(dx, dy, dz).face]!;
                const at = unit.face.planeOf(dx, dy, dz);
                return at ? unit.plan.paint(at.x, at.z, base) : base;
            }, remote);
        }
    }

    /** Levels a zone's ground, or (the ground under its centre not known yet) keeps it to level once it is. */
    private level(terrains: Terrains, gens: WorldGens, built: BuiltWorld, zone: ZoneDef): void {
        const height = zone.flatten === 'ground' ? terrains.heightBeneathAt(zone.shape.x, zone.shape.z) : zone.flatten;
        if (height === null || height === undefined) { built.levelling.add(zone.id); return; }
        const signature = JSON.stringify([zone.shape, zone.falloff, height]);
        let held = gens.levelled_.get(zone.id);
        if (!held) { held = { signature: '', owners: new Set() }; gens.levelled_.set(zone.id, held); }
        held.owners.add(built);
        built.levelled.add(zone.id);
        if (held.signature !== signature) {
            terrains.setModifier(flattenModifier(`zone:${zone.id}`, zone.shape, height, zone.falloff));
            held.signature = signature;
        }
        built.levelling.delete(zone.id);
    }

    private unlevel(terrains: Terrains | null, gens: WorldGens, built: BuiltWorld, id: string): void {
        built.levelling.delete(id);
        built.levelled.delete(id);
        const held = gens.levelled_.get(id);
        if (!held) return;
        held.owners.delete(built);
        if (held.owners.size === 0) {
            terrains?.deleteModifier(`zone:${id}`);
            gens.levelled_.delete(id);
        }
    }

    /** The ground's paint by a plan's biomes. */
    private painter(plan: WorldPlan) {
        return (x: number, z: number, _h: number, _ny: number, w: readonly number[]) => plan.paint(x, z, w);
    }

    /** Where the group of placement `id` is anchored, from the layer and grid cell its id names. */
    private anchorOf(plan: WorldPlan, id: string): { layer: string; x: number; z: number } | null {
        const m = /^(.+)@\d+:(-?\d+),(-?\d+)\//.exec(id);
        if (!m) return null;
        const li = plan.layerIndex(m[1]!);
        if (li < 0) return null;
        const g = plan.group(li, Number(m[2]), Number(m[3]));
        return typeof g === 'string' ? null : { layer: m[1]!, x: g.x, z: g.z };
    }

    /** Puts the authored `WorldZone`s into their world's zones. */
    private syncZones(app: App, gens: WorldGens): void {
        const worlds = new Map([...gens.built_.values()].map(built => [built.data.world, built]));
        for (const [name, authored] of gens.authored_) {
            if (worlds.has(name)) continue;
            for (const id of authored) gens.zones(name).delete(id);
            gens.authored_.delete(name);
        }
        const entities = app.world.getEntitiesWithComponents([WorldZone, Transform]);
        for (const [name, built] of worlds) this.syncWorldZones(app, gens, name, built, entities);
    }

    private syncWorldZones(app: App, gens: WorldGens, name: string, built: BuiltWorld, entities: readonly Entity[]): void {
        const zones = gens.zones(name);
        const seen = new Set<string>();
        for (const e of entities) {
            const z = app.world.get(e, WorldZone) as WorldZoneData;
            const t = app.world.get(e, Transform) as TransformData;
            const p = t.worldPosition, q = t.worldRotation;
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            // On a planet a zone stands at a place in the world (its height too), and a box carries where its own x axis points.
            const onPlanet = built.data.surface === WorldSurface.Planet;
            const facing: [number, number, number] = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y)];
            const def: ZoneDef = {
                id: zoneIdOf(app, e), kind: z.kind, falloff: z.falloff, priority: z.priority,
                shape: z.shape === ZoneShapeKind.Box
                    ? { type: 'rect', x: p.x, z: p.z, halfX: z.sizeX / 2, halfZ: z.sizeZ / 2, yaw: -yaw, ...(onPlanet ? { y: p.y, facing } : {}) }
                    : { type: 'circle', x: p.x, z: p.z, radius: z.radius, ...(onPlanet ? { y: p.y } : {}) },
                excludes: z.excludes.split(',').map((s) => s.trim()).filter(Boolean),
                ...(z.biome ? { biome: z.biome } : {}),
                ...(z.flatten ? { flatten: 'ground' as const } : {}),
            };
            zones.set(def);
            seen.add(def.id);
        }
        for (const id of gens.authored_.get(name) ?? []) if (!seen.has(id)) zones.delete(id);
        gens.authored_.set(name, seen);
    }

    /** Hands each of the rules' layers to the chunks, made from the plan: of the one plane, or of each face of a planet. */
    private publish(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld): void {
        const plan = built.plan, rules = built.rules;
        if (!plan || !rules) return;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const water = waterOf(app);
        if (built.faces) {
            const registry = app.getResource(PlanetRegistryRes);
            const facts = registry.planets.get(entity);
            if (!facts) return;
            // The world's zones, over each face: those whose centre falls on it, in its plane.
            const world = [...gens.zones(built.data.world).all()];
            for (const unit of built.faces) unit.zones.sync(world);
            const half = faceHalf(facts.radius);
            const pool = planPool();
            for (const unit of built.faces) {
                this.publishUnit(app, gens, entity, built, {
                    key: FACE_KEYS[unit.face.face]!, plan: unit.plan, farPlan: unit.farPlan, face: unit.face,
                    bounds: [-half, -half, half, half], known: (x, z) => unit.face.ground(x, z) !== null,
                    away: pool && facts.worker ? this.awayOf(pool, built, unit, facts) : undefined,
                }, `planet:${facts.radius}`, false);
            }
            return;
        }
        // What the plan read the ground and the water from: when either changes everything is read again.
        const ground = `${terrains?.revision_ ?? 0}:${water?.revision_ ?? 0}`;
        if (ground !== built.ground) { plan.invalidate(); built.farPlan?.invalidate(); built.ground = ground; }
        const waiting = !!terrains?.loading || !!water?.baking;
        if (terrains) {
            for (const id of [...built.levelling]) {
                const zone = gens.zones(built.data.world).get(id);
                if (zone?.flatten !== undefined) this.level(terrains, gens, built, zone); else this.unlevel(terrains, gens, built, id);
            }
        }
        // A world on a terrain of an area ends where the terrain does: its chunks are counted over that, and not over a radius of empty world.
        this.publishUnit(app, gens, entity, built, {
            key: '', plan, farPlan: built.farPlan, face: null, bounds: terrains?.areaBounds() ?? null,
            known: (x, z) => !terrains || terrains.groundKnownAt(x, z),
            away: this.awayOnPlane(app, gens, entity, built, terrains, water, waiting),
        }, ground, waiting);
    }

    /**
     * What lays a plane's world out on workers, when the ground and the water can be handed to them as data (a terrain of a field or of noise, with nothing laid over it;
     * water that is baked): the chunks are spread over the workers, and a worker is sent the plan the first time it is asked a square of it. Null when they cannot, and
     * the world is laid out here.
     */
    private awayOnPlane(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, terrains: Terrains | null, water: WaterQuery | null, waiting: boolean): Unit['away'] | undefined {
        const pool = planPool();
        if (!pool || waiting || built.data.surface !== WorldSurface.Plane) return undefined;
        const ground = terrains && terrains.built_.size > 0 ? terrains.groundData() : null;
        if (terrains && terrains.built_.size > 0 && !ground) return undefined;
        const waterData = water ? water.queryData?.() ?? null : null;
        if (water && !waterData && water.queryData) return undefined;
        const zones = gens.zones(built.data.world);
        const key = `${built.signature}:plane:t${terrains?.revision_ ?? 0}:w${water?.revision_ ?? 0}:z${zones.revision}`;
        const flatY = (app.world.tryGet(entity, Transform) as TransformData | null)?.worldPosition.y ?? 0;
        const spec = (): PlaneSpec => ({
            plane: true, rules: { ...built.rules!, fields: undefined, plants: undefined } as WorldRules, seed: built.data.seed, world: built.data.world,
            ground, flatY, water: waterData, layers: terrains ? terrains.layerNames() : [], zones: [...zones.all()],
        });
        return (layer, far, x0, z0, x1, z1) => {
            // Squares are spread over the workers by where they are, so neighbours share a worker and what it has worked out.
            const worker = Math.abs((Math.floor(x0 / 256) * 73856093) ^ (Math.floor(z0 / 256) * 19349663)) % pool.size;
            const first = firstSend(worker, key);
            const request: PlacementsRequest = { id: 0, key, layer, far, x0, z0, x1, z1, ...(first ? { spec: spec() } : {}) };
            return pool.run<Placement[]>(worker, request as unknown as Record<string, unknown>).catch((e: unknown) => {
                forgetSent(worker, key);
                throw e;
            });
        };
    }

    /** The name of a face's plan for workers: what it was made from, so a plan made from other rules, zones or sea is a new one. */
    private planKey(built: BuiltWorld, unit: FaceUnit): string {
        return `${built.signature}:f${unit.face.face}:z${unit.zones.zones.revision}`;
    }

    /** What a worker makes a face's plan from: plain data, the rules without what is code (the fields a game registered) or what only the main thread reads (the plants' kinds). */
    private planSpec(built: BuiltWorld, unit: FaceUnit, facts: PlanetFacts): PlanSpec {
        const data = built.data;
        return {
            rules: { ...built.rules!, fields: undefined, plants: undefined } as WorldRules, seed: data.seed, world: data.world, seaLevel: data.seaLevel,
            face: unit.face.face, radius: facts.radius, centre: facts.centre, layers: [...facts.layers], fieldNames: [...facts.fieldNames],
            zones: [...unit.zones.zones.all()], provider: facts.worker!,
        };
    }

    /** Asks the pool for a square of a face's plan: the plan is sent with the first question a worker is asked of it, and named after that. */
    private awayOf(pool: JobPool, built: BuiltWorld, unit: FaceUnit, facts: PlanetFacts): NonNullable<Unit['away']> {
        const worker = unit.face.face % pool.size;
        return (layer, far, x0, z0, x1, z1) => {
            const key = this.planKey(built, unit);
            const first = firstSend(worker, key);
            const request: PlacementsRequest = { id: 0, key, layer, far, x0, z0, x1, z1, ...(first ? { spec: this.planSpec(built, unit, facts) } : {}) };
            return pool.run<Placement[]>(unit.face.face, request as unknown as Record<string, unknown>).catch((e: unknown) => {
                // A worker that does not know the plan (it was restarted) is sent it again with the next question.
                forgetSent(worker, key);
                throw e;
            });
        };
    }

    /** One unit's layers as chunks: nearest first within the frame's budget, with the far versions of its plants a layer of their own. */
    private publishUnit(app: App, gens: WorldGens, entity: Entity, built: BuiltWorld, unit: Unit, ground: string, waiting: boolean): void {
        const rules = built.rules!;
        const diffs = gens.diffs(built.data.world);
        const rendering = app.hasResource(Assets);
        const chunks = chunksOf(app);
        const { plan, bounds, face } = unit;
        const known = (x0: number, z0: number, side: number): boolean => [[x0, z0], [x0 + side, z0], [x0, z0 + side], [x0 + side, z0 + side]].every(([x, z]) => unit.known(x!, z!));
        // Where the layer is wanted round: the world's streaming sources, put in the face's plane on a planet.
        const sourcesFor = face ? (reach: number) => (): Iterable<ChunkSource> => face.sourcesOnFace(streamingSourcesOf(app), reach) : null;
        for (const layer of rules.layers) {
            const size = layer.chunkSize ?? 64;
            const extent: [number, number, number, number] | null = bounds
                ? [Math.floor(bounds[0] / size), Math.floor(bounds[1] / size), Math.ceil(bounds[2] / size), Math.ceil(bounds[3] / size)] : null;
            chunks.set<PlacedChunk>(layerIdOf(entity, layer.id, unit.key), {
                label: 'Laying out the world',
                async: !!unit.away,
                originX: 0, originZ: 0, sizeX: size, sizeZ: size, extent,
                loadRadius: layer.drawDistance, unloadRadius: layer.drawDistance + size,
                generation: `${built.signature}:${ground}`,
                ...(sourcesFor ? { sources: sourcesFor(layer.drawDistance + size) } : {}),
                make: (cx, cz) => {
                    const x0 = cx * size, z0 = cz * size;
                    // The plants' parts are read before any chunk: a chunk made without them would leave the plants out until it is made again.
                    if (rendering && built.plants && !built.plantsReady) return null;
                    const away = unit.away?.(layer.id, false, x0, z0, x0 + size, z0 + size);
                    if (away) return this.ownChunk(built, () => away.then((placed) => this.chunk(app, built.meshData, null, diffs, layer, x0, z0, size, rendering, built.plants, face, false, 1, placed)));
                    if (waiting || !known(x0, z0, size)) return null;
                    return this.ownChunk(built, () => this.chunk(app, built.meshData, plan, diffs, layer, x0, z0, size, rendering, built.plants, face));
                },
                publish: (_cx, _cz, value) => this.place(app, gens, entity, value),
                release: (_cx, _cz, value) => this.unplace(app, gens, value),
            });
            // The plants' far versions are a layer of their own, wanted as far as the furthest of them goes: they are cheap, so the whole world stands at once,
            // where the plants themselves are only grown near the eye. They are shown from past what their kinds draw as themselves.
            const farId = layerIdOf(entity, `${layer.id}:far`, unit.key);
            if (!rendering || !built.plants || built.plants.reach <= layer.drawDistance) { chunks.remove(farId); continue; }
            // A far cell is as many chunks wide as the shortest span a far version is shown over allows: the far versions are one draw a kind a cell, and a ring
            // of ground cover a few chunks wide would otherwise be thousands of them.
            const farSide = Math.min(Math.max(Math.floor(built.plants.span / size), 1), 2);
            const fsize = size * farSide;
            const fextent: [number, number, number, number] | null = bounds
                ? [Math.floor(bounds[0] / fsize), Math.floor(bounds[1] / fsize), Math.ceil(bounds[2] / fsize), Math.ceil(bounds[3] / fsize)] : null;
            chunks.set<PlacedChunk>(farId, {
                label: 'Laying out the far plants',
                async: !!unit.away,
                originX: 0, originZ: 0, sizeX: fsize, sizeZ: fsize, extent: fextent,
                loadRadius: built.plants.reach, unloadRadius: built.plants.reach + fsize,
                generation: `${built.signature}:${ground}`,
                ...(sourcesFor ? { sources: sourcesFor(built.plants.reach + fsize) } : {}),
                make: (cx, cz) => {
                    const x0 = cx * fsize, z0 = cz * fsize;
                    if (!built.plantsReady) return null;
                    const sparse = (layer.farSpacing ?? 1) > 1 && unit.farPlan;
                    const away = unit.away?.(layer.id, true, x0, z0, x0 + fsize, z0 + fsize);
                    if (away) return this.ownChunk(built, () => away.then((placed) => this.chunk(app, built.meshData, null, diffs, layer, x0, z0, fsize, rendering, built.plants, face, true, sparse ? layer.farSpacing! ** 2 : 1, placed)));
                    if (waiting || !known(x0, z0, fsize)) return null;
                    return this.ownChunk(built, () => this.chunk(app, built.meshData, sparse ? unit.farPlan! : plan, diffs, layer, x0, z0, fsize, rendering, built.plants, face, true, sparse ? layer.farSpacing! ** 2 : 1));
                },
                publish: (_cx, _cz, value) => this.place(app, gens, entity, value),
                release: (_cx, _cz, value) => this.unplace(app, gens, value),
            });
        }
    }

    /** Pending and published chunks both borrow the generation they were built from. */
    private ownChunk(built: BuiltWorld, make: () => PlacedChunk | Promise<PlacedChunk>): PlacedChunk | Promise<PlacedChunk> | null {
        const assets = built.assets.retain();
        if (!assets) return null;
        const hold = (chunk: PlacedChunk): PlacedChunk => { chunk.assets = assets; return chunk; };
        try {
            const value = make();
            return value instanceof Promise ? value.then(hold, error => { assets.release(); throw error; }) : hold(value);
        } catch (error) { assets.release(); throw error; }
    }

    /** What one chunk of a layer places: its decoration merged by mesh, and its interactive placements, with the changes laid over. */
    private chunk(app: App, meshData: BuiltWorld['meshData'], plan: WorldPlan | null, diffs: PlacementDiffs, layer: PlacementLayer, x0: number, z0: number, size: number,
                  rendering: boolean, plants: PlantSet | null, face: PlanetFace | null, far = false, thinnedBy = 1, given?: readonly Placement[]): PlacedChunk | Promise<PlacedChunk> {
        const placements: Placement[] = [];
        // What is placed in the square: asked of the plan here, or already worked out (by a worker).
        for (const planned of given ?? plan!.placementsIn(x0, z0, x0 + size, z0 + size, [layer.id])) {
            // On a planet a placement is taken from its face's plane to the planet, and named for its face: the same cell of two faces is two places.
            const p = face ? onPlanet(planned, face) : planned;
            if (diffs.isRemoved(p.id)) continue;
            const c = diffs.changeOf(p.id);
            placements.push(c ? { ...p, ...c } : p);
        }
        // Where the chunk stands: the middle of its square, on the plane's zero height (a planet: that point of the ground's sphere).
        const centre: [number, number, number] = face ? face.world(x0 + size / 2, 0, z0 + size / 2) : [x0 + size / 2, 0, z0 + size / 2];
        const objects = far ? [] : placements.filter((p) => p.interactive !== null);
        const decor = rendering && !far ? placements.filter((p) => p.interactive === null && p.mesh) : [];
        const meshes = [...new Set(decor.map((p) => p.mesh))];
        const finish = (): PlacedChunk => {
            const out: PlacedChunk = { decor: [], objects, planted: null, at: centre, side: size, grown: null, far, thinnedBy, entities: [], meshes: [] };
            // The plants: each at its kind (its colouring there), relative to the chunk's centre, sunk by what its kind says.
            if (plants && rendering) {
                const by = new Map<number, Plant[]>();
                for (const p of placements) {
                    if (p.interactive !== null || p.plant === null) continue;
                    const k = plants.kindAt(p.plant, p.x, p.z);
                    if (k < 0) continue;
                    let list = by.get(k);
                    if (!list) by.set(k, list = []);
                    list.push({ ...(plants.kinds[k]?.interaction ? { key: p.id } : {}), x: p.x - out.at[0], y: p.y - out.at[1] - plants.sinkOf(p.plant), z: p.z - out.at[2], yaw: p.yaw, scale: p.scale * plants.unitOf(p.plant), phase: 0, shade: 1,
                        ...(leanOf(p) ? { up: leanOf(p)! } : {}) });
                }
                if (by.size > 0) out.planted = by;
            }
            const byKind = new Map<string, Placement[]>();
            for (const p of decor) {
                const k = `${p.mesh}:${p.material}`;
                let list = byKind.get(k);
                if (!list) byKind.set(k, list = []);
                list.push(p);
            }
            const origin = out.at;
            for (const list of byKind.values()) {
                const source = meshData.get(list[0]!.mesh);
                if (!source || source instanceof Promise) continue;
                const plants: Plant[] = list.map((p, i) => ({
                    x: p.x - origin[0], y: p.y - origin[1], z: p.z - origin[2], yaw: p.yaw, scale: p.scale, phase: (i * 0.618) % 1, shade: 1,
                    ...(leanOf(p) ? { up: leanOf(p)! } : {}),
                }));
                const far = list[0]!.far;
                const width = Math.max(source.aabbMax[0] - source.aabbMin[0], source.aabbMax[2] - source.aabbMin[2]);
                out.decor.push({
                    mesh: list[0]!.mesh, material: list[0]!.material, data: buildInstancedMesh(source, plants), origin,
                    far: far ? buildBillboardMesh(plants, width, source.aabbMax[1] - source.aabbMin[1], far, undefined, far.tent === true) : null,
                    lodDistance: layer.lodDistance ?? layer.drawDistance, drawDistance: layer.drawDistance,
                });
            }
            return out;
        };
        const missing = meshes.filter((m) => !meshData.has(m) || meshData.get(m) instanceof Promise);
        if (missing.length === 0) return finish();
        const assets = app.getResource(Assets);
        return Promise.all(missing.map((m) => {
            let got = meshData.get(m);
            if (got === undefined) {
                const read = assets.readMeshData(m).catch(() => null).then((d) => {
                    if (!d) log.warn('worldgen', `the geometry of mesh ${m} cannot be read, so what it draws is left out`);
                    meshData.set(m, d);
                    return d;
                });
                meshData.set(m, read);
                got = read;
            }
            return got;
        })).then(finish);
    }

    /** Puts a chunk in the world: a mesh a kind of decoration, an entity an interactive placement. */
    private place(app: App, gens: WorldGens, parent: Entity, chunk: PlacedChunk): void {
        const world = app.world;
        if (!world.valid(parent)) return;
        const base = (world.get(parent, Transform) as TransformData).worldPosition;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        const built = gens.built_.get(parent);
        if (chunk.planted && built?.plants && built.plantsReady) {
            // The plants of the chunk: its entity stands at once, and they grow in it over the frames, as a placed foliage's do.
            const e = world.spawn('WorldGenPlants');
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, { position: { x: chunk.at[0] - base.x, y: chunk.at[1] - base.y, z: chunk.at[2] - base.z } });
            world.setParent(e, parent);
            chunk.entities.push(e);
            chunk.grown = { entity: e, handles: [], dead: false };
            const growth = plantGrowthOf(app);
            const interactive = built.plants.kinds.some((k) => k.interaction);
            if (interactive) chunk.grown.sets = [];
            if (chunk.far) growth.growFar(app, chunk.grown, built.plants.kinds, built.plantsReady, chunk.planted, { x: chunk.at[0], z: chunk.at[2], half: chunk.side / 2 }, chunk.thinnedBy);
            else growth.growCell(app, chunk.grown, built.plants.kinds, built.plantsReady, chunk.planted);
            if (interactive) {
                const source = `world:${built.data.world}`;
                if (chunk.far) plantInteractionOf(app).addFarCell(chunk.grown, source, built.plants.kinds, built.plantsReady);
                else plantInteractionOf(app).addCell(chunk.grown, source, built.plants.kinds, built.plantsReady, chunk.planted, chunk.side / 2);
            }
        }
        for (const d of chunk.decor) {
            const handle = assets?.createMesh(d.data) ?? 0;
            if (!handle) continue;
            chunk.meshes.push(handle);
            const farHandle = d.far ? assets?.createMesh(d.far) ?? 0 : 0;
            if (farHandle) chunk.meshes.push(farHandle);
            const e = world.spawn('WorldGenDecor');
            // Made again from the rules whenever its chunk is: a scene or a save never holds it.
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, { position: { x: d.origin[0] - base.x, y: d.origin[1] - base.y, z: d.origin[2] - base.z } });
            world.insert(e, MeshRenderer, {
                mesh: handle, material: d.material, lit: true, opaque: true, cullBackfaces: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
            const lodDef = getComponent('LODGroup');
            if (lodDef) {
                // The layer's distances as the screen sizes the engine compares, on the sphere it will measure: the one round
                // what this chunk actually holds, which for a chunk with one group of rocks in it is a small part of the chunk.
                const radius = lodSphereRadius([d.data, farHandle ? d.far : null]);
                world.insert(e, lodDef, {
                    lod1: farHandle, lod2: 0, lod3: 0, lod1Size: farHandle ? lodSizeAtDistance(radius, d.lodDistance) : 0, lod2Size: 0, lod3Size: 0,
                    cullSize: lodCullSizeWithin(radius, d.drawDistance), hysteresis: 0.1, enabled: true,
                });
            }
            world.setParent(e, parent);
            chunk.entities.push(e);
        }
        for (const p of chunk.objects) {
            const e = world.spawn(`${p.interactive} ${p.id}`);
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, {
                position: { x: p.x - base.x, y: p.y - base.y, z: p.z - base.z },
                rotation: orientation(p),
                scale: { x: p.scale, y: p.scale, z: p.scale },
            });
            if (assets && p.mesh) {
                world.insert(e, MeshRenderer, {
                    mesh: p.mesh, material: p.material, lit: true, opaque: true, color: { r: 1, g: 1, b: 1, a: 1 },
                } as Partial<MeshRendererData>);
            }
            world.insert(e, PlacedObject, { id: p.id, kind: p.interactive! });
            world.setParent(e, parent);
            chunk.entities.push(e);
            gens.objects_.set(p.id, e);
        }
    }

    private unplace(app: App, gens: WorldGens, chunk: PlacedChunk): void {
        if (chunk.grown) { plantGrowthOf(app).release(app, chunk.grown); chunk.grown = null; }
        const mine = new Set(chunk.entities);
        for (const p of chunk.objects) if (mine.has(gens.objects_.get(p.id)!)) gens.objects_.delete(p.id);
        for (const e of chunk.entities) if (app.world.valid(e)) app.world.despawn(e);
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const h of chunk.meshes) assets?.releaseBuiltMesh(h);
        chunk.entities.length = 0;
        chunk.meshes.length = 0;
        chunk.assets?.release();
        chunk.assets = undefined;
    }

    private retire(app: App, gens: WorldGens, built: BuiltWorld): void {
        built.retired = true;
        for (const stop of built.listeners.splice(0)) stop();
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        for (const id of built.levelled) this.unlevel(terrains, gens, built, id);
        built.levelling.clear();
        if (terrains && built.paint && terrains.paint_ === built.paint) {
            const remaining = [...gens.built_.values()].reverse().find(other => !other.retired && other.paint);
            terrains.setPaint(remaining?.paint ?? null);
        }
        built.paint = null;
        built.assets.release();
    }

    private drop(app: App, gens: WorldGens, entity: Entity): void {
        const built = gens.built_.get(entity);
        if (app.hasResource(ProceduralChunksRes)) {
            for (const l of built?.rules?.layers ?? []) dropLayer(app, entity, l.id);
            if (built?.faces && app.hasResource(PlanetRegistryRes)) app.getResource(PlanetRegistryRes).setPaint(entity, null);
        }
        if (built) this.retire(app, gens, built);
        gens.built_.delete(entity);
    }

    private sweep(app: App, gens: WorldGens): void {
        for (const entity of [...gens.built_.keys()]) {
            if (app.world.valid(entity) && app.world.has(entity, WorldGen) && app.world.has(entity, Transform)) continue;
            this.drop(app, gens, entity);
        }
    }
}

/** The meshes and materials a rule set's recipes name by path. */
function assetRefsOf(rules: WorldRules): { kind: 'mesh' | 'material'; ref: string }[] {
    const seen = new Map<string, { kind: 'mesh' | 'material'; ref: string }>();
    for (const r of rules.recipes) for (const m of [r.anchor, ...(r.members ?? [])]) {
        if (typeof m.mesh === 'string' && m.mesh) seen.set(`mesh:${m.mesh}`, { kind: 'mesh', ref: m.mesh });
        if (typeof m.material === 'string' && m.material) seen.set(`material:${m.material}`, { kind: 'material', ref: m.material });
    }
    return [...seen.values()];
}

/** What a placement leans toward: the ground's normal when it is aligned, else which way is up where it stands on a round world; null when it stands along +Y. */
function leanOf(p: Placement): [number, number, number] | null {
    return p.attach === 'align' ? p.normal : (p.up ?? null);
}

/** A placement of a face's plane as it stands on the planet: its place in the world, its normal and up in the world, and its face in its names. */
function onPlanet(p: Placement, face: PlanetFace): Placement {
    const at = face.world(p.x, p.y, p.z);
    return {
        ...p, id: `f${face.face}:${p.id}`, group: `f${face.face}:${p.group}`, x: at[0], y: at[1], z: at[2],
        normal: face.worldNormal(p.normal, p.x, p.z), up: face.frameAt(p.x, p.z).dir,
    };
}

/** A placement's turn: about the vertical, and leaning with the ground when it is aligned (or with up, on a round world). */
function orientation(p: Placement): { x: number; y: number; z: number; w: number } {
    const half = p.yaw / 2;
    const yawQ = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    const lean = leanOf(p);
    if (!lean) return yawQ;
    // The turn that takes up to the normal, after the yaw.
    const [nx, ny, nz] = lean;
    const ax = nz, az = -nx, s = Math.hypot(ax, az);
    if (s < 1e-6) return yawQ;
    const angle = Math.acos(Math.min(Math.max(ny, -1), 1)) / 2;
    const tilt = { x: (ax / s) * Math.sin(angle), y: 0, z: (az / s) * Math.sin(angle), w: Math.cos(angle) };
    return {
        x: tilt.w * yawQ.x + tilt.x * yawQ.w + tilt.y * yawQ.z - tilt.z * yawQ.y,
        y: tilt.w * yawQ.y - tilt.x * yawQ.z + tilt.y * yawQ.w + tilt.z * yawQ.x,
        z: tilt.w * yawQ.z + tilt.x * yawQ.y - tilt.y * yawQ.x + tilt.z * yawQ.w,
        w: tilt.w * yawQ.w - tilt.x * yawQ.x - tilt.y * yawQ.y - tilt.z * yawQ.z,
    };
}

export const worldGenPlugin: Plugin = new WorldGenPlugin();
