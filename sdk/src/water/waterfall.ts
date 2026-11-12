// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterfall.ts
 * @brief   Water falling from a lip: sheets thrown out at a speed and pulled down by gravity until they meet the ground or water.
 *
 * @details A river's surface is a field over the ground and cannot stand on end, so where a river comes to a cliff it stops. A `Waterfall`
 *          is what goes on from there: put the entity at the lip, facing the way the water leaves it (its forward), and the sheets are the
 *          path a thing thrown level at `speed` takes (only the entity's turn about the vertical aims it: keep it upright and unscaled), built as the entity's own MeshRenderer so a material on it can be anything. With no
 *          material it takes the stock Waterfall shader (waterfallShader.ts). Each sheet ends where it meets the ground, or water that is
 *          not the water it left, or `maxDrop` under the lip, whichever is first; it is made again when its fields, the entity's place or the ground change. The
 *          terrain and the water are asked by name: with neither, a fall is `maxDrop` high.
 *
 *          What a vertex carries for a material: uv.x across the sheet (0 to 1), uv.y the seconds the water there has been falling, colour
 *          red the share of the fall done (0 at the lip, 1 at the foot), green a number of the sheet's own (so sheets do not move as one),
 *          and alpha 0 at the sheet's two edges.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, MeshRenderer, Transform, type ComponentDef, type MeshRendererData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';

/** The fields of the `Waterfall` component. @experimental */
export interface WaterfallData {
    /** How wide the water is where it leaves the lip, in world units. */
    width: number;
    /** How fast it leaves the lip, level and along the entity's forward, in world units a second. Faster throws it further out. */
    speed: number;
    /** How much wider a sheet is at its foot than at the lip, as a share of its width: 1 is twice as wide. */
    flare: number;
    /** How many sheets, 1 to 5, one behind another along the throw: the middle one whole, the others narrower. */
    sheets: number;
    /** How far apart the sheets leave the lip, in world units. */
    sheetGap: number;
    /** How far under the lip a fall that meets nothing ends, in world units. */
    maxDrop: number;
    /** Rows down a sheet and cells across it. */
    rows: number;
    across: number;
}

/**
 * Falling water from the entity's place along its forward, drawn as the entity's MeshRenderer.
 *
 * @experimental
 */
export const Waterfall: ComponentDef<WaterfallData> = /* @__PURE__ */ defineComponent<WaterfallData>('Waterfall', {
    // Lengths at the engine's reference of 100 units a metre (ecs/worldUnits.ts): eight metres of water leaving at five metres a second.
    width: 800, speed: 500, flare: 1.1, sheets: 3, sheetGap: 90, maxDrop: 30000, rows: 56, across: 6,
}, {
    worldUnitFields: ['width', 'speed', 'sheetGap', 'maxDrop'],
    fields: {
        width: { min: 0.01, unit: 'wu', tooltip: 'How wide the water is where it leaves the lip.' },
        speed: { min: 0, unit: 'wu/s', tooltip: 'How fast it leaves the lip, level and along the entity\'s forward. Faster throws it further out.' },
        flare: { min: 0, max: 4, step: 0.01, tooltip: 'How much wider a sheet is at its foot than at the lip, as a share of its width.' },
        sheets: { min: 1, max: 5, step: 1, tooltip: 'How many sheets, one behind another along the throw.' },
        sheetGap: { min: 0, unit: 'wu', tooltip: 'How far apart the sheets leave the lip.' },
        maxDrop: { min: 0.01, unit: 'wu', tooltip: 'How far under the lip a fall that meets nothing ends.' },
        rows: { min: 2, max: 256, step: 1, tooltip: 'Rows down a sheet. More follows the curve more closely.' },
        across: { min: 1, max: 32, step: 1, tooltip: 'Cells across a sheet.' },
    },
});

/**
 * What a fall lands on: the ground's height at a place, and the water there (which body's it is, and how far `y` is above its surface,
 * negative under it), null where there is none. Either may be absent.
 */
export interface WaterfallLanding {
    heightAt?(x: number, z: number): number | null;
    waterAt?(x: number, z: number, y: number): { body: number; above: number } | null;
}

/** The lip in the world: where it is and the level direction the water leaves along (unit, on xz). */
export interface WaterfallLip { x: number; y: number; z: number; dirX: number; dirZ: number }

/** Gravity, in metres a second squared. */
const GRAVITY = 9.8;
/** How far a sheet has to have dropped, in metres, before what it meets ends it: at the lip it is still in the water it left. */
const CLEAR = 0.5;
/** The share of the middle sheet's width the others have. */
const OUTER = 0.72;
/** How far the middle of a sheet bows out past its edges at the foot, as a share of the sheet's own half width there. */
const BOW = 0.14;

/** The seconds a sheet thrown from `lip`, `ahead` along the throw, falls before it lands, and the drop that is. */
export function waterfallFlight(fall: WaterfallData, lip: WaterfallLip, landing: WaterfallLanding | null, ahead = 0): { seconds: number; drop: number } {
    const g = GRAVITY * worldUnitsPerMeter();
    const most = Math.sqrt((2 * Math.max(fall.maxDrop, 1e-3)) / g);
    const clear = CLEAR * worldUnitsPerMeter();
    const steps = 512;
    // The water it leaves reaches a little past the lip (a river ends in a round of its own width): what it lands in is another body's.
    const left = landing?.waterAt?.(lip.x, lip.z, lip.y)?.body ?? null;
    for (let i = 1; i <= steps; i++) {
        const t = (most * i) / steps, drop = 0.5 * g * t * t;
        if (drop < clear) continue;
        const x = lip.x + lip.dirX * (fall.speed * t + ahead), z = lip.z + lip.dirZ * (fall.speed * t + ahead), y = lip.y - drop;
        const ground = landing?.heightAt?.(x, z) ?? null;
        const water = landing?.waterAt?.(x, z, y) ?? null;
        if ((ground !== null && y <= ground) || (water !== null && water.above <= 0 && water.body !== left)) return { seconds: t, drop };
    }
    return { seconds: most, drop: fall.maxDrop };
}

/**
 * The sheets' geometry in the entity's own space, where the throw is along -z: the entity's turn about the vertical is what aims it in the
 * world, and `lip` says where that is for what the sheets land on. Null where there is nothing to draw. Rows are closer together near the
 * lip, where the path turns the most.
 */
export function buildWaterfall(fall: WaterfallData, lip: WaterfallLip, landing: WaterfallLanding | null): MeshData | null {
    if (!(fall.width > 0) || !(fall.maxDrop > 0)) return null;
    const g = GRAVITY * worldUnitsPerMeter();
    const sheets = Math.max(1, Math.min(5, Math.floor(fall.sheets)));
    const rows = Math.max(2, Math.min(256, Math.floor(fall.rows)));
    const cells = Math.max(1, Math.min(32, Math.floor(fall.across)));
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const perSheet = (rows + 1) * (cells + 1);
    const vertexCount = sheets * perSheet;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const at = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const posAt = at(MeshChannel.Position), uvAt = at(MeshChannel.TexCoord0), colorAt = at(MeshChannel.Color), normalAt = at(MeshChannel.Normal);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const indices = new Uint32Array(sheets * rows * cells * 6);
    let vertex = 0, index = 0;
    for (let s = 0; s < sheets; s++) {
        const middle = (sheets - 1) / 2;
        const ahead = (s - middle) * fall.sheetGap;
        const half = fall.width * 0.5 * (s === Math.round(middle) ? 1 : OUTER);
        const { seconds } = waterfallFlight(fall, lip, landing, ahead);
        const first = vertex;
        for (let r = 0; r <= rows; r++) {
            const t = Math.pow(r / rows, 0.8) * seconds, k = seconds > 0 ? t / seconds : 0;
            const out = fall.speed * t + ahead, down = 0.5 * g * t * t;
            const wide = half * (1 + fall.flare * k);
            // The path's own normal: level at the lip (the sheet lies flat as it leaves), turning to face along the throw as it steepens.
            const vy = g * t, vl = Math.hypot(fall.speed, vy) || 1;
            const n = [0, fall.speed / vl, -vy / vl] as const;
            for (let c = 0; c <= cells; c++, vertex++) {
                const u = c / cells, side = u * 2 - 1;
                const bow = (1 - side * side) * BOW * wide * k;
                const p = [side * wide, -down, -(out + bow)] as const;
                const base = vertex * vertexStride;
                for (let i = 0; i < 3; i++) {
                    view.setFloat32(base + posAt + i * 4, p[i]!, true);
                    view.setFloat32(base + normalAt + i * 4, n[i]!, true);
                    if (p[i]! < min[i]!) min[i] = p[i]!;
                    if (p[i]! > max[i]!) max[i] = p[i]!;
                }
                view.setFloat32(base + uvAt, u, true);
                view.setFloat32(base + uvAt + 4, t, true);
                view.setUint8(base + colorAt, Math.round(k * 255));
                view.setUint8(base + colorAt + 1, Math.round(((s * 0.381966) % 1) * 255));
                view.setUint8(base + colorAt + 2, 255);
                view.setUint8(base + colorAt + 3, c === 0 || c === cells ? 0 : 255);
            }
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cells; c++) {
                const a = first + r * (cells + 1) + c, b = a + 1, d = a + cells + 1, e = d + 1;
                indices[index++] = a; indices[index++] = b; indices[index++] = d;
                indices[index++] = b; indices[index++] = e; indices[index++] = d;
            }
        }
    }
    return { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max };
}

