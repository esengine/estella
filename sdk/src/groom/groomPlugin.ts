// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomPlugin.ts — the `Groom` component: hair or fur as strands, drawn from a `.esgroom`.
 *
 *        Each group of the groom is a child entity of its own, made here and never saved: a MeshRenderer of the group's strands with an
 *        instance of its material, to which the group's settings are written (width, root and tip scale, shadow density, the narrowest it
 *        is drawn). Editing the groom file, or the curves it names, remakes them.
 */
import type { App, Plugin } from '../app/app';
import type { Entity } from '../types';
import { Camera, defineComponent, MeshRenderer, RuntimeOnly, Transform, type CameraData, type ComponentDef, type MeshRendererData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import { Assets } from '../asset/AssetPlugin';
import type { Assets as AssetsApi } from '../asset/Assets';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';
import { holdShaderWarmup } from '../render/shaderWarmup';
import { log } from '../util/logger';
import { decodeCurves, parseGroomDocument, settingsForGroups, type GroomCurves, type GroomDocument, type GroomGroupSettings } from './groomFormat';
import { CameraCommit } from '../camera/CameraCommit';
import type { AssetLease } from '../asset/AssetLease';
import { buildStrandMesh } from './groomMesh';
import { growGroom } from './groomGrow';

/** The fields of the `Groom` component. @experimental */
export interface GroomData {
    /** The `.esgroom` to draw. */
    groom: string;
}

/**
 * Hair or fur as strands: the groups of a `.esgroom`, drawn where the entity is.
 *
 * @experimental
 */
export const Groom: ComponentDef<GroomData> = /* @__PURE__ */ defineComponent<GroomData>('Groom', { groom: '' }, {
    assetFields: [{ field: 'groom', type: 'groom' }],
    fields: {
        groom: { tooltip: 'The .esgroom to draw: its curves, in groups, each with its own material and width.' },
    },
});

/** How much light a world unit of strands takes at a Hair Shadow Density of 1. */
export const GROOM_SHADOW_PER_UNIT = 1;

/** The uniforms a group's settings put on its material instance, in world units where they are lengths. */
export function groupUniforms(settings: GroomGroupSettings, maxRadius: number, unitsPerMeter: number): Record<string, number> {
    return {
        u_hairWidth: settings.overrideWidth ? settings.hairWidth * unitsPerMeter / 100 : 0,
        u_maxRadius: maxRadius,
        u_rootScale: settings.hairRootScale,
        u_tipScale: settings.hairTipScale,
        u_strandMinPx: settings.stableRasterization ? 1 : 0,
        // Per world unit: a centimetre of fur at the engine's reference scale takes the same at any scale.
        u_hairShadow: settings.hairShadowDensity * GROOM_SHADOW_PER_UNIT * 100 / unitsPerMeter,
    };
}

/** Where a path named inside `from` points: relative to its folder, unless it is already from the project's root. */
export function besideFile(from: string, path: string): string {
    if (path.startsWith('/') || path.startsWith('assets/') || path.startsWith('@uuid:') || /^[a-z]+:/i.test(path)) return path;
    // A groom a scene named by uuid arrives as a URL (estella://project/...): its origin is kept whole, not
    // folded into the path, where `//` would collapse and the curves resolve under the page again.
    const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(from)?.[0] ?? '';
    const rest = from.slice(origin.length);
    const lead = origin ? `${origin}/` : rest.startsWith('/') ? '/' : '';
    const dir = rest.includes('/') ? rest.slice(0, rest.lastIndexOf('/') + 1) : '';
    const parts: string[] = [];
    for (const part of (dir + path).split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.' && part !== '') parts.push(part);
    }
    return lead + parts.join('/');
}

/**
 * The curves a groom draws: grown from its `grow` parameters where it has them, read from its curves file (beside `path`) where not.
 * @experimental
 */
export async function loadGroomCurves(doc: GroomDocument, path: string, fetchBinary: (path: string) => Promise<ArrayBuffer | Uint8Array>): Promise<GroomCurves> {
    if (doc.grow) return growGroom(doc.grow);
    return decodeCurves(await fetchBinary(besideFile(path, doc.curves)));
}

interface Built {
    key: string;
    children: Entity[];
    meshes: number[];
    materials: number[];
    /** The cards drawn in place of the strands when small, and what they are held by. */
    cards: { entity: Entity; screenSize: number; leases: AssetLease[] } | null;
    /** The strands' bounding sphere in the groom's own space, in world units. */
    centre: [number, number, number];
    radius: number;
    /** Which is drawn now. */
    showing: 'strands' | 'cards';
}

/** How far past `screenSize` either way a groom must go before it switches, so one standing at the line does not flicker. */
export const GROOM_LOD_HYSTERESIS = 0.1;

/** The bounding sphere of every point of the curves, in metres. */
function boundsOf(curves: GroomCurves): { centre: [number, number, number]; radius: number } {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of curves.groups) {
        const p = g.strands.positions;
        for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]!; if (v < min[k]!) min[k] = v; if (v > max[k]!) max[k] = v; }
    }
    if (!(min[0]! <= max[0]!)) return { centre: [0, 0, 0], radius: 0 };
    const centre: [number, number, number] = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
    return { centre, radius: Math.hypot(max[0]! - centre[0], max[1]! - centre[1], max[2]! - centre[2]) };
}

