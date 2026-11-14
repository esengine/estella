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
import { holdShaderWarmup } from '../render/shaderWarmup';
import { currentWeather, currentWeatherDrive, WeatherDrive } from '../postprocess/weather';
import { isEditor, isPlayMode } from '../ecs/env';
import type { Zones } from '../worldgen/zones';
import { installFoliageContacts } from './foliageContacts';
import { lodCullSizeWithin, lodSizeAtDistance, lodSphereRadius } from '../render/lodDistance';
import { buildFoliageCell, type CellSurroundings, type DensityMap, type FoliageCellSpec } from './cellBuild';
import { imagePixelsAt } from '../terrain/layerArrays';
import { bakesOf } from '../runtime/bakes';
import { firstSend, forgetSent, planPool } from '../runtime/planPool';
import type { FoliageCellRequest, FoliageSurroundingsSpec } from '../worldgen/planWorker';

/**
 * How many cells an area is cut into along x and z: as many as it takes for none to be wider than `cellSize`, however large the area.
 * Only those near the eye are ever grown, so the count costs nothing; a cap on it would leave each cell wider than the plants scattered in it.
 */
export function foliageCellsAcross(sizeX: number, sizeZ: number, cellSize: number): { x: number; z: number } {
    const side = Math.max(1, cellSize);
    return { x: Math.max(1, Math.ceil(sizeX / side)), z: Math.max(1, Math.ceil(sizeZ / side)) };
}

