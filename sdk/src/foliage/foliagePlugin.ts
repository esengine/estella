// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    foliagePlugin.ts
 * @brief   Grass and trees across an area, drawn a cell at a time and swaying in the wind.
 *
 * @details The `Foliage` component says what grows where; this grows it. The entity stays as authored and the cells are its children.
 *          The cells are a layer of procedural chunks (residency/chunks.ts): grown round the streaming sources (or the eye) out to
 *          `drawDistance`, nearest first within the frame's budget, let go with their meshes past it, and grown again when a field or
 *          the ground changes, each old cell staying until its new one replaces it, so nothing is baked and nothing blinks out.
 *          Each cell is a MeshRenderer with a LODGroup (see builder.ts for what each level is), so culling and the choice of level are
 *          the engine's. If there is a Terrain, plants stand on it, avoid what is too steep and wait for it to be built.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, Transform,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import { chunksOf, ProceduralChunksRes, type ChunkLayerStatus } from '../residency/chunks';
import type { Entity } from '../types';
import { TerrainsRes } from '../terrain/terrainPlugin';
import { Material } from '../render/material';
import { currentWeather, currentWeatherDrive, WeatherDrive } from '../postprocess/weather';
import { isEditor, isPlayMode } from '../ecs/env';
import type { Zones } from '../worldgen/zones';
import { installFoliageContacts } from './foliageContacts';
import { lodCullSizeWithin, lodSizeAtDistance, lodSphereRadius } from '../render/lodDistance';
import { buildFoliageCell, type CellSurroundings, type FoliageCellSpec } from './cellBuild';
import { bakesOf } from '../runtime/bakes';
import { firstSend, forgetSent, planPool } from '../runtime/planPool';
import type { FoliageCellRequest, FoliageSurroundingsSpec } from '../worldgen/planWorker';

/** The fields of the `Foliage` component. @experimental */
export interface FoliageData {
    /** The plant to scatter. Empty grows grass, blades made here. */
    mesh: number;
    /** A material on the Foliage shader, which makes the wind. Empty draws the plants in their own colours, still. */
    material: number;
    /** The area, centred on the entity, and the side of the cells it is cut into. */
    sizeX: number;
    sizeZ: number;
    cellSize: number;
    /** Plants per cell. */
    count: number;
    seed: number;
    minScale: number;
    maxScale: number;
    /** The least a place may face up (0 to 1) and still grow something: lower lets plants onto slopes. */
    minUp: number;
    /** The band of heights, in world units, plants grow in. */
    heightMin: number;
    heightMax: number;
    /** How deep under water, in world units, a plant may stand: 0 keeps them on dry ground; reeds stand in the shallows. */
    waterDepth: number;
    /** Grass: how tall and how wide a blade is, at scale 1. */
    bladeHeight: number;
    bladeWidth: number;
    /** Distance past which a cell is drawn as its far version, and past which it is not drawn. */
    lodDistance: number;
    drawDistance: number;
    /** Whether the generated cells cast shadows. Disable for dense short grass; it still receives lighting and shadows. */
    castShadows: boolean;
    /** WorldGen world whose zones reserve roads and buildings. Empty uses its first world; no WorldGen leaves the field unchanged. */
    zoneWorld: string;
    /** Extra comma-separated exclusion tags, in addition to foliage and grass/tree. */
    zoneTags: string;
    /** Additional world-space clearance from a zone's boundary. */
    zonePadding: number;
    /** A tree's far version is two crossed cards showing this rectangle of its texture, as uv: left, bottom, right, top. */
    cardU0: number;
    cardV0: number;
    cardU1: number;
    cardV1: number;
    /** 1 draws a far tree's cards as tents (a conifer's outline) rather than rectangles. */
    cardTent: number;
}

/**
 * Plants across an area. Presence is the opt-in; its children are the cells that draw them.
 *
 * @experimental
 */
