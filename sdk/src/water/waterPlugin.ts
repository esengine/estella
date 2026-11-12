// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterPlugin.ts
 * @brief   Bodies of water, the zone they are baked into, the one surface drawn from it, and the surface they answer questions about.
 *
 * @details A `WaterBody` says what water is where: an ocean, a lake inside an outline, a river along a Spline, each with the height its waves
 *          stand to and how far in from its shore they calm. It is not drawn on its own: the bodies are inputs to a zone (zone.ts), which bakes
 *          them over its region into one field (the surface's height, the shore, the waves' height, the current) where rivers run into lakes and
 *          lakes into the sea with no seam. One mesh of rings following the camera reads the field and is every body's surface; the zone's
 *          `WaterZone` component (or, without one, a zone over every lake and river with its defaults) says where, how fine, the waves every
 *          body shares and the material.
 *
 *          The waves are the ones the Water shader draws: `waves.ts` is the same formula, and {@link Waters.sample} answers from the same field, so
 *          a floating object, a camera under the surface and a splash all read the surface that is on the screen.
 */
import type { WaterQueryData } from './waterQuery';
import { riverBedModifiers } from './riverBed';
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource, Time } from '../ecs/resource';
import {
    defineComponent, Camera, MeshRenderer, Transform,
    type ComponentDef, type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { TerrainsRes } from '../terrain/terrainPlugin';
import { BlendMode } from '../render/blend';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Entity } from '../types';
import { surfHeight, waveHeight, waveSlope, type WaveParams } from './waves';
import { buildOceanMesh, oceanReach, oceanSnap } from './waterMesh';
import { type Point2 } from './shore';
import { Spline, type SplineData } from '../spline/splinePlugin';
import { SplineCurve } from '../spline/curve';
import { RippleField } from './ripples';
import {
    WaterField, WaterZone, currentShare,
    type RiverStation, type WaterZoneData, type ZoneBody, type ZoneGrid, type ZoneGround,
} from './zone';
import { Quality } from '../render/qualityRuntime';
import { currentWeather, currentWeatherDrive, WeatherDrive } from '../postprocess/weather';
import { defaultQualityProfile, type QualityProfile } from '../render/quality';
import { isMiniGame } from '../platform';

/** What a body of water is. A river follows the `Spline` on its own entity. */
export const WaterForm = { Ocean: 0, Lake: 1, River: 2 } as const;

/** The fields of the `WaterBody` component. @experimental */
export interface WaterBodyData {
    /** {@link WaterForm}. */
    form: number;
    /** What the game calls the body, the same in every session (an entity's number is not): what a query names the water by. */
    bodyId: string;
    /** A lake's extent along x and z, centred on its entity, when it has no outline of its own. An ocean has none: it goes on past the zone. */
    sizeX: number;
    sizeZ: number;
    /** A lake's outline: three points or more round it on its own xz plane (x, y is x, z). Empty is the rectangle of `sizeX` by `sizeZ`. */
    boundary: Point2[];
    /** How far in from the shore, and how deep, the waves take to come to full height; 0 leaves them whole to the edge. */
    shoreWidth: number;
    /** A river's current, in world units a second where the river is as wide as its widest; a narrower reach runs faster. */
    flowSpeed: number;
    /** The height of the tallest wave, in world units. Their length, speed and heading are the zone's, which every body shares. */
    waveHeight: number;
    /** How deep a river cuts its bed into the terrain under its surface, at its middle; 0 leaves the ground as it is. */
    bedDepth: number;
}

/**
 * A body of water. Presence is the opt-in; it is drawn as part of its zone's surface.
 *
 * @experimental
 */