/**
 * How much of the view's height a sphere covers, through a view-projection (column-major): its radius over its depth, scaled
 * by how the projection stretches the height. An orthographic view has no depth to divide by.
 */
export function screenSizeOf(viewProjection: ArrayLike<number>, centre: readonly number[], radius: number): number {
    const m = viewProjection;
    const w = m[3]! * centre[0]! + m[7]! * centre[1]! + m[11]! * centre[2]! + m[15]!;
    const stretch = Math.hypot(m[1]!, m[5]!, m[9]!);
    return w > 1e-6 ? (radius * stretch) / w : Infinity;
}

/** Every `Groom`'s groups, kept as their files say. */
export class GroomRes {
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ readonly loading_ = new Set<Entity>();
    /** @internal What could not be drawn: the key it was tried at, and why. */ readonly failed_ = new Map<Entity, { key: string; why: string }>();
    /** @internal Bumped when a groom or curves file changes on disk. */ revision_ = 0;
    /** @internal */ stock_ = 0;
    /** @internal */ stockAsked_ = false;

    /** Why an entity's groom could not be drawn, or null. */
    failure(entity: Entity): string | null { return this.failed_.get(entity)?.why ?? null; }
    /** The entities drawing each group of an entity's groom, in group order. */
    groups(entity: Entity): readonly Entity[] { return this.built_.get(entity)?.children ?? []; }
    /** What an entity's groom is drawn as now: its strands, or its cards (where its `.esgroom` has cards and it is small in the view). */
    drawnAs(entity: Entity): 'strands' | 'cards' | null { return this.built_.get(entity)?.showing ?? null; }
    /** The entity drawing an entity's cards, where its groom has them. */
    cards(entity: Entity): Entity | null { return this.built_.get(entity)?.cards?.entity ?? null; }
}

/**
 * A material of the stock Strands shader, which a group with no material of its own draws an instance of. The caller owns it
 * (`Material.release`). An editor previewing a groom makes its own, as the Groom component does.
 * @experimental
 */
export async function createStrandsMaterial(assets: AssetsApi): Promise<number> {
    const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:strands');
    return Material.createFromAsset({
        version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:strands', blendMode: BlendMode.Normal,
        depthTest: true, depthWrite: true, cull: 0, properties: {},
    }, source.compile([]));
}

async function stockMaterial(assets: AssetsApi, res: GroomRes): Promise<number> {
    if (res.stock_) return res.stock_;
    const made = await createStrandsMaterial(assets);
    if (res.stock_) { Material.release(made); return res.stock_; }
    res.stock_ = made;
    return made;
}

function letGo(app: App, res: GroomRes, entity: Entity): void {
    const held = res.built_.get(entity);
    res.built_.delete(entity);
    if (!held) return;
    for (const child of held.children) if (app.world.valid(child)) app.world.despawn(child);
    if (held.cards) {
        if (app.world.valid(held.cards.entity)) app.world.despawn(held.cards.entity);
        for (const lease of held.cards.leases) lease.release();
    }
    const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
    for (const mesh of held.meshes) assets?.releaseBuiltMesh(mesh);
    for (const material of held.materials) Material.release(material);
}