/** The level direction an entity turned by `q` faces along (its forward, -z, laid on the ground), or -z where it faces straight up or down. */
export function waterfallHeading(q: { x: number; y: number; z: number; w: number }): [number, number] {
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const len = Math.hypot(fx, fz);
    return len > 1e-6 ? [fx / len, fz / len] : [0, -1];
}

interface Asked { heightAt?: unknown; sample?: unknown; revision_?: number; loading?: boolean; baking?: boolean; built_?: Map<unknown, unknown>; empty?: boolean }

/** What there is to land on, whichever modules are here, and how to tell when it has changed or is still being made. */
function landingOf(app: App): { query: WaterfallLanding; revision: string; waiting: boolean } {
    const terrains = app.getResourceByName?.('Terrains') as Asked | undefined;
    const waters = app.getResourceByName?.('Waters') as Asked | undefined;
    const ground = terrains && typeof terrains.heightAt === 'function' && terrains.built_?.size ? terrains : null;
    const water = waters && typeof waters.sample === 'function' && !waters.empty ? waters : null;
    return {
        query: {
            heightAt: ground ? (x, z) => (ground.heightAt as (x: number, z: number) => number | null)(x, z) : undefined,
            waterAt: water ? (x, z, y) => {
                const at = (water.sample as (x: number, y: number, z: number) => { entity: number; depth: number } | null)(x, y, z);
                return at ? { body: at.entity, above: at.depth } : null;
            } : undefined,
        },
        revision: `${ground?.revision_ ?? -1}:${water?.revision_ ?? -1}`,
        waiting: !!terrains?.loading || !!waters?.baking,
    };
}

