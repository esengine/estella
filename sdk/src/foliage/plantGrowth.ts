// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plantGrowth.ts
 * @brief   Growing plants a cell at a time inside the frame's budget: what `PlacedFoliage` and a generated world's plants share.
 *
 * @details A cell is an entity that stands at once, empty, and fills in over the frames after it. Every kind in it and every part of that kind is
 *          ONE entity holding where each plant stands (`MeshInstances`), drawing the part's mesh, which every cell shares: the geometry exists
 *          once however many plants there are, a plant costs sixty-four bytes, and the engine culls each plant against the view and picks its
 *          mesh by its distance (the part's cheaper mesh past the kind's `lodDistance`, nothing past `drawDistance`). The far version (a tree's
 *          crossed cards) is the same, a set of its own that begins where the kind ends: the hierarchical level of detail, with nothing on this
 *          side choosing between the two. Draws that share a mesh and a material are one draw in the engine, so a forest of cells is a few.
 *          The pieces wait in one queue for the whole app and are made while the frame's budget lasts, nearest asked first; a cell let go
 *          first leaves its pieces unmade.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { getComponent, MeshRenderer, RuntimeOnly, Transform, type MeshRendererData } from '../ecs/component';
import { engineApi } from '../ecs/bridge/engineApi';
import type { CppRegistry } from '../wasm';
import { withScratch } from '../wasm/wasmScratch';
import { Assets } from '../asset/AssetPlugin';
import { AssetScope, ownedAssetLease, type AssetLease } from '../asset/AssetLease';
import { Quality } from '../render/qualityRuntime';
import type { Assets as AssetsApi } from '../asset/Assets';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Entity } from '../types';
import { buildPlacements, PLACEMENT_FLOATS, softenNormals, thinPlants, type Plant } from './builder';
import type { PlacedKind, PlacedPart } from './plantKind';

/** A part with what it needs in hand: the handles of its meshes (shared by every cell) and of its material and texture. */
export interface ReadyPart { part: PlacedPart; mesh: number; lod1: number; lod2?: number; material: number; texture: number }

/** Every kind's parts in hand, and the parts that stand for each far off; `owned` are the meshes made here, which `releaseKinds` gives back. */
export interface ReadyKinds { kinds: ReadyPart[][]; far: ReadyPart[][]; owned: number[]; lease: AssetLease<AssetScope> }

/** One grown cell: its entity (none where nothing stands), what it owns so far, and whether it has been let go. */
export interface GrownCell { entity: Entity | null; handles: number[]; dead: boolean; assets?: AssetLease<AssetScope> }

/**
 * Loads the meshes, materials and textures of every part of every kind, once. A part whose normals are turned toward up (`soft`) is a mesh of its own,
 * made here, and a part whose geometry cannot be read is left out.
 */
export async function prepareKinds(assets: AssetsApi, kinds: readonly PlacedKind[]): Promise<ReadyKinds> {
    const owned: number[] = [];
    const scope = new AssetScope();
    const handles = new Map<string, number>();
    const load = async (type: 'mesh' | 'material' | 'texture', path: string): Promise<number> => {
        const key = `${type}:${path}`;
        const known = handles.get(key);
        if (known !== undefined) return known;
        const receipt = type === 'texture' ? await assets.acquireTexture(path) : await assets.acquireTyped<{ handle: number }>(type, path);
        scope.add(receipt);
        handles.set(key, receipt.value.handle);
        return receipt.value.handle;
    };
    const handleOf = async (path: string, soft: number): Promise<number> => {
        const loaded = await load('mesh', path);
        if (!soft) return loaded;
        const key = `soft:${soft}:${path}`;
        const known = handles.get(key);
        if (known !== undefined) return known;
        const source = await assets.readMeshData(loaded);
        const made = source ? assets.createMesh(softenNormals(source, soft)) : 0;
        if (made === 0) return loaded;
        owned.push(made);
        scope.add(ownedAssetLease(key, made, made, handle => assets.releaseBuiltMesh(handle)));
        handles.set(key, made);
        return made;
    };
    const ready = async (part: PlacedPart, withLod: boolean): Promise<ReadyPart | null> => {
        let mesh = 0;
        try { mesh = await handleOf(part.mesh, part.soft ?? 0); } catch { mesh = 0; }
        if (mesh === 0) { log.warn('foliage', `the geometry of ${part.mesh} cannot be read, so its plants are left out`); return null; }
        let lod1 = 0;
        if (withLod && part.lod1Mesh) { try { lod1 = await handleOf(part.lod1Mesh, part.soft ?? 0); } catch { lod1 = 0; } }
        let lod2 = 0;
        if (withLod && part.lod2Mesh) { try { lod2 = await handleOf(part.lod2Mesh, part.soft ?? 0); } catch { lod2 = 0; } }
        return {
            part, mesh, lod1, ...(lod2 ? { lod2 } : {}),
            material: part.material ? await load('material', part.material) : 0,
            texture: part.texture ? await load('texture', part.texture) : 0,
        };
    };
    const lease = ownedAssetLease('foliage-parts', 0, scope, held => {
        try { held.releaseAll(); } finally { owned.length = 0; }
    });
    const out: ReadyKinds = { kinds: [], far: [], owned, lease };
    try {
        for (const kind of kinds) {
            const parts: ReadyPart[] = [], far: ReadyPart[] = [];
            for (const part of kind.parts) { const r = await ready(part, true); if (r) parts.push(r); }
            for (const part of kind.far ?? []) { const r = await ready(part, false); if (r) far.push(r); }
            out.kinds.push(parts);
            out.far.push(far);
        }
    } catch (error) {
        lease.release();
        throw error;
    }
    return out;
}