export const Foliage: ComponentDef<FoliageData> = defineComponent<FoliageData>('Foliage', {
    mesh: 0, material: 0,
    sizeX: 400, sizeZ: 400, cellSize: 40, count: 500, seed: 1,
    minScale: 0.8, maxScale: 1.25, minUp: 0.7, heightMin: -100000, heightMax: 100000, waterDepth: 0,
    bladeHeight: 14, bladeWidth: 1.6, lodDistance: 140, drawDistance: 420, castShadows: true,
    zoneWorld: '', zoneTags: '', zonePadding: 0,
    cardU0: 0, cardV0: 0, cardU1: 1, cardV1: 1, cardTent: 0,
}, {
    assetFields: [{ field: 'mesh', type: 'mesh' }, { field: 'material', type: 'material' }],
    fields: {
        mesh: { tooltip: 'The plant to scatter. Empty grows grass.', category: 'Plant' },
        material: { tooltip: 'A material on the Foliage shader, which makes the wind. Empty draws the plants still, in their own colours.', category: 'Plant' },
        sizeX: { min: 1, category: 'Area', tooltip: 'World size along x, centred on this entity.' },
        sizeZ: { min: 1, category: 'Area', tooltip: 'World size along z, centred on this entity.' },
        cellSize: { min: 4, category: 'Area', tooltip: 'Side of the cells the area is cut into. Each is one mesh, culled whole.' },
        count: { min: 0, step: 1, category: 'Area', tooltip: 'Plants per cell.' },
        seed: { step: 1, category: 'Area', tooltip: 'Another seed grows the same plants in other places.' },
        minScale: { min: 0.01, category: 'Plant' },
        maxScale: { min: 0.01, category: 'Plant' },
        minUp: { min: 0, max: 1, step: 0.01, category: 'Placement', tooltip: 'The least a place may face up and still grow something. Lower lets plants onto slopes.' },
        heightMin: { category: 'Placement', tooltip: 'The lowest world height plants grow at.' },
        heightMax: { category: 'Placement', tooltip: 'The highest world height plants grow at.' },
        waterDepth: { min: 0, category: 'Placement', tooltip: 'How deep under water a plant may stand. 0 keeps them on dry ground; reeds stand in the shallows.' },
        bladeHeight: { min: 0.1, category: 'Grass', tooltip: 'Height of a blade at scale 1.' },
        bladeWidth: { min: 0.01, category: 'Grass', tooltip: 'Width of a blade at its base, at scale 1.' },
        lodDistance: { min: 1, category: 'Distance', tooltip: 'Past this a cell is drawn as its far version: fewer, broader blades, or a tree as crossed cards.' },
        drawDistance: { min: 1, category: 'Distance', tooltip: 'Past this a cell is not drawn.' },
        castShadows: { category: 'Distance', tooltip: 'Generated cells cast shadows. Turn off for dense short grass to avoid drawing every cell again into each shadow cascade. Lighting and received shadows remain.' },
        zoneWorld: { category: 'Placement', tooltip: 'WorldGen world whose building and road exclusion zones this field respects. Empty uses the first world.' },
        zoneTags: { category: 'Placement', tooltip: 'Extra comma-separated tags used by zone exclusions. foliage and grass (or tree for a mesh) are included automatically.' },
        zonePadding: { min: 0, category: 'Placement', tooltip: 'Extra world-space clearance from building and road zones.' },
        cardU0: { label: 'Card left', category: 'Far version', tooltip: 'The part of the plant\'s texture a far tree shows (left, bottom, right, top).' },
        cardV0: { label: 'Card bottom', category: 'Far version' },
        cardU1: { label: 'Card right', category: 'Far version' },
        cardV1: { label: 'Card top', category: 'Far version' },
        cardTent: { label: 'Card shape', category: 'Far version', enum: [{ label: 'Rectangle', value: 0 }, { label: 'Tent (conifer)', value: 1 }], tooltip: 'The outline of the cards a far tree is drawn as.' },
    },
});

interface BuiltFoliage {
    signature: string;
    data: FoliageData;
    source: MeshData | null;
    loading: boolean;
    epoch: number;
    /** What its cells are being grown for now: a cell that lands for an earlier one is not put in the world. */
    generation?: string;
    /** Its cells' geometry made on the workers, for the surroundings `key` names; null where they cannot be given those. */
    away?: { key: string; grow: ((cell: FoliageCellSpec) => Promise<MeshData[]>) | null };
}

/** One grown cell: its entity (none where nothing grew) and the meshes it owns. */
interface GrownCell { entity: Entity | null; handles: number[] }

/** The water, as foliage asks it (the water module is optional: read by name, not imported). */
interface WaterQuery {
    depthAt(x: number, z: number, y: number): number | null; revision_: number; baking: boolean;
    /** The water as data a worker can answer from, and whether there is none at all. */
    queryData?(): FoliageSurroundingsSpec['water']; readonly empty?: boolean;
}