export const WaterBody: ComponentDef<WaterBodyData> = /* @__PURE__ */ defineComponent<WaterBodyData>('WaterBody', {
    form: WaterForm.Lake, bodyId: '', sizeX: 100, sizeZ: 100, boundary: [] as Point2[], shoreWidth: 3, flowSpeed: 2, waveHeight: 0.3, bedDepth: 0,
}, {
    fields: {
        form: { enum: [{ label: 'Ocean', value: WaterForm.Ocean }, { label: 'Lake', value: WaterForm.Lake }, { label: 'River', value: WaterForm.River }], category: 'Shape', tooltip: 'An ocean is without edge: everywhere at its height where the ground is lower; a lake is a rectangle or an outline of its own; a river follows the Spline on the same entity.' },
        bodyId: { category: 'Shape', tooltip: 'What the game calls this body, the same in every session: what a query names the water by. Empty is named by its entity.' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along x.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'A lake\'s size along z.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        boundary: { category: 'Shape', tooltip: 'The outline of a lake: points round it on its own xz plane. Empty is the rectangle of its size.', shownWhen: { field: 'form', values: [WaterForm.Lake] } },
        shoreWidth: { min: 0, category: 'Shape', tooltip: 'How far in from the shore, and how deep, the waves take to come to full height. 0 leaves them whole to the edge.' },
        flowSpeed: { min: 0, max: 5000, category: 'Waves', tooltip: 'A river\'s current, in world units a second where it is as wide as its widest. A narrower reach runs faster.', shownWhen: { field: 'form', values: [WaterForm.River] } },
        bedDepth: { min: 0, category: 'Shape', tooltip: 'How deep the river cuts its bed into the terrain under its surface, at its middle, its banks blending back into the ground. 0 leaves the ground as it is.', shownWhen: { field: 'form', values: [WaterForm.River] } },
        waveHeight: { min: 0, max: 800, category: 'Waves', tooltip: 'The height of the tallest wave, in world units. Their length, speed and heading are the zone\'s.' },
    },
});

/** What {@link Waters.sample} answers. */
export interface WaterSample {
    /** The entity of the body that holds the most of the water there, and what the game calls it (its `bodyId`). */
    entity: Entity;
    bodyId: string;
    /** How far the point is above the surface (negative under it), in world units. */
    depth: number;
    /** The surface's normal at the point, in world space. */
    normal: [number, number, number];
    /** How the water moves there, in world units a second (a river's current; still water is zero). */
    flow: [number, number, number];
    /** The world position of the surface above or below the point. */
    surface: [number, number, number];
    /** Whether the point is over water: always, for an answer that is not null. */
    inside: boolean;
}

/** What the quality level lets water spend: waves summed, the ripple grid's side, whether waves lift the geometry, the mirror from below, the sun's light through it. */
export interface WaterQuality {
    waves: number;
    rippleCells: number;
    displacement: boolean;
    mirror: boolean;
    caustics: boolean;
}

/** Everything on: a project with no quality policy, off a minigame. */
export const FULL_WATER: WaterQuality = { waves: 4, rippleCells: 256, displacement: true, mirror: true, caustics: true };

/**
 * What water is allowed: the active quality profile when the project has a quality policy running; else the low profile on a minigame, which has the least to spend and
 * gets the lite water (flat geometry, no mirror, no web of light) without anyone asking; else everything.
 */
export function waterQualityOf(profile: Readonly<QualityProfile> | null, miniGame: boolean): WaterQuality {
    const p = profile ?? (miniGame ? defaultQualityProfile('low') : null);
    if (!p) return FULL_WATER;
    return { waves: p.waterWaves, rippleCells: p.waterRippleCells, displacement: p.waterDisplacement, mirror: p.waterMirror, caustics: p.waterCaustics };
}

/** The zone a scene without a `WaterZone` is given: the component's defaults, over every lake and river. */
const ZONE_DEFAULTS: WaterZoneData = { ...WaterZone._default };

/** Run-time access to the water: where its surface is at a point, for what floats on it or swims in it. */
export class Waters {
    /** @internal */ app_: App | null = null;
    /** What the quality level allows now; the plugin refreshes it each frame, and what is drawn and what is answered both follow it. */
    quality: WaterQuality = FULL_WATER;
    /** The baked water, and the zone it was baked by. @internal */
    field_: WaterField | null = null;
    /** @internal */ zone_: WaterZoneData = ZONE_DEFAULTS;
    /** The ripples the zone keeps, where it asks for them. @internal */
    ripples_: RippleField | null = null;
    /** The material instance the surface is drawn with, for what draws the same water (the underwater effect). @internal */
    instance_ = 0;
    /** Bumped each time a new bake lands, so what is placed by the water (plants kept out of it) knows to place again. @internal */
    revision_ = 0;
    /** Whether a bake is in hand: what is placed by the water waits for it. */
    baking = false;

    /** The baked water as data a worker can answer `depthAt` and `shoreAt` from, or null where none is baked. */
    queryData(): WaterQueryData | null {
        return this.field_?.query().data ?? null;
    }

    /**
     * Whether there is no water to ask about: nothing is baked, so `depthAt` answers null everywhere. A world laid out with no water at
     * all is laid out the same here and on a worker, which "no data to hand over" alone does not say.
     */
    get empty(): boolean {
        return this.field_ === null;
    }

    /** How deep the water stands at rest over the world height `y` at (x, z): above zero under water, null where there is none. */
    depthAt(x: number, z: number, y: number): number | null {
        return this.field_?.query().depthAt(x, z, y) ?? null;
    }

    /**
     * The surface over or under `(x, y, z)`: how far above it the point is (negative under), the surface's normal, the current, and the point
     * on it straight above or below. Null where there is no water. The waves are read at the instant of the frame.
     */
    sample(x: number, y: number, z: number): WaterSample | null {
        const field = this.field_;
        if (!field || !this.app_) return null;
        const s = field.sample(x, z);
        if (!s) return null;
        const time = this.app_.getResource(Time).elapsed;
        const params = this.waves(s.amp, s.exposure);
        const zone = this.zone_;
        const still = s.still;
        // Surf is swell come in from open water: sheltered water has as little of it as it is sheltered.
        const surf = surfHeight(s.shore, zone.surf * grown(s.exposure) * s.swell * s.exposure * still, zone.surfLength, zone.waveSpeed, time, s.surf);
        // The lite water is flat: its waves are in the shading, so the height code reads is the rest plane's.
        const h = s.height + (this.quality.displacement ? waveHeight(params, x, z, time) + surf : 0) + (this.ripples_?.heightAt(x, z) ?? 0);
        const [sx, sz] = waveSlope(params, x, z, time);
        const len = Math.hypot(sx, 1, sz);
        return {
            entity: s.key as Entity, bodyId: this.bodyIdOf(s.key as Entity), depth: y - h, normal: [-sx / len, 1 / len, -sz / len], flow: [s.flowX, 0, s.flowZ], surface: [x, h, z], inside: true,
        };
    }

    /**
     * Disturbs the water at the world point (x, y, z): a bump of `strength` world units (negative is a dip) over `radius`, which spreads as a ring and leaves foam.
     * Does nothing where there is no water or where the zone keeps no ripples.
     */
    disturb(x: number, y: number, z: number, radius: number, strength: number): boolean {
        if (!this.ripples_ || !this.field_?.sample(x, z)) return false;
        this.ripples_.disturb(x, z, radius, strength);
        return true;
    }

    /** The height the ripples add to the surface at the world point, where the zone keeps them; 0 elsewhere. */
    rippleAt(x: number, _y: number, z: number): number {
        return this.ripples_?.heightAt(x, z) ?? 0;
    }

    /**
     * The body of water at (x, z) and its surface at rest, or null where there is none: which water a place belongs to, for what a game
     * keeps per body (a fishing spot, a level it raises) and a placement that keeps by the shore.
     */
    bodyAt(x: number, z: number): { entity: Entity; bodyId: string; form: number; level: number } | null {
        const s = this.field_?.sample(x, z);
        const world = this.app_?.world;
        if (!s || !world || s.key < 0) return null;
        const entity = s.key as Entity;
        const body = world.valid(entity) && world.has(entity, WaterBody) ? world.get(entity, WaterBody) as WaterBodyData : null;
        return { entity, bodyId: body?.bodyId || `entity:${entity}`, form: body?.form ?? WaterForm.Ocean, level: s.height };
    }

    /**
     * How far (x, z) is from the water's edge, across the ground: above zero on dry land (how far to the nearest water), below it on the
     * water (how far in from its shore). Past the zone's region it is the open sea's, deep in; null where no water is baked at all.
     */
    shoreAt(x: number, z: number): number | null {
        return this.field_?.query().shoreAt(x, z) ?? null;
    }

    private bodyIdOf(entity: Entity): string {
        const world = this.app_?.world;
        const body = world?.valid(entity) && world.has(entity, WaterBody) ? world.get(entity, WaterBody) as WaterBodyData : null;
        return body?.bodyId || `entity:${entity}`;
    }

    /** The world height of the surface above or below (x, z), or null where there is none. */
    heightAt(x: number, z: number): number | null {
        return this.sample(x, 0, z)?.surface[1] ?? null;
    }

    /** The waves as they stand where the zone says they are `amp` high: the zone's, at that height, raised by the weather as far as the water is open to it. */
    private waves(amp: number, exposure = 1): WaveParams {
        return { ...waveParamsOf(this.zone_), height: amp * grown(exposure), count: this.quality.waves };
    }
}

/** The resource the plugin installs. @experimental */
export const WatersRes = /* @__PURE__ */ defineResource<Waters>(/* @__PURE__ */ new Waters(), 'Waters');

/** The outline of a lake: its own boundary when it has three points or more, else the rectangle of its size. */
function outlineOf(d: WaterBodyData): Point2[] {
    if (d.boundary.length >= 3) return d.boundary.map((p) => ({ x: p.x, y: p.y }));
    const hx = d.sizeX / 2, hz = d.sizeZ / 2;
    return [{ x: -hx, y: -hz }, { x: hx, y: -hz }, { x: hx, y: hz }, { x: -hx, y: hz }];
}

/** × the waves' height the weather asks for now: 1 with no weather, or one that does not drive the wind. */
function weatherWaves(): number {
    const w = currentWeather();
    return w && (currentWeatherDrive() & WeatherDrive.Wind) ? w.waves : 1;
}

/** How far the weather raises the waves of water `exposure` open to the wind: all the way on open sea, little on a sheltered pond. */
/** @internal */
export function grown(exposure: number): number {
    return 1 + (weatherWaves() - 1) * Math.min(Math.max(exposure, 0), 1);
}

/**
 * How open a body is to the wind, 0 to 1: wind waves grow with the water they blow over (their fetch), so the weather raises them fully
 * on the sea and the more on a lake the wider it is, against eight of the zone's wave lengths; a river's fetch is its width.
 */
/** @internal */
export function exposureOf(body: ZoneBody, waveLength: number): number {
    if (body.kind === 'ocean') return 1;
    let fetch: number;
    if (body.kind === 'lake') {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const p of body.outline) {
            const [x, z] = body.toWorld(p.x, p.y);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        fetch = Math.min(maxX - minX, maxZ - minZ);
    } else {
        fetch = body.stations.reduce((n, s) => n + s.half * 2, 0) / Math.max(body.stations.length, 1);
    }
    return Math.min(Math.max(fetch / Math.max(waveLength * 8, 1e-6), 0.1), 1);
}

/** How hard it rains on the water now (the weather's rain level), 0 with none or one that does not drive the rain. */
function weatherRain(): number {
    const w = currentWeather();
    return w && (currentWeatherDrive() & WeatherDrive.Rain) ? w.rain : 0;
}

/** The zone's waves at unit height, scaled by the weather: what is drawn and what the surface answers both read this, times each place's height. */
export function waveParamsOf(zone: Pick<WaterZoneData, 'waveLength' | 'waveSpeed' | 'waveDirection'>): WaveParams {
    return { height: weatherWaves(), length: zone.waveLength, speed: zone.waveSpeed, direction: zone.waveDirection };
}

/**
 * How hard it rains on the water: the weather's rain, which the Water shader rings out as drops on the surface (`u_rain`). Rain is
 * drawn, not simulated: it puts nothing in the ripples a zone keeps, and no foam.
 */
export function rainOnWater(): number {
    return weatherRain();
}

type Quat = { x: number; y: number; z: number; w: number };

/** `v` turned by `q`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

function toLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const inv = { x: -t.worldRotation.x, y: -t.worldRotation.y, z: -t.worldRotation.z, w: t.worldRotation.w };
    const r = rotate(inv, x - t.worldPosition.x, y - t.worldPosition.y, z - t.worldPosition.z);
    return [r[0] / scale, r[1] / scale, r[2] / scale];
}

function fromLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const r = rotate(t.worldRotation, x * scale, y * scale, z * scale);
    return [r[0] + t.worldPosition.x, r[1] + t.worldPosition.y, r[2] + t.worldPosition.z];
}

/** A river's stations in the world: a few to its narrowest width along its curve, each with its height, half its width, its heading and its current. */
export function riverStations(curve: SplineCurve, flowSpeed: number, toWorld: (x: number, y: number, z: number) => [number, number, number],
    turn: (x: number, y: number, z: number) => [number, number, number], scale: number): RiverStation[] {
    let widest = 0, narrowest = Infinity;
    for (let i = 0; i <= 64; i++) {
        const w = curve.width((i / 64) * curve.length);
        widest = Math.max(widest, w);
        narrowest = Math.min(narrowest, w);
    }
    const step = Math.max(narrowest / 3, curve.length / 1024, 1e-3);
    const count = Math.max(2, Math.ceil(curve.length / step) + 1);
    const stations: RiverStation[] = [];
    for (let i = 0; i < count; i++) {
        const s = (i / (count - 1)) * curve.length;
        const [px, py, pz] = curve.position(s);
        const [x, y, z] = toWorld(px, py, pz);
        const tangent = curve.tangent(s);
        const [tx, , tz] = turn(tangent[0], 0, tangent[2]);
        const run = Math.hypot(tx, tz) || 1;
        const width = curve.width(s);
        stations.push({ x, y, z, half: (width / 2) * scale, dx: tx / run, dz: tz / run, speed: flowSpeed * currentShare(width, widest) * 2 * scale });
    }
    return stations;
}

/** A river whose bed is cut into the terrain. */
interface Bed { key: number; stations: readonly RiverStation[]; depth: number }

/** Everything the zone is baked from, as the scene says it now. */
interface Inputs {
    beds: Bed[];
    bodies: ZoneBody[];
    grid: ZoneGrid;
    zone: WaterZoneData;
    /** What, changed, rebakes the field. */
    key: string;
}

/** The surface the plugin draws: its mesh, its material instance and the textures it reads the field and the ripples from. */
interface Surface {
    entity: Entity;
    mesh: number;
    meshKey: string;
    instance: number;
    material: number;
    heights: number;
    field: number;
    exposure: number;
    /** Which bake the textures hold. */
    baked: WaterField | null;
    ripple: number;
    rippleBytes: Uint8Array | null;
    epoch: number;
    pending: boolean;
}

export class WaterPlugin implements Plugin {
    name = 'water';
    /** Nothing to bake, carve or draw without a body or a zone; the frame after the last one goes still runs, and lets go. */
    readonly activeWhen = [WaterBody, WaterZone];

    /** The stock material the surface is an instance of when the zone names none, made once from the Water shader. */
    private stock_ = 0;
    /** The resource this plugin installed. */
    private waters_: Waters = new Waters();
    private key_ = '';
    private surface_: Surface | null = null;
    private epoch_ = 0;
    /** The bake in hand, for the inputs `key` names; the field drawn until it lands is the last one baked. */
    private baking_: { key: string; cancel: () => void } | null = null;
    /** The beds cut into the terrain, by river: what they were cut from, and the ids of their modifiers. */
    private beds_ = new Map<number, { signature: string; ids: string[] }>();

    build(app: App): void {
        const waters = new Waters();
        this.waters_ = waters;
        waters.app_ = app;
        app.insertResource(WatersRes, waters);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            const policy = app.hasResource(Quality) ? app.getResource(Quality) : null;
            waters.quality = waterQualityOf(policy && policy.enabled ? policy.profile : null, isMiniGame());
            // What the water IS (the baked field) needs no renderer: it is baked here whether or not anything is drawn, so a server or a test
            // that never draws can still ask the surface where it is. What is DRAWN waits for the asset layer.
            const inputs = this.gather(app);
            this.carve(app, inputs.beds);
            waters.zone_ = inputs.zone;
            if (inputs.bodies.length === 0) {
                this.baking_?.cancel();
                this.baking_ = null;
                waters.baking = false;
                waters.field_ = null;
                this.key_ = '';
                this.dropRipples();
                this.dropSurface(app);
                return;
            }
            if (inputs.key !== this.key_ && this.baking_?.key !== inputs.key) {
                // A big zone is a second or more of work: it is spread over frames and shown while it runs.
                this.baking_?.cancel();
                const key = inputs.key;
                const job = bakesOf(app).run('Baking the water', WaterField.baking(inputs.grid, inputs.bodies, this.ground(app), inputs.zone.surfLength));
                this.baking_ = { key, cancel: job.cancel };
                waters.baking = true;
                void job.done.then((field) => {
                    if (this.baking_?.key !== key) return;
                    this.baking_ = null;
                    waters.baking = false;
                    this.key_ = key;
                    waters.field_ = field;
                    waters.revision_++;
                }, (e) => { log.error('water', 'baking the water failed', e); });
            }
            if (!waters.field_) return;
            const eye = this.eye(app);
            this.ripple(app, inputs.zone, eye, app.getResource(Time).delta);
            if (!app.hasResource(Assets)) return;
            const surface = this.surface(app, inputs.zone);
            if (surface.instance && surface.entity) this.update(app, surface, inputs.zone, eye ?? this.middle(inputs.grid));
        }, { name: 'WaterSystem' }));
    }

    cleanup(app?: App): void {
        if (app) this.carve(app, []);
        if (!app?.hasResource(WatersRes)) return;
        this.baking_?.cancel();
        this.baking_ = null;
        app.getResource(WatersRes).baking = false;
        this.dropRipples();
        this.dropSurface(app);
        const waters = app.getResource(WatersRes);
        waters.field_ = null;
        this.key_ = '';
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** The world position of the active camera, or null where there is none (the editor's scene view has no entity). */
    private eye(app: App): [number, number, number] | null {
        for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
            const camera = app.world.get(entity, Camera) as CameraData;
            if (!camera.isActive) continue;
            const t = app.world.get(entity, Transform) as TransformData;
            return [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z];
        }
        return null;
    }

    /** The middle of the zone's region: where the surface and the ripples stay without a camera to follow. */
    private middle(grid: ZoneGrid): [number, number, number] {
        return [grid.minX + grid.sizeX / 2, 0, grid.minZ + grid.sizeZ / 2];
    }

    /**
     * The bodies as the zone takes them, in the world, the zone's settings, and the region they are baked over: the `WaterZone`'s, or without
     * one a region round every lake and river with a margin for their shores.
     */
    private gather(app: App): Inputs {
        const bodies: ZoneBody[] = [];
        const beds: Bed[] = [];
        const keyParts: unknown[] = [];
        for (const entity of app.world.getEntitiesWithComponents([WaterBody, Transform])) {
            const d = app.world.get(entity, WaterBody) as WaterBodyData;
            const t = app.world.get(entity, Transform) as TransformData;
            const scale = t.worldScale.y || 1;
            const key = entity as number;
            if (d.form === WaterForm.Ocean) {
                bodies.push({ kind: 'ocean', key, level: t.worldPosition.y, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth });
                keyParts.push([key, d.form, t.worldPosition.y, d.waveHeight, d.shoreWidth]);
            } else if (d.form === WaterForm.Lake) {
                const outline = outlineOf(d);
                bodies.push({
                    kind: 'lake', key, level: t.worldPosition.y, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth * scale, outline,
                    toLocal: (x, z) => { const q = toLocal(t, x, t.worldPosition.y, z, scale); return [q[0], q[2]]; },
                    toWorld: (x, z) => { const w = fromLocal(t, x, 0, z, scale); return [w[0], w[2]]; },
                });
                keyParts.push([key, d.form, outline, d.waveHeight, d.shoreWidth, t.worldPosition, t.worldRotation, scale]);
            } else if (d.form === WaterForm.River) {
                const spline = app.world.tryGet(entity, Spline) as SplineData | null;
                if (!spline || spline.points.length < 2) continue;
                const curve = new SplineCurve(spline.points, spline.closed);
                const stations = riverStations(curve, d.flowSpeed, (x, y, z) => fromLocal(t, x, y, z, scale), (x, y, z) => rotate(t.worldRotation, x, y, z), scale);
                bodies.push({ kind: 'river', key, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth * scale, stations });
                if (d.bedDepth > 0) beds.push({ key, stations, depth: d.bedDepth * scale });
                keyParts.push([key, d.form, spline.points, spline.closed, d.flowSpeed, d.waveHeight, d.shoreWidth, t.worldPosition, t.worldRotation, scale]);
            }
        }
        let zone = ZONE_DEFAULTS;
        let grid: ZoneGrid | null = null;
        for (const entity of app.world.getEntitiesWithComponents([WaterZone, Transform])) {
            zone = app.world.get(entity, WaterZone) as WaterZoneData;
            const t = app.world.get(entity, Transform) as TransformData;
            grid = gridOver(t.worldPosition.x - zone.sizeX / 2, t.worldPosition.z - zone.sizeZ / 2, zone.sizeX, zone.sizeZ, zone.resolution);
            break;
        }
        if (!grid) {
            grid = implicitGrid(bodies, zone);
            // The surface without a zone of its own reaches over the whole region from wherever the camera is in it: its cells grow with the region.
            const reach = oceanReach(zone.cells, zone.rings, zone.cellSize), need = Math.max(grid.sizeX, grid.sizeZ);
            if (reach < need) zone = { ...zone, cellSize: zone.cellSize * (need / reach) };
        }
        for (const b of bodies) b.exposure = exposureOf(b, zone.waveLength);
        const terrain = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const ground = terrain && terrain.built_.size > 0 ? terrain.revision_ : -1;
        return { bodies, beds, grid, zone, key: JSON.stringify([keyParts, grid, ground, zone.surfLength, zone.waveLength]) };
    }

    /**
     * Cuts each river's bed into the terrain, and gives the ground back where a river stops cutting or is gone. A bed is laid again only
     * when the river it is cut from changes: the water baked over the cut ground does not cut it again.
     */
    private carve(app: App, beds: readonly Bed[]): void {
        if (beds.length === 0 && this.beds_.size === 0) return;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const seen = new Set<number>();
        for (const bed of beds) {
            seen.add(bed.key);
            const signature = JSON.stringify([bed.depth, bed.stations]);
            const had = this.beds_.get(bed.key);
            if (had?.signature === signature || !terrains) continue;
            for (const id of had?.ids ?? []) terrains.deleteModifier(id);
            const modifiers = riverBedModifiers(`river-bed:${bed.key}:`, bed.stations, bed.depth);
            for (const m of modifiers) terrains.setModifier(m);
            this.beds_.set(bed.key, { signature, ids: modifiers.map((m) => m.id) });
        }
        for (const [key, had] of this.beds_) {
            if (seen.has(key)) continue;
            if (terrains) for (const id of had.ids) terrains.deleteModifier(id);
            this.beds_.delete(key);
        }
    }

    /** The world height of the ground, where a terrain is built. */
    private ground(app: App): ZoneGround | undefined {
        if (!app.hasResource(TerrainsRes)) return undefined;
        const terrains = app.getResource(TerrainsRes);
        if (terrains.built_.size === 0) return undefined;
        return (x, z) => terrains.heightAt(x, z);
    }

    /** The material the surface is an instance of when the zone names none: the Water shader, compiled once. */
    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const assets = app.getResource(Assets);
        const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:water');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:water', blendMode: BlendMode.Normal,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, shader);
        return this.stock_;
    }

    /** The surface, made (or remade, where its mesh or its material changed) as the zone asks. */
    private surface(app: App, zone: WaterZoneData): Surface {
        const meshKey = JSON.stringify([zone.cells, zone.rings, zone.cellSize]);
        let s = this.surface_;
        if (s && (s.meshKey !== meshKey || s.material !== zone.material)) { this.dropSurface(app); s = null; }
        if (!s) {
            s = { entity: 0 as Entity, mesh: 0, meshKey, instance: 0, material: zone.material, heights: 0, field: 0, exposure: 0, baked: null, ripple: 0, rippleBytes: null, epoch: ++this.epoch_, pending: false };
            this.surface_ = s;
        }
        if (!s.entity && !s.pending) void this.build_(app, s, zone);
        return s;
    }

    private async build_(app: App, s: Surface, zone: WaterZoneData): Promise<void> {
        s.pending = true;
        const epoch = s.epoch;
        try {
            const source = zone.material || await this.stock(app);
            if (s.epoch !== epoch || this.surface_ !== s) return;
            const assets = app.getResource(Assets);
            const mesh = assets.createMesh(buildOceanMesh(zone.cells, zone.rings, zone.cellSize));
            if (mesh === 0) { log.warn('water', 'the engine refused the water geometry'); return; }
            const instance = Material.createInstance(source);
            if (instance === 0) { assets.releaseBuiltMesh(mesh); log.warn('water', 'the water material could not be instanced'); return; }
            s.mesh = mesh;
            s.instance = instance;
            this.waters_.instance_ = instance;
            const entity = app.world.spawn('Water');
            app.world.insert(entity, Transform, { position: { x: 0, y: 0, z: 0 } });
            app.world.insert(entity, MeshRenderer, {
                // Light goes through water: the sun lights what is under it, through the caustics, and no shadow of the surface.
                mesh, material: instance, lit: true, opaque: false, cullBackfaces: false, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
            s.entity = entity;
        } catch (e) {
            log.error('water', 'building the water failed', e);
        } finally {
            s.pending = false;
        }
    }

    /** Puts the baked field where the shader reads it: the heights texel by texel, the rest filtered. */
    private upload(app: App, s: Surface, field: WaterField): void {
        this.dropFieldTextures(s);
        const ranges = field.ranges(this.waters_.zone_.surfLength * 4);
        const { heights, field: rest, exposure } = field.encode(ranges);
        const { nx, nz, minX, minZ, sizeX, sizeZ } = field.grid;
        const empty = nx < 2 || nz < 2;
        const w = empty ? 2 : nx, h = empty ? 2 : nz;
        s.heights = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16) : heights }, TextureContent.Retained, false,
            { filterMode: 'nearest', wrapMode: 'clamp', srgb: false });
        s.field = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16) : rest }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        s.exposure = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16).fill(255) : exposure }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        s.baked = field;
        const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(s.instance, name, value); };
        set('u_zoneHeights', Material.tex(s.heights));
        set('u_zoneField', Material.tex(s.field));
        set('u_zoneExposure', Material.tex(s.exposure));
        // A region of nothing is put where no point is: everything is past it, which is the ocean.
        set('u_zoneOrigin', empty ? { x: 1e9, y: 1e9 } : { x: minX, y: minZ });
        set('u_zoneSize', empty ? { x: 1e-4, y: 1e-4 } : { x: sizeX, y: sizeZ });
        set('u_zoneHeight', { x: ranges.heightMin, y: ranges.heightSpan });
        set('u_zoneRange', { x: ranges.shore, y: ranges.amp, z: ranges.flow, w: ranges.depth });
        set('u_zoneOn', 1);
    }

    /** Writes the zone into the instance, and moves the surface to the camera on the lattice its rings line up on. */
    private update(app: App, s: Surface, zone: WaterZoneData, eye: [number, number, number]): void {
        const field = this.waters_.field_!;
        if (s.baked !== field) this.upload(app, s, field);
        const snap = oceanSnap(zone.rings, zone.cellSize);
        const ox = Math.round(eye[0] / snap) * snap, oz = Math.round(eye[2] / snap) * snap;
        const t = app.world.get(s.entity, Transform) as TransformData;
        if (t.position.x !== ox || t.position.z !== oz) app.world.insert(s.entity, Transform, { ...t, position: { x: ox, y: 0, z: oz } });
        const set = (name: string, value: number | { x: number; y: number }): void => { Material.setUniform(s.instance, name, value); };
        const q = this.waters_.quality;
        const ocean = field.ocean;
        const waves = waveParamsOf(zone);
        set('u_waveCount', q.waves);
        set('u_mirror', q.mirror ? 1 : 0);
        set('u_causticOn', q.caustics ? 1 : 0);
        set('u_waveSpace', 1);
        set('u_origin', { x: ox, y: oz });
        set('u_cellSize', zone.cellSize);
        set('u_geoWaves', q.displacement ? 1 : 0);
        set('u_waveHeight', waves.height);
        set('u_rain', rainOnWater());
        set('u_waveLength', waves.length);
        set('u_waveSpeed', waves.speed);
        set('u_waveDirection', waves.direction);
        set('u_oceanOn', ocean ? 1 : 0);
        set('u_oceanLevel', ocean ? ocean.level : 0);
        set('u_oceanWaves', ocean ? ocean.waveHeight : 0);
        set('u_surfHeight', zone.surf);
        set('u_surfLength', zone.surfLength);
        set('u_surfSpeed', zone.waveSpeed);
    }

    /**
     * Keeps the zone's ripples: makes the grid when `ripples` asks for one, moves its window to the camera, steps it, and (where drawn) puts it where the shader reads it.
     * It runs headless too, so the surface a test or a server asks about has them.
     */
    private ripple(app: App, zone: WaterZoneData, eye: [number, number, number] | null, dt: number): void {
        const waters = this.waters_;
        if (zone.ripples <= 0 || waters.quality.rippleCells <= 0) { this.dropRipples(); return; }
        // The level holds the grid to its own side; a zone that asks for more gets the level's.
        const n = Math.max(8, Math.floor(Math.min(zone.ripples, waters.quality.rippleCells))), size = Math.max(zone.rippleSize, 1e-3);
        if (!waters.ripples_ || waters.ripples_.n !== n || waters.ripples_.size !== size) {
            this.dropRipples();
            waters.ripples_ = new RippleField(n, size);
            const grid = waters.field_!.grid;
            waters.ripples_.recenter(grid.minX + grid.sizeX / 2, grid.minZ + grid.sizeZ / 2);
        }
        const field = waters.ripples_;
        if (eye) field.recenter(eye[0], eye[2]);
        const step = Math.min(Math.max(dt, 0), 0.1);
        field.step(step, zone.rippleSpeed, zone.rippleDamping, zone.foamFade);
        const s = this.surface_;
        if (!s || !s.instance || !app.hasResource(Assets)) return;
        // The height the grid holds and its encoding spans either side of rest: twice the tallest waves, or a fiftieth of the window where the water is calm.
        const range = Math.max((waters.field_ ? waters.field_.ranges().amp : 0) * weatherWaves() * 2, zone.rippleSize * 0.02);
        field.limit = range;
        const bytes = field.encode(range, s.rippleBytes ?? undefined);
        s.rippleBytes = bytes;
        if (!s.ripple) {
            s.ripple = createTextureFromPixels(app.wasmModule, { width: n, height: n, pixels: bytes }, TextureContent.Retained, false,
                { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
            const handle = s.ripple;
            provideTextureContent(handle, () => {
                if (s.ripple !== handle || !s.rippleBytes) return false;
                updateTextureSubregion(app.wasmModule, handle, 0, 0, n, n, s.rippleBytes);
                return true;
            });
            Material.setUniform(s.instance, 'u_rippleMap', Material.tex(handle));
        } else {
            updateTextureSubregion(app.wasmModule, s.ripple, 0, 0, n, n, bytes);
        }
        const set = (name: string, value: number | { x: number; y: number }): void => { Material.setUniform(s.instance, name, value); };
        set('u_rippleOn', 1);
        set('u_rippleOrigin', { x: field.originX, y: field.originZ });
        set('u_rippleSize', field.size);
        set('u_rippleTexel', 1 / n);
        set('u_rippleRange', range);
    }

    private dropRipples(): void {
        const s = this.surface_;
        if (s?.ripple) {
            withdrawTextureContent(s.ripple);
            getResourceManager()?.releaseTexture(s.ripple);
        }
        if (s) {
            s.ripple = 0;
            s.rippleBytes = null;
            if (s.instance) Material.setUniform(s.instance, 'u_rippleOn', 0);
        }
        this.waters_.ripples_ = null;
    }

    private dropFieldTextures(s: Surface): void {
        const rm = getResourceManager();
        if (s.heights) rm?.releaseTexture(s.heights);
        if (s.field) rm?.releaseTexture(s.field);
        if (s.exposure) rm?.releaseTexture(s.exposure);
        s.heights = 0;
        s.field = 0;
        s.exposure = 0;
        s.baked = null;
    }

    private dropSurface(app: App): void {
        const s = this.surface_;
        if (!s) return;
        s.epoch = ++this.epoch_;
        this.surface_ = null;
        if (s.entity && app.world.valid(s.entity)) app.world.despawn(s.entity);
        if (s.ripple) { withdrawTextureContent(s.ripple); getResourceManager()?.releaseTexture(s.ripple); }
        this.waters_.ripples_ = null;
        this.dropFieldTextures(s);
        if (s.instance) Material.release(s.instance);
        if (s.mesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(s.mesh);
        this.waters_.instance_ = 0;
    }
}

/** A region from (minX, minZ), `sizeX` by `sizeZ`, with `resolution` texels along its longer side. */
function gridOver(minX: number, minZ: number, sizeX: number, sizeZ: number, resolution: number): ZoneGrid {
    const longer = Math.max(sizeX, sizeZ, 1e-3);
    const res = Math.max(2, Math.round(resolution));
    return { minX, minZ, sizeX, sizeZ, nx: Math.max(2, Math.round((res * sizeX) / longer)), nz: Math.max(2, Math.round((res * sizeZ) / longer)) };
}

/**
 * The region a scene without a `WaterZone` is baked over: round every lake and river, with a margin of their shores and a few texels, at half
 * the surface's finest cell to a texel (no finer than 32 texels along its longer side, no coarser than 1024). None, when there is only an ocean.
 */
function implicitGrid(bodies: readonly ZoneBody[], zone: WaterZoneData): ZoneGrid {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, margin = 0;
    for (const b of bodies) {
        if (b.kind === 'ocean') continue;
        margin = Math.max(margin, b.shoreWidth);
        if (b.kind === 'river') {
            for (const s of b.stations) {
                minX = Math.min(minX, s.x - s.half); maxX = Math.max(maxX, s.x + s.half);
                minZ = Math.min(minZ, s.z - s.half); maxZ = Math.max(maxZ, s.z + s.half);
            }
        } else {
            for (const p of b.outline) {
                const [x, z] = b.toWorld(p.x, p.y);
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
            }
        }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, sizeX: 0, sizeZ: 0, nx: 0, nz: 0 };
    const longer = Math.max(maxX - minX, maxZ - minZ);
    const res = Math.min(1024, Math.max(32, Math.ceil(longer / Math.max(zone.cellSize * 0.5, 1e-3))));
    const pad = margin + (longer / res) * 4;
    return gridOver(minX - pad, minZ - pad, maxX - minX + pad * 2, maxZ - minZ + pad * 2, res);
}

export const waterPlugin: Plugin = /* @__PURE__ */ new WaterPlugin();