/** Retires the owner's receipt. Published cells keep this generation alive until they are replaced. */
export function releaseKinds(ready: ReadyKinds): void {
    ready.lease.release();
}

/** The growth of every plant in an app: the pieces waiting. */
export class PlantGrowth {
    /** The pieces not yet made, in the order they were asked. */
    readonly queue: { cell: GrownCell; run: () => void }[] = [];
    app_: App | null = null;

    /** How many pieces are still waiting to be made. */
    get pending(): number { return this.queue.length; }

    /** Pieces made so far, and the milliseconds spent making them: what the growth has cost, for a profile to read. */
    made = 0;
    spentMs = 0;

    /**
     * Makes one entity under `parent` that draws `part`'s mesh at every place in `plants`, relative to `parent`. `from` and `to` are the distances
     * from the eye between which a plant is drawn (0 for no limit); `lod` is the distance past which the part's cheaper mesh stands in, and `shadow` the one past which it casts no shadow. All of them are scaled by the quality level's `detailScale`.
     */
    private place(app: App, parent: Entity, name: string, part: ReadyPart, plants: readonly Plant[], lod: number, from: number, to: number, shadow = 0, far = false, mesh = part.mesh, lod1 = part.lod1): void {
        const world = app.world;
        // The quality level's share of the kind's distances: a weaker device changes to the cheaper mesh sooner and draws less far.
        const quality = app.hasResource(Quality) ? app.getResource(Quality) : null;
        const detail = quality && quality.enabled ? quality.profile.detailScale : 1;
        lod *= detail; from *= detail; shadow *= detail;
        // The far version costs the same at any distance, so only where it begins moves, not where it ends.
        if (to > 0 && !far) to *= detail;
        const e = world.spawn(name);
        world.insert(e, RuntimeOnly);
        world.insert(e, Transform, {});
        world.insert(e, MeshRenderer, {
            mesh, material: part.material, texture: part.texture, lit: true, opaque: part.part.opaque !== false, cullBackfaces: false,
            castShadows: part.part.castShadows !== false,
            color: { r: part.part.tint[0], g: part.part.tint[1], b: part.part.tint[2], a: part.part.tint[3] },
        } as Partial<MeshRendererData>);
        const placements = getComponent('MeshInstances');
        if (placements) world.insert(e, placements, { lod1Mesh: lod1, lodDistance: lod1 ? lod : 0, minDistance: from, drawDistance: to, shadowDistance: shadow });
        world.setParent(e, parent);
        const api = engineApi(app);
        const set = api?.meshInstances_set;
        if (!set || !api._malloc || !api._free || !api.HEAPU8 || plants.length === 0) return;
        const data = buildPlacements(plants);
        const registry = world.getCppRegistry() as CppRegistry;
        withScratch({ _malloc: api._malloc, _free: api._free }, (alloc) => {
            const ptr = alloc(data.byteLength);
            // Read after the allocation: it may have grown the memory, which replaces the buffer.
            new Float32Array(api.HEAPU8!.buffer, ptr, data.length).set(data);
            set(registry, e, ptr, data.length / PLACEMENT_FLOATS);
        });
    }