function waterOf(app: App): WaterQuery | null {
    const w = (app as unknown as { getResourceByName?: (name: string) => unknown }).getResourceByName?.('Waters') as Partial<WaterQuery> | undefined;
    return w && typeof w.depthAt === 'function' ? w as WaterQuery : null;
}

/** Optional world generation: querying zones must not pull that module into a foliage-only game. */
function zonesOf(app: App, world: string | undefined): Zones | null {
    const gens = app.getResourceByName?.('WorldGens') as { zones?(world?: string): Zones } | undefined;
    return gens?.zones?.(world || undefined) ?? null;
}

/** The chunk layer a Foliage's cells are. */
const layerOf = (entity: Entity): string => `foliage:${entity}`;

/** Run-time facts about the foliage the plugin has grown. */
export class FoliageField {
    /** @internal */ readonly built_ = new Map<Entity, BuiltFoliage>();
    /** @internal The u_windStrength each material had before the weather's wind scaled it, to put back. */
    readonly authoredWind_ = new Map<number, number>();

    /** @internal */ app_: App | null = null;

    /** @internal Cells whose geometry has come back from a worker and is waiting to be put in the world, a few a frame. */
    readonly landed_: (() => void)[] = [];

    /** How many cells near enough to be drawn, across every field, are still waiting to be grown. */
    get pending(): number {
        let n = 0;
        for (const [entity, b] of this.built_) n += (this.statusOf_(entity)?.pending ?? 0) + (b.loading ? 1 : 0);
        return n;
    }

    /** How many cells are grown and standing now, across every field. */
    get cellCount(): number {
        let n = 0;
        for (const entity of this.built_.keys()) {
            const s = this.statusOf_(entity);
            if (s) n += s.ready + s.stale;
        }
        return n;
    }

    private statusOf_(entity: Entity): ChunkLayerStatus | null {
        const app = this.app_;
        return app?.hasResource(ProceduralChunksRes) ? app.getResource(ProceduralChunksRes).status(layerOf(entity)) : null;
    }
}

/** The resource the plugin installs. @experimental */
export const FoliageRes = defineResource<FoliageField>(new FoliageField(), 'Foliage');

export class FoliagePlugin implements Plugin {
    name = 'foliage';
    /** No foliage, no work; the frame after the last one goes still runs its sweep. */
    readonly activeWhen = [Foliage];
    private clearContacts_: (() => void) | null = null;