/** The fields of the `Foliage` component. @experimental */
export interface FoliageData {
    /** The plant to scatter. Empty grows grass, blades made here. */
    mesh: number;
    /** A material on the Foliage shader, which makes the wind. Empty draws the plants in their own colours, still. */
    material: number;
    /** An image over the area whose red says how many of the plants stand where: none at 0, all the field asks at white. Empty grows them everywhere. */
    densityMap: number;
    /** An image over the area whose red says how large the plants stand where: full size at white, none at black. */
    scaleMap: number;
    /** A picture over the area that colours the plants by where they stand, mixed in by its alpha (the material's shader reads it). */
    colorMap: number;
    /** How much of the colour map is mixed in where its alpha is whole. */
    colorMapStrength: number;
    /** A strip of colours each plant takes the colour of its top from, by a number of its own: as wide a share of the strip, as many of the plants. */
    palette: number;
    /** How many far versions a cell has, 1 to 3: each is the same plants, fewer and larger, and takes over `farStep` times further out than the last. */
    farLevels: number;
    /** The share of its plants each far version keeps of the one before. They thin to it plant by plant before it takes over, so nothing jumps. */
    farKeep: number;
    /** How many times further out each far version takes over than the one before: the first at `lodDistance`. */
    farStep: number;
    /** The most a plant kept in a far version is grown by, to cover the ground the ones left out did. */
    farGrow: number;
    /** The share of that growth a mesh plant's height takes, 0 to 1: at 0 it grows across the ground only, at 1 the same every way. Grass grows broader, never higher. */
    farGrowUp: number;
    /** How far the top of a mesh plant is tipped over in its far versions, in degrees, each plant its own way round. */
    farTilt: number;
    /** How far the head of a mesh plant turns to face the eye, 0 to 1: at the eye, and half the draw distance away. */
    faceEyeNear: number;
    faceEye: number;
    /** A mesh's far version is crossed cards of its texture (a tree). Off, it is the plant itself, fewer and larger (a flower). */
    farCards: boolean;
    /** How far up a plant the colour map begins: 0 colours it whole, 0.6 only its top (a flower's head, on a mesh whose red rises to it). */
    colorMapFrom: number;
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
    /** How far a blade's tip is thrown over, as a share of its height. */
    bladeLean: number;
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
    mesh: 0, material: 0, densityMap: 0, scaleMap: 0, colorMap: 0, colorMapStrength: 1, colorMapFrom: 0, palette: 0,
    farLevels: 1, farKeep: 0.34, farStep: 2, farGrow: 2, farGrowUp: 0, farTilt: 0, faceEyeNear: 0, faceEye: 0, farCards: true,
    sizeX: 400, sizeZ: 400, cellSize: 40, count: 500, seed: 1,
    minScale: 0.8, maxScale: 1.25, minUp: 0.7, heightMin: -100000, heightMax: 100000, waterDepth: 0,
    bladeHeight: 14, bladeWidth: 1.6, bladeLean: 0.12, lodDistance: 140, drawDistance: 420, castShadows: true,
    zoneWorld: '', zoneTags: '', zonePadding: 0,
    cardU0: 0, cardV0: 0, cardU1: 1, cardV1: 1, cardTent: 0,
}, {
    assetFields: [{ field: 'mesh', type: 'mesh' }, { field: 'material', type: 'material' }, { field: 'densityMap', type: 'texture' }, { field: 'scaleMap', type: 'texture' }, { field: 'colorMap', type: 'texture' }, { field: 'palette', type: 'texture' }],
    fields: {
        mesh: { tooltip: 'The plant to scatter. Empty grows grass.', category: 'Plant' },
        material: { tooltip: 'A material on the Foliage shader, which makes the wind. Empty draws the plants still, in their own colours.', category: 'Plant' },
        densityMap: { tooltip: 'An image over the area whose red says how many of the plants stand where: none at black, all of them at white. Its Use is Data. Empty grows them everywhere.', category: 'Placement' },
        scaleMap: { tooltip: 'An image over the area whose red says how large the plants stand where: full size at white, smaller toward black, none at black. A sward that shrinks to nothing has a soft edge where one that only thins has a ragged one. Its Use is Data. Empty leaves every plant its own size.', category: 'Placement' },
        colorMap: { tooltip: 'A picture over the area that colours the plants by where they stand, mixed in by its alpha. Needs a material.', category: 'Plant' },
        colorMapStrength: { min: 0, max: 1, step: 0.01, slider: true, category: 'Plant', tooltip: 'How much of the colour map is mixed in where its alpha is whole.' },
        palette: { tooltip: 'A strip of colours each plant takes the colour of its top from, by a number of its own: as wide a share of the strip, as many of the plants. Needs a material; the top begins at its Tip From.', category: 'Plant' },
        colorMapFrom: { min: 0, max: 1, step: 0.01, slider: true, category: 'Plant', tooltip: 'How far up a plant the colour map begins: 0 colours it whole, higher only its top.' },
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
        bladeLean: { min: 0, max: 2, step: 0.01, slider: true, category: 'Grass', tooltip: 'How far a blade’s tip is thrown over, as a share of its height, each blade its own way. Upright blades are needles with the ground between them; blades that lie over cover it.' },
        farLevels: { min: 1, max: 3, step: 1, category: 'Distance', tooltip: 'How many far versions a cell has: each is the same plants, fewer and larger, and takes over further out than the last.' },
        farKeep: { min: 0.1, max: 1, step: 0.01, slider: true, category: 'Distance', tooltip: 'The share of its plants each far version keeps of the one before. They thin to it plant by plant before it takes over.' },
        farStep: { min: 1.2, max: 4, step: 0.05, category: 'Distance', tooltip: 'How many times further out each far version takes over than the one before. The first takes over at the LOD distance.' },
        farGrow: { min: 1, max: 6, step: 0.1, category: 'Distance', tooltip: 'The most a plant kept in a far version is grown by, to cover the ground the ones left out did.' },
        farGrowUp: { min: 0, max: 1, step: 0.01, slider: true, category: 'Distance', tooltip: 'The share of that growth the height of a mesh plant takes: at 0 it grows across the ground only (a clump of flowers is no taller than a flower), at 1 the same every way.' },
        farTilt: { min: 0, max: 90, step: 1, slider: true, category: 'Distance', tooltip: 'How far the top of a mesh plant is tipped over in its far versions, each plant its own way round. A flat flower is edge on to a low eye a field away; tipped, half the field shows its face.' },
        faceEyeNear: { min: 0, max: 1, step: 0.01, slider: true, category: 'Distance', tooltip: 'How far the head of a mesh plant (the last tenth of its height) is turned to face the eye, close to. Needs a material.' },
        faceEye: { min: 0, max: 1, step: 0.01, slider: true, category: 'Distance', tooltip: 'How far it is turned to face the eye half the draw distance away and beyond: a far flower stands for a clump, and a clump shows its colour from the side. Needs a material.' },
        farCards: { category: 'Far version', tooltip: 'A mesh\'s far version is crossed cards of its texture (a tree). Off, it is the plant itself, fewer and larger (a flower).' },
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
    /** The field's own instance of its material (0 with none): what its cells are drawn with and where everything the field itself says is written, so two fields on one material do not write over each other. */
    instance: number;
    /** The density map's red, read once; null where the field has none. */
    density: { width: number; height: number; values: Uint8Array } | null;
    scale: { width: number; height: number; values: Uint8Array } | null;
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
/** The most far versions a cell has. */
const FAR_LEVELS = 3;
/** A field's layer of cells; with `level`, the layer of one version of them (0 the near one). */
const layerOf = (entity: Entity, level = 0): string => (level === 0 ? `foliage:${entity}` : `foliage:${entity}:${level}`);
/**
 * Whether a field's versions are layers of their own, each grown only as far out as it is drawn and told apart by the shader: what a
 * material makes possible, for grass and for a mesh whose far version is itself. Else a cell holds its versions and a LODGroup picks one.
 */
const farLevelsOf = (data: FoliageData, mesh: boolean): number =>
    (data.material && (!mesh || !data.farCards) ? Math.min(Math.max(Math.floor(data.farLevels), 1), FAR_LEVELS) : 0);
/** Where far version `level` (1 on) takes over from the one before. */
const takesOverAt = (data: FoliageData, level: number): number => data.lodDistance * Math.pow(Math.max(data.farStep, 1.01), level - 1);

/** Run-time facts about the foliage the plugin has grown. */
export class FoliageField {
    /** @internal */ readonly built_ = new Map<Entity, BuiltFoliage>();
    /** @internal The u_windStrength each material had before the weather's wind scaled it, to put back. */
    readonly authoredWind_ = new Map<number, number>();
    /** Instances of materials no field draws with any more, let go once the cells grown with them are gone. */
    readonly retired_: { instance: number; frames: number }[] = [];

    /** @internal */ app_: App | null = null;

    /** @internal Cells whose geometry has come back from a worker and is waiting to be put in the world, a few a frame. */
    readonly landed_: (() => void)[] = [];

    /** How many cells near enough to be drawn, across every field, are still waiting to be grown. */
    get pending(): number {
        let n = 0;
        for (const [entity, b] of this.built_) {
            for (let level = 0; level <= FAR_LEVELS; level++) n += this.statusOf_(entity, level)?.pending ?? 0;
            if (b.loading) n++;
        }
        return n;
    }

    /** How many cells are grown and standing now, across every field. */
    get cellCount(): number {
        let n = 0;
        for (const entity of this.built_.keys()) {
            for (let level = 0; level <= FAR_LEVELS; level++) {
                const s = this.statusOf_(entity, level);
                if (s) n += s.ready + s.stale;
            }
        }
        return n;
    }

    private statusOf_(entity: Entity, level = 0): ChunkLayerStatus | null {
        const app = this.app_;
        return app?.hasResource(ProceduralChunksRes) ? app.getResource(ProceduralChunksRes).status(layerOf(entity, level)) : null;
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
        // Cells still to be grown, or grown and not yet put in the world, draw with shaders nothing has asked for yet.
        holdShaderWarmup(app, () => (app.hasResource(Assets) ? field.pending + field.landed_.length : 0));
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
                // The colour map is read by the material each frame: changing it grows nothing again.
                const { colorMap: _c, colorMapStrength: _s, colorMapFrom: _f, palette: _p, ...grown } = data;
                const signature = JSON.stringify(grown);
                let built = field.built_.get(entity);
                if (!built || built.signature !== signature) {
                    // The instance outlives a rebuild on the same material; one on a material no longer the field's is let go once its old cells are.
                    const kept = built && built.data.material === data.material ? built.instance : 0;
                    if (built && built.instance && !kept) field.retired_.push({ instance: built.instance, frames: 600 });
                    const instance = kept || (data.material ? Material.createInstance(data.material) : 0);
                    built = { signature, data: { ...data }, source: null, instance, density: null, scale: null, loading: true, epoch: (built?.epoch ?? 0) + 1 };
                    field.built_.set(entity, built);
                    void this.start(app, built);
                }
                built.data = { ...data };
                this.wash(app, entity, built);
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
            if (app.hasResource(ProceduralChunksRes)) for (let level = 0; level <= FAR_LEVELS; level++) app.getResource(ProceduralChunksRes).remove(layerOf(entity, level));
        }
        for (const built of field.built_.values()) if (built.instance) Material.release(built.instance);
        for (const r of field.retired_) Material.release(r.instance);
        field.retired_.length = 0;
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
            // A map of numbers over the area, its red: what an image the field reads on the CPU is.
            const numbers = async (handle: number, what: string, without: string): Promise<BuiltFoliage['density']> => {
                const path = app.getResource(Assets).pathForHandle('texture', handle);
                const image = path ? await imagePixelsAt(app, path) : null;
                if (!image) { log.warn('foliage', `the ${what} (texture ${handle}) cannot be read, so its plants ${without}`); return null; }
                const values = new Uint8Array(image.width * image.height);
                for (let i = 0; i < values.length; i++) values[i] = image.pixels[i * 4]!;
                return { width: image.width, height: image.height, values };
            };
            if (data.densityMap) built.density = await numbers(data.densityMap, 'density map', 'grow everywhere');
            if (data.scaleMap) built.scale = await numbers(data.scaleMap, 'scale map', 'keep their own size');
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
        const far = farLevelsOf(data, !!built.source);
        const side = Math.max(1, data.cellSize);
        for (let level = 0; level <= FAR_LEVELS; level++) {
            if (level > far) { chunksOf(app).remove(layerOf(entity, level)); continue; }
            // A version is grown as far out as it is drawn: to where the next takes over, and the last to the draw distance.
            const reach = far === 0 || level === far ? data.drawDistance : Math.min(takesOverAt(data, level + 1) + side, data.drawDistance);
            const only = far === 0 ? null : level;
            chunksOf(app).set<GrownCell>(layerOf(entity, level), {
                label: 'Growing the plants',
                // Made on the workers where they can be: the layer then takes none of the frame's budget to make, only to land.
                async: away !== null,
                waiting: waiting || built.loading,
                originX: t.worldPosition.x - data.sizeX / 2 * sx, originZ: t.worldPosition.z - data.sizeZ / 2 * sz,
                sizeX: data.sizeX / cells.x * sx, sizeZ: data.sizeZ / cells.z * sz,
                extent: [0, 0, cells.x, cells.z],
                loadRadius: reach,
                unloadRadius: reach + side * 1.5,
                generation,
                // Plants stand on the ground and keep out of the water: while either is still being made, they wait.
                make: (cx, cz, signal) => (waiting || built.loading ? null : this.grow(app, entity, built, cx, cz, away, generation, signal, only)),
                publish: (_cx, _cz, cell) => { if (cell.entity !== null) app.world.setParent(cell.entity, entity); },
                release: (_cx, _cz, cell) => {
                    if (cell.entity !== null && app.world.valid(cell.entity)) app.world.despawn(cell.entity);
                    for (const handle of cell.handles) assets.releaseBuiltMesh(handle);
                },
            });
        }
    }

    /** The field's density map where it lies in the world: over the whole area. */
    private densityOf(app: App, entity: Entity, built: BuiltFoliage): DensityMap | null {
        return this.mapOf(app, entity, built, built.density);
    }

    /** The same for its scale map. */
    private scaleOf(app: App, entity: Entity, built: BuiltFoliage): DensityMap | null {
        return this.mapOf(app, entity, built, built.scale);
    }

    private mapOf(app: App, entity: Entity, built: BuiltFoliage, map: BuiltFoliage['density']): DensityMap | null {
        const t = app.world.tryGet(entity, Transform) as TransformData | null;
        if (!map || !t) return null;
        const sizeX = built.data.sizeX * (t.worldScale.x || 1), sizeZ = built.data.sizeZ * (t.worldScale.z || 1);
        return { ...map, originX: t.worldPosition.x - sizeX / 2, originZ: t.worldPosition.z - sizeZ / 2, sizeX, sizeZ };
    }

    /** Writes the colour map and the palette to the field's instance of its material. */
    private wash(app: App, entity: Entity, built: BuiltFoliage): void {
        const material = built.instance, data = built.data;
        if (!material) return;
        const t = app.world.tryGet(entity, Transform) as TransformData | null;
        const strength = data.colorMap && t ? data.colorMapStrength : 0;
        if (strength > 0 && t) {
            const sizeX = data.sizeX * (t.worldScale.x || 1), sizeZ = data.sizeZ * (t.worldScale.z || 1);
            Material.setUniform(material, 'u_colorMap', Material.tex(data.colorMap));
            Material.setUniform(material, 'u_colorMapArea', { x: t.worldPosition.x - sizeX / 2, y: t.worldPosition.z - sizeZ / 2, z: sizeX, w: sizeZ });
            Material.setUniform(material, 'u_colorMapFrom', data.colorMapFrom);
        }
        Material.setUniform(material, 'u_colorMapStrength', strength);
        if (data.palette) Material.setUniform(material, 'u_palette', Material.tex(data.palette));
        Material.setUniform(material, 'u_paletteOn', data.palette ? 1 : 0);
    }

    private cellsAcross(data: FoliageData): { x: number; z: number } {
        return foliageCellsAcross(data.sizeX, data.sizeZ, data.cellSize);
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
        const density = this.densityOf(app, entity, built), scale = this.scaleOf(app, entity, built);
        const around = (): FoliageSurroundingsSpec => ({ ground, flatY, water: waterData, zones: zones ? [...zones.all()] : [], density, scale });
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
                 away: ((cell: FoliageCellSpec) => Promise<MeshData[]>) | null = null, generation?: string, signal?: AbortSignal,
                 only: number | null = null): GrownCell | Promise<GrownCell | null> | null {
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
        // The cell stands on the ground under its centre, not at the entity's height: how far a cell is (what thins its plants) is
        // measured from where they are. On a hill a cell at the entity's height was a hill's height away with the eye in the grass.
        const groundY = (hasTerrain ? terrains!.heightAt(worldX, worldZ) : null) ?? t.worldPosition.y;
        const lift = (groundY - t.worldPosition.y) / (t.worldScale.y || 1);
        // Plants thin, each by its own number, to what the next far version keeps before it takes over, and to none at the draw distance.
        if (built.instance) {
            const thins = !built.source || !data.farCards;
            Material.setUniform(built.instance, 'u_thinLevels', farLevelsOf(data, !!built.source));
            Material.setUniform(built.instance, 'u_bladeWidth', built.source ? 0 : data.bladeWidth);
            Material.setUniform(built.instance, 'u_bladeHeight', built.source ? 0 : data.bladeHeight);
            Material.setUniform(built.instance, 'u_thinGrow', Math.max(data.farGrow, 1));
            Material.setUniform(built.instance, 'u_thinDistance', thins ? data.lodDistance : 0);
            Material.setUniform(built.instance, 'u_thinKeep', Math.min(Math.max(data.farKeep, 0.01), 1));
            Material.setUniform(built.instance, 'u_thinStep', Math.max(data.farStep, 1.01));
            Material.setUniform(built.instance, 'u_thinEnd', thins ? data.drawDistance : 0);
            Material.setUniform(built.instance, 'u_faceEyeNear', Math.min(Math.max(data.faceEyeNear ?? 0, 0), 1));
            Material.setUniform(built.instance, 'u_faceEye', Math.min(Math.max(data.faceEye ?? 0, 0), 1));
            Material.setUniform(built.instance, 'u_faceEyeBy', Math.max(data.drawDistance * 0.5, 1e-3));
        }
        const spec: FoliageCellSpec = {
            centerX: worldX, centerZ: worldZ, size: Math.min(side, data.sizeX / cells.x), count: Math.floor(data.count), seed: data.seed,
            cellKey: cz * 1000 + cx, minScale: data.minScale, maxScale: data.maxScale, minUp: data.minUp,
            heightMin: data.heightMin, heightMax: data.heightMax,
            waterDepth: data.waterDepth, zonePadding: data.zonePadding ?? 0,
            tags: ['foliage', data.mesh ? 'tree' : 'grass', ...(data.zoneTags ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
            baseY: groundY,
            seats: !!built.source && !!built.instance && (data.faceEye > 0 || data.faceEyeNear > 0),
            paint: data.material ? null : { base: [0.14, 0.3, 0.08], tip: [0.55, 0.72, 0.25] },
            far: { levels: data.farLevels, keep: data.farKeep, grow: data.farGrow, cards: data.farCards, only, up: data.farGrowUp, tilt: (data.farTilt ?? 0) * Math.PI / 180 },
            look: built.source
                ? { kind: 'mesh', card: { u0: data.cardU0, v0: data.cardV0, u1: data.cardU1, v1: data.cardV1 }, tent: data.cardTent === 1 }
                : { kind: 'grass', bladeHeight: data.bladeHeight, bladeWidth: data.bladeWidth, bladeLean: data.bladeLean ?? 0.12 },
        };
        const here = (): MeshData[] => {
            const around: CellSurroundings = {
                ground: hasTerrain ? terrains! : null, flatY: t.worldPosition.y, water: waterOf(app), zones: zonesOf(app, data.zoneWorld),
                density: this.densityOf(app, parent, built), scale: this.scaleOf(app, parent, built),
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
                    try { resolve(this.land(app, built, cx, cz, localX, lift, localZ, meshes ?? here(), only !== null)); } catch (e) { reject(e); }
                });
            }));
        }
        return this.land(app, built, cx, cz, localX, lift, localZ, here(), only !== null);
    }

    /** Puts a cell's geometry in the world: its meshes on the GPU and the entity that draws them (its parent is set on publishing). */
    private land(app: App, built: BuiltFoliage, cx: number, cz: number, localX: number, lift: number, localZ: number, meshes: MeshData[], banded = false): GrownCell {
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
        world.insert(cell, Transform, { position: { x: localX, y: lift, z: localZ } });
        world.insert(cell, MeshRenderer, {
            mesh: handles[0]!, material: built.instance || data.material, lit: true, opaque: true, cullBackfaces: false,
            castShadows: data.castShadows !== false,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        // A version that is a layer of its own is drawn in its band by its shader and let go with its layer: nothing picks among versions.
        const lodDef = banded ? null : getComponent('LODGroup');
        if (lodDef) {
            // The component's distances as the screen sizes the engine compares, on the sphere it will measure: the one round the
            // plants this cell grew, not round the cell — a cell with a few plants at one edge is a fraction of its own square.
            const radius = lodSphereRadius(handles.length > 1 ? meshes : [meshes[0]]);
            const step = Math.max(data.farStep, 1.01);
            const sizeAt = (level: number): number => (handles[level] ? lodSizeAtDistance(radius, data.lodDistance * Math.pow(step, level - 1)) : 0);
            world.insert(cell, lodDef, {
                lod1: handles[1] ?? 0, lod2: handles[2] ?? 0, lod3: handles[3] ?? 0,
                lod1Size: sizeAt(1), lod2Size: sizeAt(2), lod3Size: sizeAt(3),
                cullSize: lodCullSizeWithin(radius, data.drawDistance), hysteresis: 0.1, enabled: true,
            });
        }
        return { entity: cell, handles };
    }

    private sweep(app: App, field: FoliageField): void {
        for (const [entity, built] of field.built_) {
            if (app.world.valid(entity) && app.world.has(entity, Foliage)) continue;
            if (app.hasResource(ProceduralChunksRes)) for (let level = 0; level <= FAR_LEVELS; level++) app.getResource(ProceduralChunksRes).remove(layerOf(entity, level));
            if (built.instance) field.retired_.push({ instance: built.instance, frames: 2 });
            field.built_.delete(entity);
        }
        for (let i = field.retired_.length - 1; i >= 0; i--) {
            if (--field.retired_[i]!.frames > 0) continue;
            Material.release(field.retired_[i]!.instance);
            field.retired_.splice(i, 1);
        }
    }
}

export const foliagePlugin: Plugin = new FoliagePlugin();
