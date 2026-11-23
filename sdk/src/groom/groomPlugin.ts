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
import { defineComponent, MeshRenderer, RuntimeOnly, Transform, type ComponentDef, type MeshRendererData } from '../ecs/component';
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
import { decodeCurves, parseGroomDocument, settingsForGroups, type GroomCurves, type GroomGroupSettings } from './groomFormat';
import { buildStrandMesh } from './groomMesh';

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
    if (path.startsWith('/') || path.startsWith('assets/') || /^[a-z]+:/i.test(path)) return path;
    const lead = from.startsWith('/') ? '/' : '';
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const parts: string[] = [];
    for (const part of (dir + path).split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.' && part !== '') parts.push(part);
    }
    return lead + parts.join('/');
}

interface Built {
    key: string;
    children: Entity[];
    meshes: number[];
    materials: number[];
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
}

async function stockMaterial(assets: AssetsApi, res: GroomRes): Promise<number> {
    if (res.stock_) return res.stock_;
    const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:strands');
    if (!res.stock_) {
        res.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:strands', blendMode: BlendMode.Normal,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, source.compile([]));
    }
    return res.stock_;
}

function letGo(app: App, res: GroomRes, entity: Entity): void {
    const held = res.built_.get(entity);
    res.built_.delete(entity);
    if (!held) return;
    for (const child of held.children) if (app.world.valid(child)) app.world.despawn(child);
    const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
    for (const mesh of held.meshes) assets?.releaseBuiltMesh(mesh);
    for (const material of held.materials) Material.release(material);
}

async function build(app: App, res: GroomRes, entity: Entity, path: string, key: string): Promise<void> {
    const assets = app.getResource(Assets);
    const doc = parseGroomDocument(await assets.fetchText(path));
    const curves: GroomCurves = decodeCurves(await assets.fetchBinary(besideFile(path, doc.curves)));
    const settings = settingsForGroups(doc, curves.groups.length);
    const stock = await stockMaterial(assets, res);
    // The component may have gone, or changed to another groom, while the files were read.
    const world = app.world;
    if (!world.valid(entity) || !world.has(entity, Groom) || (world.get(entity, Groom) as GroomData).groom !== path) return;
    letGo(app, res, entity);
    const scale = worldUnitsPerMeter();
    const held: Built = { key, children: [], meshes: [], materials: [] };
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
            try { source = (await assets.loadMaterial(s.material)).handle || stock; } catch (e) { log.warn('groom', `group ${g} of ${path}: its material ${s.material} cannot be loaded, so it draws with the stock one`, e); }
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
        }, { name: 'GroomSystem' }));
    }
}

/** The grooms an app draws. @experimental */
export const GroomResource = /* @__PURE__ */ defineResource<GroomRes>(new GroomRes(), 'Grooms');

export const groomPlugin = (): GroomPlugin => new GroomPlugin();