    build(app: App): void {
        const field = new FoliageField();
        field.app_ = app;
        app.insertResource(FoliageRes, field);
        this.clearContacts_ = installFoliageContacts(app);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(Assets)) return;
            const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
            this.sweep(app, field);
            this.blow(app, field);
            // Cells made on the workers are put in the world here, within the frame's budget: making them cost the frame nothing, and
            // a dozen landing at once must not cost it a dozen uploads.
            const bakes = bakesOf(app);
            for (let first = true; field.landed_.length > 0 && (first || bakes.hasTime(field)); first = false) field.landed_.shift()!();
            bakes.mark(field, 'Growing the plants', field.landed_.length === 0 ? 1 : 0.5);
            // Plants are grown again when the ground they stand on or the water they keep out of changes, and wait while either is
            // being made: a plant placed before its terrain is read would stand on nothing.
            const water = waterOf(app);
            const revision = (terrains?.revision_ ?? 0) * 100003 + (water?.revision_ ?? 0);
            const waiting = !!terrains?.loading || !!water?.baking;
            for (const entity of app.world.getEntitiesWithComponents([Foliage, Transform])) {
                const data = app.world.get(entity, Foliage) as FoliageData;
                const signature = JSON.stringify(data);
                let built = field.built_.get(entity);
                if (!built || built.signature !== signature) {
                    built = { signature, data: { ...data }, source: null, loading: true, epoch: (built?.epoch ?? 0) + 1 };
                    field.built_.set(entity, built);
                    void this.start(app, built);
                }
                const zones = zonesOf(app, data.zoneWorld);
                this.layer(app, entity, built, `${revision}:${zones?.revision ?? 0}`, waiting);
            }
        }, { name: 'FoliageSystem' }));
    }

    /**
     * The weather's wind on the plants: each Foliage material's u_windStrength is its authored strength times the weather's `wind`, and is
     * put back when the weather is taken away or stops driving the wind. Only while the game runs, as the weather's lights are: in the
     * editor a material asset is left as authored, so previewing a storm never saves one.
     */
    private blow(app: App, field: FoliageField): void {
        const w = currentWeather();
        const playing = !isEditor() || isPlayMode();
        const wind = w && playing && (currentWeatherDrive() & WeatherDrive.Wind) ? w.wind : 1;
        const materials = new Set<number>();
        if (wind !== 1) {
            for (const entity of app.world.getEntitiesWithComponents([Foliage])) {
                const material = (app.world.get(entity, Foliage) as FoliageData).material;
                if (material) materials.add(material);
            }
        }
        for (const material of materials) {
            let authored = field.authoredWind_.get(material);
            if (authored === undefined) {
                const value = Material.getUniform(material, 'u_windStrength');
                if (typeof value !== 'number') continue;
                authored = value;
                field.authoredWind_.set(material, authored);
            }
            Material.setUniform(material, 'u_windStrength', authored * wind);
        }
        // What the weather no longer blows goes back to its own strength, once; the material is the author's again from then on.
        for (const [material, authored] of field.authoredWind_) {
            if (materials.has(material)) continue;
            Material.setUniform(material, 'u_windStrength', authored);
            field.authoredWind_.delete(material);
        }
    }

    cleanup(app?: App): void {
        this.clearContacts_?.();
        this.clearContacts_ = null;
        if (!app?.hasResource(FoliageRes)) return;
        const field = app.getResource(FoliageRes);
        for (const entity of field.built_.keys()) {
            if (app.hasResource(ProceduralChunksRes)) app.getResource(ProceduralChunksRes).remove(layerOf(entity));
        }
        field.built_.clear();
        // What had come back and not landed is let go with the field: its cells are no longer anyone's.
        field.landed_.length = 0;
    }

    /** Reads the plant's geometry, if it has one; the cells wait for it. */
    private async start(app: App, built: BuiltFoliage): Promise<void> {
        const data = built.data;
        try {
            if (data.mesh) {
                built.source = await app.getResource(Assets).readMeshData(data.mesh);
                if (!built.source) log.warn('foliage', `the geometry of mesh ${data.mesh} cannot be read, so its plants are grass instead`);
            }
        } catch (e) {
            log.error('foliage', 'growing the foliage failed', e);
        } finally {
            built.loading = false;
        }
    }

    /**
     * The field's cells as a layer of chunks: the area's grid, wanted out to `drawDistance` round the streaming sources, grown again
     * (each old cell kept till its new one stands) when a field, the ground or the water changes.
     */
    private layer(app: App, entity: Entity, built: BuiltFoliage, revision: string, waiting: boolean): void {
        const t = app.world.get(entity, Transform) as TransformData;
        const data = built.data, cells = this.cellsAcross(data);
        const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1;
        const assets = app.getResource(Assets);
        const generation = `${built.epoch}:${revision}:${t.worldPosition.x}:${t.worldPosition.y}:${t.worldPosition.z}:${sx}:${sz}`;
        built.generation = generation;
        const away = waiting || built.loading ? null : this.awayFor(app, entity, built, revision, t.worldPosition.y);
        chunksOf(app).set<GrownCell>(layerOf(entity), {
            label: 'Growing the plants',
            // Made on the workers where they can be: the layer then takes none of the frame's budget to make, only to land.
            async: away !== null,
            originX: t.worldPosition.x - data.sizeX / 2 * sx, originZ: t.worldPosition.z - data.sizeZ / 2 * sz,
            sizeX: data.sizeX / cells.x * sx, sizeZ: data.sizeZ / cells.z * sz,
            extent: [0, 0, cells.x, cells.z],
            loadRadius: data.drawDistance,
            unloadRadius: data.drawDistance + Math.max(1, data.cellSize) * 1.5,
            generation,
            // Plants stand on the ground and keep out of the water: while either is still being made, they wait.
            make: (cx, cz, signal) => (waiting || built.loading ? null : this.grow(app, entity, built, cx, cz, away, generation, signal)),
            publish: (_cx, _cz, cell) => { if (cell.entity !== null) app.world.setParent(cell.entity, entity); },
            release: (_cx, _cz, cell) => {
                if (cell.entity !== null && app.world.valid(cell.entity)) app.world.despawn(cell.entity);
                for (const handle of cell.handles) assets.releaseBuiltMesh(handle);
            },
        });
    }

    private cellsAcross(data: FoliageData): { x: number; z: number } {
        const side = Math.max(1, data.cellSize);
        return { x: Math.min(200, Math.max(1, Math.ceil(data.sizeX / side))), z: Math.min(200, Math.max(1, Math.ceil(data.sizeZ / side))) };
    }

    /**
     * What makes a Foliage's cells on the workers, when what they are grown against can be handed over as data: no terrain (a flat
     * area) or one a worker can rebuild, water that is baked or absent, and the zones, which are data already. Null when it cannot,
     * and the cells are made here. Worked out again only when the ground, the water or the zones change.
     */
    private awayFor(app: App, entity: Entity, built: BuiltFoliage, revision: string, flatY: number): ((cell: FoliageCellSpec) => Promise<MeshData[]>) | null {
        const key = `foliage:${entity}:${built.epoch}:${revision}:${flatY}`;
        if (built.away?.key === key) return built.away.grow;
        const none = (): null => { built.away = { key, grow: null }; return null; };
        const pool = planPool();
        if (!pool) return none();
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const hasTerrain = !!terrains && terrains.built_.size > 0;
        const ground = hasTerrain ? terrains!.groundData() : null;
        if (hasTerrain && !ground) return none();
        const water = waterOf(app);
        const waterData = water?.queryData?.() ?? null;
        if (water && !waterData && !water.empty) return none();
        const zones = zonesOf(app, built.data.zoneWorld);
        const around = (): FoliageSurroundingsSpec => ({ ground, flatY, water: waterData, zones: zones ? [...zones.all()] : [] });
        const source = built.source;
        const sourceKey = source ? `${key}:mesh` : undefined;
        const grow = (cell: FoliageCellSpec): Promise<MeshData[]> => {
            // Cells are spread over the workers by where they are, as the world's squares are.
            const worker = Math.abs((Math.floor(cell.centerX / 256) * 73856093) ^ (Math.floor(cell.centerZ / 256) * 19349663)) % pool.size;
            const first = firstSend(worker, key);
            const request: FoliageCellRequest = {
                id: 0, type: 'foliageCell', key, cell,
                ...(first ? { around: around() } : {}),
                ...(sourceKey ? { sourceKey, ...(first ? { source: source! } : {}) } : {}),
            };
            return pool.run<MeshData[]>(worker, request as unknown as Record<string, unknown>).catch((e: unknown) => {
                forgetSent(worker, key);
                throw e;
            });
        };
        built.away = { key, grow };
        return grow;
    }

    /**
     * Grows cell (cx, cz): its plants, their meshes and the entity that draws them, not yet in the world (its parent is set on publishing).
     * The geometry is made on a worker where `away` can make it, and the cell lands a frame or two later; else it is made here.
     */
    private grow(app: App, parent: Entity, built: BuiltFoliage, cx: number, cz: number,
                 away: ((cell: FoliageCellSpec) => Promise<MeshData[]>) | null = null, generation?: string, signal?: AbortSignal): GrownCell | Promise<GrownCell | null> | null {
        const world = app.world;
        if (!world.valid(parent)) return null;
        const data = built.data;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const t = world.tryGet(parent, Transform) as TransformData | null;
        if (!t) return null;
        const side = Math.max(1, data.cellSize);
        const cells = this.cellsAcross(data);
        // The cell's centre in the entity's own space, then in the world's (the ground is answered in the world's).
        const localX = -data.sizeX / 2 + (cx + 0.5) * (data.sizeX / cells.x);
        const localZ = -data.sizeZ / 2 + (cz + 0.5) * (data.sizeZ / cells.z);
        const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1;
        const worldX = t.worldPosition.x + localX * sx, worldZ = t.worldPosition.z + localZ * sz;
        const hasTerrain = !!terrains && terrains.built_.size > 0;
        // Grass thins toward where its cells turn to their far version, so a near cell beside a far one is not three times as thick.
        if (data.material && !built.source) Material.setUniform(data.material, 'u_thinDistance', data.lodDistance);
        const spec: FoliageCellSpec = {
            centerX: worldX, centerZ: worldZ, size: Math.min(side, data.sizeX / cells.x), count: Math.floor(data.count), seed: data.seed,
            cellKey: cz * 1000 + cx, minScale: data.minScale, maxScale: data.maxScale, minUp: data.minUp,
            heightMin: data.heightMin, heightMax: data.heightMax,
            waterDepth: data.waterDepth, zonePadding: data.zonePadding ?? 0,
            tags: ['foliage', data.mesh ? 'tree' : 'grass', ...(data.zoneTags ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
            baseY: t.worldPosition.y,
            paint: data.material ? null : { base: [0.14, 0.3, 0.08], tip: [0.55, 0.72, 0.25] },
            look: built.source
                ? { kind: 'mesh', card: { u0: data.cardU0, v0: data.cardV0, u1: data.cardU1, v1: data.cardV1 }, tent: data.cardTent === 1 }
                : { kind: 'grass', bladeHeight: data.bladeHeight, bladeWidth: data.bladeWidth },
        };
        const here = (): MeshData[] => {
            const around: CellSurroundings = {
                ground: hasTerrain ? terrains! : null, flatY: t.worldPosition.y, water: waterOf(app), zones: zonesOf(app, data.zoneWorld),
            };
            return buildFoliageCell(spec, around, built.source);
        };
        if (away) {
            const field = app.getResource(FoliageRes);
            // A worker that fails a cell does not leave a hole in the field: that cell is made here, and so are the ones after it.
            const made = away(spec).catch((e: unknown) => {
                if (built.away?.grow) log.warn('foliage', 'the workers failed a cell; this field grows its cells on the main thread from here', e);
                if (built.away) built.away = { key: built.away.key, grow: null };
                return null;
            });
            return made.then((meshes) => new Promise<GrownCell | null>((resolve, reject) => {
                // Put in the world on a later frame, within its budget; not at all if the field has moved on while it was being made.
                field.landed_.push(() => {
                    if (signal?.aborted || built.generation !== generation || !app.world.valid(parent)) { resolve(null); return; }
                    try { resolve(this.land(app, built, cx, cz, localX, localZ, meshes ?? here())); } catch (e) { reject(e); }
                });
            }));
        }
        return this.land(app, built, cx, cz, localX, localZ, here());
    }

    /** Puts a cell's geometry in the world: its meshes on the GPU and the entity that draws them (its parent is set on publishing). */
    private land(app: App, built: BuiltFoliage, cx: number, cz: number, localX: number, localZ: number, meshes: MeshData[]): GrownCell {
        if (meshes.length === 0) return { entity: null, handles: [] };
        const world = app.world, data = built.data;
        const assets = app.getResource(Assets);
        const handles: number[] = [];
        for (const mesh of meshes) {
            const handle = assets.createMesh(mesh);
            if (handle === 0) {
                log.warn('foliage', `the engine refused the geometry of cell ${cx},${cz}`);
                for (const h of handles) assets.releaseBuiltMesh(h);
                throw new Error(`the engine refused the geometry of cell ${cx},${cz}`);
            }
            handles.push(handle);
        }

        const cell = world.spawn(`FoliageCell ${cx},${cz}`);
        world.insert(cell, Transform, { position: { x: localX, y: 0, z: localZ } });
        world.insert(cell, MeshRenderer, {
            mesh: handles[0]!, material: data.material, lit: true, opaque: true, cullBackfaces: false,
            castShadows: data.castShadows !== false,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        const lodDef = getComponent('LODGroup');
        if (lodDef) {
            // The component's distances as the screen sizes the engine compares, on the sphere it will measure: the one round the
            // plants this cell grew, not round the cell — a cell with a few plants at one edge is a fraction of its own square.
            const radius = lodSphereRadius(handles.length > 1 ? meshes : [meshes[0]]);
            world.insert(cell, lodDef, {
                lod1: handles[1] ?? 0, lod2: 0, lod3: 0,
                lod1Size: lodSizeAtDistance(radius, data.lodDistance), lod2Size: 0, lod3Size: 0,
                cullSize: lodCullSizeWithin(radius, data.drawDistance), hysteresis: 0.1, enabled: true,
            });
        }
        return { entity: cell, handles };
    }

    private sweep(app: App, field: FoliageField): void {
        for (const entity of field.built_.keys()) {
            if (app.world.valid(entity) && app.world.has(entity, Foliage)) continue;
            if (app.hasResource(ProceduralChunksRes)) app.getResource(ProceduralChunksRes).remove(layerOf(entity));
            field.built_.delete(entity);
        }
    }
}

export const foliagePlugin: Plugin = new FoliagePlugin();