async function build(app: App, res: GroomRes, entity: Entity, path: string, key: string): Promise<void> {
    const assets = app.getResource(Assets);
    const doc = parseGroomDocument(await assets.fetchText(path));
    const curves = await loadGroomCurves(doc, path, (p) => assets.fetchBinary(p));
    const settings = settingsForGroups(doc, curves.groups.length);
    const stock = await stockMaterial(assets, res);
    // The cards, where it has them: a mesh and a material of the project, held for as long as the groom is.
    const leases: AssetLease[] = [];
    let cardsMesh = 0, cardsMaterial = 0;
    if (doc.cards) {
        try {
            const m = await assets.acquireTyped<{ handle: number }>('mesh', besideFile(path, doc.cards.mesh));
            leases.push(m);
            const mat = await assets.acquireTyped<{ handle: number }>('material', besideFile(path, doc.cards.material));
            leases.push(mat);
            cardsMesh = m.value.handle; cardsMaterial = mat.value.handle;
        } catch (e) {
            log.warn('groom', `${path}: its cards (${doc.cards.mesh}, ${doc.cards.material}) cannot be loaded, so it draws as strands at every distance`, e);
        }
    }
    // The component may have gone, or changed to another groom, while the files were read.
    const world = app.world;
    if (!world.valid(entity) || !world.has(entity, Groom) || (world.get(entity, Groom) as GroomData).groom !== path) {
        for (const lease of leases) lease.release();
        return;
    }
    letGo(app, res, entity);
    const scale = worldUnitsPerMeter();
    const bounds = boundsOf(curves);
    const held: Built = {
        key, children: [], meshes: [], materials: [], cards: null, showing: 'strands',
        centre: [bounds.centre[0] * scale, bounds.centre[1] * scale, bounds.centre[2] * scale], radius: bounds.radius * scale,
    };
    res.built_.set(entity, held);
    for (let g = 0; g < curves.groups.length; g++) {
        const group = curves.groups[g]!;
        const s = settings[g]!;
        const strands = buildStrandMesh(group.strands, scale, s.overrideWidth ? s.hairWidth * scale / 200 * Math.max(s.hairRootScale, s.hairTipScale) : 0);
        if (!strands) continue;
        const mesh = assets.createMesh(strands.mesh);
        if (mesh === 0) { log.warn('groom', `the engine refused the strands of group ${g} (${group.name}) of ${path}`); continue; }
        held.meshes.push(mesh);
        let source = stock;
        if (s.material) {
            try { source = (await assets.loadMaterial(besideFile(path, s.material))).handle || stock; } catch (e) { log.warn('groom', `group ${g} of ${path}: its material ${s.material} cannot be loaded, so it draws with the stock one`, e); }
        }
        const material = Material.createInstance(source);
        if (material === 0) continue;
        held.materials.push(material);
        for (const [name, value] of Object.entries(groupUniforms(s, strands.maxRadius, scale))) Material.setUniform(material, name, value);
        // Curves that carry their own colours are that colour: the stock material's root and tip colours are for curves that carry none.
        if (group.strands.colors && source === stock) {
            Material.setUniform(material, 'u_rootColor', [1, 1, 1, 1]);
            Material.setUniform(material, 'u_tipColor', [1, 1, 1, 1]);
        }
        const child = world.spawn(`Groom ${group.name || g}`);
        world.insert(child, RuntimeOnly);
        world.insert(child, Transform, {});
        world.insert(child, MeshRenderer, {
            mesh, material, lit: true, opaque: true, cullBackfaces: false, castShadows: s.castShadows,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        world.setParent(child, entity);
        held.children.push(child);
    }
    if (cardsMesh && cardsMaterial && doc.cards) {
        const child = world.spawn('Groom Cards');
        world.insert(child, RuntimeOnly);
        world.insert(child, Transform, {});
        world.insert(child, MeshRenderer, {
            mesh: cardsMesh, material: cardsMaterial, lit: true, opaque: true, cullBackfaces: false, castShadows: true, enabled: false,
            color: { r: 1, g: 1, b: 1, a: 1 },
        } as Partial<MeshRendererData>);
        world.setParent(child, entity);
        held.cards = { entity: child, screenSize: doc.cards.screenSize, leases };
    } else {
        for (const lease of leases) lease.release();
    }
}

function setEnabled(app: App, entity: Entity, enabled: boolean): void {
    const world = app.world;
    if (!world.valid(entity) || !world.has(entity, MeshRenderer)) return;
    const data = world.get(entity, MeshRenderer) as MeshRendererData;
    if (data.enabled !== enabled) world.insert(entity, MeshRenderer, { ...data, enabled });
}

/**
 * How much of the view's height a sphere covers, from the camera the last frame was drawn with where the host publishes it (it is
 * the editor's eye in the edit viewport), and from the scene's active camera of highest priority where it does not. Null with no camera.
 */
function viewMeasure(app: App): ((centre: number[], radius: number) => number) | null {
    if (app.hasResource(CameraCommit)) {
        const view = app.getResource(CameraCommit);
        if (view.valid) return (centre, radius) => screenSizeOf(view.viewProjection, centre, radius);
    }
    const world = app.world;
    let best: Entity | null = null, bestPriority = -Infinity;
    for (const e of world.getEntitiesWithComponents([Camera, Transform])) {
        const cam = world.get(e, Camera) as CameraData;
        if (cam.isActive && cam.priority > bestPriority) { best = e; bestPriority = cam.priority; }
    }
    if (best === null) return null;
    const cam = world.get(best, Camera) as CameraData;
    const t = world.get(best, Transform) as TransformData;
    const q = t.worldRotation ?? { x: 0, y: 0, z: 0, w: 1 };
    // The camera looks down its own -z.
    const f = [-(2 * (q.x * q.z + q.w * q.y)), -(2 * (q.y * q.z - q.w * q.x)), -(1 - 2 * (q.x * q.x + q.y * q.y))];
    const ortho = cam.projectionType === 1;
    const halfHeight = Math.tan(((cam.fov || 60) * Math.PI) / 360);
    return (centre, radius) => {
        if (ortho) return cam.orthoSize > 0 ? radius / cam.orthoSize : Infinity;
        const depth = (centre[0]! - t.worldPosition.x) * f[0]! + (centre[1]! - t.worldPosition.y) * f[1]! + (centre[2]! - t.worldPosition.z) * f[2]!;
        return depth > 1e-6 ? radius / (depth * halfHeight) : Infinity;
    };
}

/** Draws each groom that has cards as its cards where it covers less of the view than they say, and as its strands where more. */
function chooseLevels(app: App, res: GroomRes): void {
    const world = app.world;
    const measure = viewMeasure(app);
    if (!measure) return;
    for (const [entity, held] of res.built_) {
        if (!held.cards || !world.valid(entity) || !world.has(entity, Transform)) continue;
        const t = world.get(entity, Transform) as TransformData;
        const sc = t.worldScale ?? { x: 1, y: 1, z: 1 };
        const q = t.worldRotation ?? { x: 0, y: 0, z: 0, w: 1 };
        const local = [held.centre[0] * sc.x, held.centre[1] * sc.y, held.centre[2] * sc.z];
        // The centre turned with the groom: v + 2w(q x v) + 2 q x (q x v).
        const cx = q.y * local[2]! - q.z * local[1]!, cy = q.z * local[0]! - q.x * local[2]!, cz = q.x * local[1]! - q.y * local[0]!;
        const centre = [
            t.worldPosition.x + local[0]! + 2 * (q.w * cx + q.y * cz - q.z * cy),
            t.worldPosition.y + local[1]! + 2 * (q.w * cy + q.z * cx - q.x * cz),
            t.worldPosition.z + local[2]! + 2 * (q.w * cz + q.x * cy - q.y * cx),
        ];
        const size = measure(centre, held.radius * Math.max(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z)));
        const line = held.cards.screenSize;
        const next = held.showing === 'strands'
            ? (size < line * (1 - GROOM_LOD_HYSTERESIS) ? 'cards' : 'strands')
            : (size > line * (1 + GROOM_LOD_HYSTERESIS) ? 'strands' : 'cards');
        // Built showing its strands with its cards hidden, so only a change has anything to do.
        if (next === held.showing) continue;
        held.showing = next;
        for (const child of held.children) setEnabled(app, child, next === 'strands');
        setEnabled(app, held.cards.entity, next === 'cards');
    }
}

/** Keeps every `Groom` drawn as its files say. */
export class GroomPlugin implements Plugin {
    name = 'groom';
    activeWhen = [Groom];

    build(app: App): void {
        const res = new GroomRes();
        app.insertResource(GroomResource, res);
        app.world.onDespawn((entity) => letGo(app, res, entity));
        // A groom read from its files draws with shaders nothing has asked for yet: a warm-up waits for the ones still being read.
        holdShaderWarmup(app, () => res.loading_.size);
        let listening = false;
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            const world = app.world;
            if (!app.hasResource(Assets)) return;
            const assets = app.getResource(Assets);
            if (!listening) {
                listening = true;
                assets.onSourceChanged?.((changed) => { if (/\.(esgroom|escurves)$/i.test(changed)) res.revision_++; });
            }
            for (const entity of [...res.built_.keys()]) if (!world.valid(entity) || !world.has(entity, Groom)) letGo(app, res, entity);
            for (const entity of world.getEntitiesWithComponents([Groom, Transform])) {
                const path = (world.get(entity, Groom) as GroomData).groom;
                const key = `${path}#${res.revision_}#${worldUnitsPerMeter()}`;
                if (!path) { letGo(app, res, entity); res.failed_.delete(entity); continue; }
                if (res.built_.get(entity)?.key === key || res.loading_.has(entity)) continue;
                if (res.failed_.get(entity)?.key === key) continue;
                res.loading_.add(entity);
                void build(app, res, entity, path, key)
                    .then(() => { res.failed_.delete(entity); })
                    .catch((e) => {
                        res.failed_.set(entity, { key, why: e instanceof Error ? e.message : String(e) });
                        log.error('groom', `the groom ${path} cannot be drawn`, e);
                    })
                    .finally(() => { res.loading_.delete(entity); });
            }
            chooseLevels(app, res);
        // It builds what the files say rather than simulating, so it runs in the editor's paused viewport too.
        }, { name: 'GroomSystem', runWhenPaused: true }));
    }
}

/** The grooms an app draws. @experimental */
export const GroomResource = /* @__PURE__ */ defineResource<GroomRes>(new GroomRes(), 'Grooms');

export const groomPlugin = (): GroomPlugin => new GroomPlugin();