    /**
     * Grows `cell`, whose entity the caller has made and stands at the cell's centre: the plants of each kind in `byKind` (relative to that centre),
     * a piece of work a kind's part.
     */
    growCell(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>): void {
        const world = app.world, entity = cell.entity;
        if (entity === null) return;
        cell.assets ??= ready.lease.retain() ?? undefined;
        if (!cell.assets) return;
        for (const [kindIndex, plants] of byKind) {
            const kind = kinds[kindIndex], parts = ready.kinds[kindIndex];
            if (!kind || !parts) continue;
            parts.forEach((r, j) => {
                this.queue.push({ cell, run: () => {
                    if (!world.valid(entity)) return;
                    try {
                        const shadow = kind.lodDistance > 0 ? kind.lodDistance * 2 : 0;
                        // A third mesh takes over where the kind's `lod2Distance` is: two sets, each drawn between its own distances.
                        const third = r.lod2 && (kind.lod2Distance ?? 0) > 0 ? kind.lod2Distance! : 0;
                        this.place(app, entity, `${kindIndex}:${j}`, r, plants, kind.lodDistance, 0, third || kind.drawDistance, shadow);
                        if (third) this.place(app, entity, `${kindIndex}:${j}:lod2`, r, plants, 0, third, kind.drawDistance, shadow, false, r.lod2, 0);
                    } catch (error) {
                        log.error('foliage', 'growing a piece of a cell of plants failed', error);
                    }
                } });
            });
        }
    }

    /**
     * Grows the far version of `cell`: each kind with one, its plants (thinned to the kind's `farKeep`) as a set of the far part's, drawn from
     * where the kind stops (`drawDistance`) out to `farDistance` from the eye. Cheap enough (a tree is two cards) to be made at once. `thinnedBy` is how many
     * times thinner they were planned already (a far plan), so they are not thinned twice.
     */
    growFar(app: App, cell: GrownCell, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>, _at?: { x: number; z: number; half?: number }, thinnedBy = 1): void {
        const entity = cell.entity;
        if (entity === null) return;
        cell.assets ??= ready.lease.retain() ?? undefined;
        if (!cell.assets) return;
        for (const [kindIndex, plants] of byKind) {
            const parts = ready.far[kindIndex], kind = kinds[kindIndex];
            if (!kind || !parts || parts.length === 0) continue;
            const kept = thinPlants(plants, kind.farKeep ?? 1, thinnedBy);
            for (const r of parts) this.place(app, entity, `far ${kindIndex}`, r, kept, 0, kind.drawDistance, kind.farDistance, 0, true);
        }
    }

    /** Lets a cell go: what it made is despawned, and what it had not yet made is left unmade. */
    release(app: App, cell: GrownCell): void {
        cell.dead = true;
        try {
            if (cell.entity !== null && app.world.valid(cell.entity)) app.world.despawn(cell.entity);
        } finally {
            cell.assets?.release();
            cell.assets = undefined;
            cell.handles.length = 0;
        }
    }

    /** One frame of it: the far versions shown where they should be, and the queue worked through while the frame's budget lasts, one piece at least. */
    step(app: App): void {
        const bakes = bakesOf(app);
        let first = true;
        while (this.queue.length > 0 && (first || bakes.hasTime())) {
            first = false;
            const piece = this.queue.shift()!;
            if (piece.cell.dead) continue;
            const t0 = performance.now();
            piece.run();
            this.spentMs += performance.now() - t0;
            this.made++;
        }
        bakes.mark(this, 'Growing the plants', this.queue.length === 0 ? 1 : 0.5);
    }
}

/** The resource every plant's growth shares. @experimental */
export const PlantGrowthRes = defineResource<PlantGrowth>(new PlantGrowth(), 'PlantGrowth');

/** The App's plant growth, installed (with the system that steps it) on first use. */
export function plantGrowthOf(app: App): PlantGrowth {
    if (!app.hasResource(PlantGrowthRes)) {
        const growth = new PlantGrowth();
        growth.app_ = app;
        app.insertResource(PlantGrowthRes, growth);
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { if (app.hasResource(Assets)) app.measureFrameScope('plants.grow', () => growth.step(app)); }, { name: 'PlantGrowthSystem' }));
    }
    return app.getResource(PlantGrowthRes);
}