/** Keeps every `Waterfall` falling to what is under it. Called once by the water plugin. */
export function installWaterfalls(app: App): void {
    const built = new Map<Entity, { key: string; handle: number }>();
    let stock = 0, asked = false;
    const letGo = (entity: Entity): void => {
        const held = built.get(entity);
        built.delete(entity);
        if (held?.handle && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(held.handle);
    };
    app.world.onDespawn(letGo);
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const world = app.world;
        if (!app.hasResource(Assets)) return;
        const assets = app.getResource(Assets);
        for (const entity of [...built.keys()]) if (!world.valid(entity) || !world.has(entity, Waterfall)) letGo(entity);
        const falls = world.getEntitiesWithComponents([Waterfall, Transform]);
        if (falls.length === 0) return;
        if (!stock && !asked) {
            asked = true;
            void assets.load<MaterialShaderSource>('material-shader', 'builtin:waterfall').then((source) => {
                stock = Material.createFromAsset({
                    version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:waterfall', blendMode: BlendMode.Normal,
                    depthTest: true, depthWrite: false, cull: 0, properties: {},
                }, source.compile([]));
            });
        }
        const landing = landingOf(app);
        // Thrown over a ground or a water still being made, it would fall through and be thrown again a moment later.
        if (landing.waiting) return;
        for (const entity of falls) {
            const fall = world.get(entity, Waterfall) as WaterfallData;
            const t = world.get(entity, Transform) as TransformData;
            const renderer = world.has(entity, MeshRenderer) ? world.get(entity, MeshRenderer) as MeshRendererData : null;
            const own = !!renderer?.material && renderer.material !== stock;
            if (!own && !stock) continue;
            const [dirX, dirZ] = waterfallHeading(t.worldRotation);
            const lip = { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z, dirX, dirZ };
            const key = JSON.stringify([fall, lip, landing.revision, worldUnitsPerMeter(), own ? renderer!.material : stock]);
            const held = built.get(entity);
            if (held?.key === key) continue;
            const mesh = buildWaterfall(fall, lip, landing.query);
            const handle = mesh ? assets.createMesh(mesh) : 0;
            if (held?.handle) assets.releaseBuiltMesh(held.handle);
            built.set(entity, { key, handle });
            world.insert(entity, MeshRenderer, {
                ...renderer, enabled: true, mesh: handle, material: own ? renderer!.material : stock, opaque: false, castShadows: false, cullBackfaces: false,
            } as Partial<MeshRendererData>);
        }
    }, { name: 'WaterfallSystem' }));
}
