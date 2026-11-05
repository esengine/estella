// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    compositeBatchPlugin.ts
 * @brief   Draws the parts under a `CompositeBatch` root in a few draws that follow the root wherever it goes.
 *
 * @details The parts stay as authored: scripts find them, colliders collide, the editor picks them; only their
 *          MeshRenderer is switched off, and entities parented to the root draw them instead (see compositeBatch.ts
 *          for how a part is folded). Because those entities are the root's children, moving, turning or scaling the
 *          root moves the whole model at the cost of one transform.
 *
 *          The pass looks again twice a second. A part added under the root, removed, switched to another mesh or
 *          placed somewhere else in it re-plans the composite, and only the chunks whose members changed are merged
 *          again; an instanced set is rewritten, which copies placements, not vertices. A part that keeps moving
 *          inside the root (a door, a wheel) is let go after a few looks and draws itself, so it never costs a
 *          merge per frame.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    Children, defineComponent, getComponent, MeshRenderer, Parent, RuntimeOnly, Transform,
    type AnyComponentDef, type ChildrenData, type ComponentDef, type MeshRendererData, type ParentData, type TransformData,
} from '../ecs/component';
import { BodyType } from '../wasm/wasm.generated';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import type { MeshData } from '../asset/meshFormat';
import { engineApi } from '../ecs/bridge/engineApi';
import { withScratch } from '../wasm/wasmScratch';
import type { CppRegistry } from '../wasm';
import { log } from '../util/logger';
import type { Entity } from '../types';
import { channelSignature, layoutRefusal, mergeMeshes, staticBatchKey, type StaticBatchRefusal } from './staticBatch';
import {
    COMPOSITE_DEFAULTS, COMPOSITE_PLACEMENT_FLOATS, placementsOf, planComposite, rootLocalMatrix, sameMatrix,
    type CompositeLimits, type CompositePart, type Mat4, type TRS,
} from './compositeBatch';

/** The fields of the `CompositeBatch` component. @experimental */
export interface CompositeBatchData {
    /** Parts of one mesh at or past which they are drawn as one instanced set instead of merged. */
    instanceMin: number;
    /** Side of a merge chunk in the root's own space; 0 lets the pass choose from the model's size. */
    cellSize: number;
    /** Meshes under the root the pass draws (instanced or merged). Written by the pass. */
    parts: number;
    /** Of those, the parts drawn as instanced sets. */
    instanced: number;
    /** Draws the model takes now: sets, merged chunks and the parts that still draw themselves. */
    draws: number;
    /** Draws the same parts took before: one per distinct mesh and draw state. */
    drawsBefore: number;
    /** Parts that kept moving inside the root and were let go to draw themselves. */
    moving: number;
}

/**
 * Marks the root of a model assembled from many parts that moves as a whole (a ship, a vehicle, a moving platform),
 * so its parts may be drawn in a few draws that follow it. Presence is the opt-in; the parts need nothing.
 *
 * @experimental
 */
export const CompositeBatch: ComponentDef<CompositeBatchData> = defineComponent<CompositeBatchData>('CompositeBatch', {
    instanceMin: COMPOSITE_DEFAULTS.instanceMin,
    cellSize: COMPOSITE_DEFAULTS.cellSize,
    parts: 0,
    instanced: 0,
    draws: 0,
    drawsBefore: 0,
    moving: 0,
}, {
    readonlyFields: ['parts', 'instanced', 'draws', 'drawsBefore', 'moving'],
    fields: {
        instanceMin: { min: 2, label: 'Instance at', tooltip: 'Parts of one mesh at or past this count are drawn as one instanced set (no copy of their vertices). Fewer are merged.' },
        cellSize: { min: 0, label: 'Chunk size', tooltip: 'Side of a merge chunk in the root\'s space. Smaller chunks re-merge less on an edit and cull better; 0 chooses from the model\'s size.' },
        parts: { label: 'Batched parts' },
        instanced: { label: 'Instanced parts' },
        draws: { label: 'Draws' },
        drawsBefore: { label: 'Draws before' },
        moving: { label: 'Moving parts' },
    },
});

/** Looks a part may change in a row before it is taken for one that moves inside the model. */
const MOVING_AFTER = 3;
/** Frames between looks at a composite (half a second at 60 fps). A look reads every part through the engine, which is the pass's whole cost on a still model; `refresh(root)` looks at once. */
const SCAN_FRAMES = 30;

interface PartState {
    entity: Entity;
    key: string;
    mesh: number;
    local: Mat4;
    vertices: number;
    center: [number, number, number];
    mr: MeshRendererData;
    /** Looks in a row in which its place in the root changed. */
    changed: number;
}

/** The optional components a refusal looks for, by name: none of them is a subsystem a composite should carry. */
interface RefusalDefs {
    lod?: AnyComponentDef; billboard?: AnyComponentDef; skin?: AnyComponentDef; instances?: AnyComponentDef;
    body?: AnyComponentDef; character?: AnyComponentDef;
}

/** Whether two renderers draw the same way: the state a part's key is made from. */
function sameDrawState(a: MeshRendererData, b: MeshRendererData): boolean {
    return a.material === b.material && a.texture === b.texture && a.normalMap === b.normalMap && a.layer === b.layer
        && a.cullBackfaces === b.cullBackfaces && a.lit === b.lit
        && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a
        && a.parallax.x === b.parallax.x && a.parallax.y === b.parallax.y;
}

interface DrawnChunk { holder: Entity; handle: number; entities: Entity[] }
interface DrawnSet { holder: Entity; entities: Entity[]; placements: Float32Array }

interface CompositeState {
    root: Entity;
    cellSize: number | null;
    parts: Map<Entity, PartState>;
    chunks: Map<string, DrawnChunk>;
    sets: Map<string, DrawnSet>;
    /** Parts whose MeshRenderer this pass switched off, and so must switch back on. */
    owned: Set<Entity>;
    moving: Set<Entity>;
    refused: Map<Entity, StaticBatchRefusal>;
    holders: Set<Entity>;
    nextScan: number;
}

/** Run-time access to the composites: what each one draws, and how to look again now. */
export class CompositeBatching {
    /** @internal */ readonly composites_ = new Map<Entity, CompositeState>();
    /** @internal */ readonly forced_ = new Set<Entity>();
    /** @internal */ busy_ = false;
    /** Work done so far, for a profiler or a check: re-plans, chunk merges, placement writes, scans. */
    readonly counts = { scans: 0, applies: 0, merges: 0, placementWrites: 0 };

    /** Look at `root` (or every composite) on the next frame instead of waiting for the next scheduled look. */
    refresh(root?: Entity): void {
        if (root === undefined) for (const r of this.composites_.keys()) this.forced_.add(r);
        else this.forced_.add(root);
    }

    /** What a composite draws now, or null when it is not one the pass has seen. */
    report(root: Entity): { sets: number; chunks: number; alone: number; moving: number; refused: number; parts: number } | null {
        const c = this.composites_.get(root);
        if (!c) return null;
        const drawn = new Set([...c.chunks.values()].flatMap((x) => x.entities).concat([...c.sets.values()].flatMap((x) => x.entities)));
        return {
            sets: c.sets.size, chunks: c.chunks.size,
            alone: [...c.parts.keys()].filter((e) => !drawn.has(e)).length,
            moving: c.moving.size, refused: c.refused.size, parts: drawn.size,
        };
    }
}

/** The resource the plugin installs. @experimental */
export const CompositeBatchingRes = defineResource<CompositeBatching>(new CompositeBatching(), 'CompositeBatching');

/** Whether `entity` sits under a `CompositeBatch` root (itself excluded): such a part is the composite's, not a static batch's. */
export function underComposite(world: App['world'], entity: Entity): boolean {
    let at = entity;
    for (let depth = 0; depth < 256 && world.has(at, Parent); depth++) {
        at = (world.get(at, Parent) as ParentData).entity;
        if (!world.valid(at)) return false;
        if (world.has(at, CompositeBatch)) return true;
    }
    return false;
}

export class CompositeBatchPlugin implements Plugin {
    name = 'compositeBatch';
    private readonly meshes_ = new Map<number, Promise<MeshData | null>>();

    build(app: App): void {
        const state = new CompositeBatching();
        app.insertResource(CompositeBatchingRes, state);
        let frame = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            frame++;
            if (state.busy_ || !app.hasResource(Assets)) return;
            const world = app.world;
            // A root that went away takes its draws with it and gives its parts their own back.
            for (const [root, c] of state.composites_) {
                if (!world.valid(root) || !world.has(root, CompositeBatch)) { this.discard(app, c); state.composites_.delete(root); }
            }
            const due: Entity[] = [];
            for (const root of world.getEntitiesWithComponents([CompositeBatch])) {
                let c = state.composites_.get(root);
                if (!c) {
                    c = {
                        root, cellSize: null, parts: new Map(), chunks: new Map(), sets: new Map(), owned: new Set(),
                        moving: new Set(), refused: new Map(), holders: new Set(), nextScan: frame,
                    };
                    state.composites_.set(root, c);
                }
                if (state.forced_.has(root) || frame >= c.nextScan) due.push(root);
            }
            if (due.length === 0) return;
            state.busy_ = true;
            void (async () => {
                for (const root of due) {
                    const c = state.composites_.get(root);
                    if (!c) continue;
                    state.forced_.delete(root);
                    c.nextScan = frame + SCAN_FRAMES;
                    await this.scan(app, c);
                }
            })()
                .catch((e) => log.error('compositeBatch', 'a composite batch pass failed', e))
                .finally(() => { state.busy_ = false; });
        }, { name: 'CompositeBatchSystem' }), { runIf: playModeOnly });
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(CompositeBatchingRes)) return;
        const state = app.getResource(CompositeBatchingRes);
        for (const c of state.composites_.values()) this.discard(app, c);
        state.composites_.clear();
    }

    private meshData(app: App, handle: number): Promise<MeshData | null> {
        let p = this.meshes_.get(handle);
        if (!p) {
            p = app.getResource(Assets).readMeshData(handle).catch(() => null);
            this.meshes_.set(handle, p);
        }
        return p;
    }

    /** The root's subtree (root included), not entering a nested composite or the pass's own draws. */
    private subtree(app: App, c: CompositeState): Entity[] {
        const world = app.world;
        const out: Entity[] = [];
        const stack: Entity[] = [c.root];
        while (stack.length > 0) {
            const e = stack.pop()!;
            if (c.holders.has(e) || !world.valid(e)) continue;
            if (e !== c.root && world.has(e, CompositeBatch)) continue;
            out.push(e);
            if (world.has(e, Children)) for (const child of (world.get(e, Children) as ChildrenData).entities) stack.push(child as Entity);
        }
        return out;
    }

    /** The local transforms from just under the root down to `entity`. */
    private chain(app: App, root: Entity, entity: Entity): TRS[] {
        const world = app.world;
        const out: TRS[] = [];
        let at = entity;
        for (let depth = 0; depth < 256 && at !== root; depth++) {
            const t = world.get(at, Transform) as TransformData;
            out.push({ position: t.position, rotation: t.rotation, scale: t.scale });
            if (!world.has(at, Parent)) break;
            at = (world.get(at, Parent) as ParentData).entity;
        }
        return out.reverse();
    }

    /** Why a part cannot be folded, or null. The same rules a static batch keeps, read the same way. */
    private refusal(app: App, e: Entity, mr: MeshRendererData, defs: RefusalDefs): StaticBatchRefusal | null {
        const world = app.world;
        const has = (def: AnyComponentDef | undefined): boolean => !!def && world.has(e, def);
        if (!mr.opaque) return 'blended';
        if (has(defs.lod)) return 'lod';
        if (has(defs.billboard) && (world.get(e, defs.billboard!) as { enabled: boolean }).enabled) return 'billboard';
        if (has(defs.skin)) return 'skinned';
        if (has(defs.instances)) return 'layout';
        // A body the solver moves goes its own way; a kinematic or static one rides with the root.
        if (has(defs.character) || (has(defs.body) && (world.get(e, defs.body!) as { bodyType: number }).bodyType === BodyType.Dynamic)) return 'moves';
        return null;
    }

    private async scan(app: App, c: CompositeState): Promise<void> {
        const world = app.world;
        const counts = app.getResource(CompositeBatchingRes).counts;
        counts.scans++;
        if (!world.valid(c.root)) return;
        const settings = world.get(c.root, CompositeBatch) as CompositeBatchData;
        const limits: CompositeLimits = { ...COMPOSITE_DEFAULTS, instanceMin: settings.instanceMin, cellSize: settings.cellSize };

        const defs: RefusalDefs = {
            lod: getComponent('LODGroup'), billboard: getComponent('Billboard'), skin: getComponent('MeshSkin'),
            instances: getComponent('MeshInstances'), body: getComponent('RigidBody3D'), character: getComponent('CharacterController3D'),
        };
        const seen = new Set<Entity>();
        const changed = new Set<Entity>();
        let structural = false;
        for (const e of this.subtree(app, c)) {
            if (!world.has(e, MeshRenderer) || !world.has(e, Transform)) continue;
            const mr = world.get(e, MeshRenderer) as MeshRendererData;
            const ours = c.owned.has(e);
            // Switched off by the author (not by this pass) or not loaded yet: nothing to draw.
            if ((!mr.enabled && !ours) || mr.mesh === 0) continue;
            if (c.moving.has(e)) { seen.add(e); continue; }
            const why = this.refusal(app, e, mr, defs);
            if (why) {
                if (!c.refused.has(e)) { c.refused.set(e, why); structural = true; }
                continue;
            }
            c.refused.delete(e);
            // Read once per mesh; every later look takes it from what was read, without a turn of the event loop.
            let mesh = this.resolved_.get(mr.mesh);
            if (mesh === undefined) {
                mesh = await this.meshData(app, mr.mesh);
                this.resolved_.set(mr.mesh, mesh);
            }
            if (!world.valid(e) || !world.valid(c.root)) continue;
            if (!mesh) { c.refused.set(e, 'no-mesh'); continue; }
            const layout = layoutRefusal(mesh);
            if (layout) { c.refused.set(e, layout); continue; }

            const local = rootLocalMatrix(this.chain(app, c.root, e));
            const known = c.parts.get(e);
            const key = known && known.mesh === mr.mesh && sameDrawState(known.mr, mr) ? known.key : staticBatchKey({
                material: mr.material, texture: mr.texture, normalMap: mr.normalMap, color: mr.color, layer: mr.layer,
                cullBackfaces: mr.cullBackfaces, lit: mr.lit, parallax: mr.parallax, group: '',
            }, channelSignature(mesh.channels, mesh.vertexStride));
            const cx = (mesh.aabbMin[0] + mesh.aabbMax[0]) / 2, cy = (mesh.aabbMin[1] + mesh.aabbMax[1]) / 2, cz = (mesh.aabbMin[2] + mesh.aabbMax[2]) / 2;
            const center: [number, number, number] = [
                local[0]! * cx + local[4]! * cy + local[8]! * cz + local[12]!,
                local[1]! * cx + local[5]! * cy + local[9]! * cz + local[13]!,
                local[2]! * cx + local[6]! * cy + local[10]! * cz + local[14]!,
            ];
            seen.add(e);
            const before = known;
            if (!before) {
                c.parts.set(e, { entity: e, key, mesh: mr.mesh, local, vertices: mesh.vertexCount, center, mr: { ...mr, enabled: true }, changed: 0 });
                structural = true;
                continue;
            }
            if (before.key !== key || before.mesh !== mr.mesh) {
                Object.assign(before, { key, mesh: mr.mesh, local, vertices: mesh.vertexCount, center, mr: { ...mr, enabled: true }, changed: 0 });
                changed.add(e);
                continue;
            }
            if (!sameMatrix(before.local, local)) {
                before.changed++;
                before.local = local;
                before.center = center;
                if (before.changed >= MOVING_AFTER) {
                    // It moves inside the model: let it draw itself rather than re-merge its chunk every look.
                    c.moving.add(e);
                    c.parts.delete(e);
                    structural = true;
                } else {
                    changed.add(e);
                }
            } else {
                before.changed = 0;
            }
        }
        for (const e of [...c.parts.keys()]) if (!seen.has(e)) { c.parts.delete(e); structural = true; }
        for (const e of [...c.moving]) if (!seen.has(e)) c.moving.delete(e);
        for (const e of [...c.refused.keys()]) if (!world.valid(e)) c.refused.delete(e);
        if (!structural && changed.size === 0) return;
        counts.applies++;
        this.apply(app, c, limits, changed);
    }

    /** Re-plan the composite and bring its draws in line, re-merging only the chunks whose members changed. */
    private apply(app: App, c: CompositeState, limits: CompositeLimits, changed: ReadonlySet<Entity>): void {
        const world = app.world;
        const assets = app.getResource(Assets);
        const parts: CompositePart[] = [...c.parts.values()].map((p) => ({
            entity: p.entity, key: p.key, mesh: p.mesh, local: p.local, vertices: p.vertices, center: p.center,
        }));
        if (c.cellSize === null) c.cellSize = limits.cellSize > 0 ? limits.cellSize : null;
        const plan = planComposite(parts, limits, c.cellSize ?? undefined);
        if (c.cellSize === null) c.cellSize = plan.cellSize;

        const drawn = new Set<Entity>();

        // Instanced sets: a placement list, rewritten whenever its members or their places change.
        const liveSets = new Set<string>();
        for (const set of plan.sets) {
            const id = `${set.key}|${set.mesh}`;
            liveSets.add(id);
            const members = set.entities as Entity[];
            for (const e of members) drawn.add(e);
            const placements = placementsOf(members.map((e) => c.parts.get(e)!.local));
            const existing = c.sets.get(id);
            if (existing && sameFloats(existing.placements, placements)) continue;
            const holder = existing?.holder ?? this.holder(app, c, `CompositeBatch set ${c.sets.size + 1}`, { ...c.parts.get(members[0]!)!.mr, mesh: set.mesh });
            if (!existing) {
                const def = getComponent('MeshInstances');
                if (def) world.insert(holder, def, {});
            }
            if (!this.writePlacements(app, holder, placements)) {
                // No placement path on this core: the parts keep drawing themselves.
                for (const e of members) drawn.delete(e);
                if (!existing) { world.despawn(holder); c.holders.delete(holder); }
                liveSets.delete(id);
                continue;
            }
            c.sets.set(id, { holder, entities: members, placements });
        }
        for (const [id, set] of c.sets) {
            if (liveSets.has(id)) continue;
            if (world.valid(set.holder)) world.despawn(set.holder);
            c.holders.delete(set.holder);
            c.sets.delete(id);
        }

        // Merged chunks: kept whole while their members and places are the same, merged again otherwise.
        const liveChunks = new Set<string>();
        for (const chunk of plan.chunks) {
            const members = chunk.entities as Entity[];
            const dirty = members.some((e) => changed.has(e));
            const existing = c.chunks.get(chunk.id);
            if (existing && !dirty) {
                liveChunks.add(chunk.id);
                for (const e of members) drawn.add(e);
                continue;
            }
            app.getResource(CompositeBatchingRes).counts.merges++;
            const merged = mergeMeshes(members.map((e) => ({ mesh: this.cached(c.parts.get(e)!.mesh)!, world: c.parts.get(e)!.local })));
            const handle = assets.createMesh(merged);
            if (handle === 0) {
                log.warn('compositeBatch', `the engine refused a merged chunk of ${members.length} parts (${merged.vertexCount} vertices)`);
                continue;
            }
            if (existing) {
                world.insert(existing.holder, MeshRenderer, { ...(world.get(existing.holder, MeshRenderer) as MeshRendererData), mesh: handle });
                assets.releaseBuiltMesh(existing.handle);
                existing.handle = handle;
            } else {
                const holder = this.holder(app, c, `CompositeBatch chunk ${c.chunks.size + 1}`, { ...c.parts.get(members[0]!)!.mr, mesh: handle });
                c.chunks.set(chunk.id, { holder, handle, entities: members });
            }
            liveChunks.add(chunk.id);
            for (const e of members) drawn.add(e);
        }
        for (const [id, chunk] of c.chunks) {
            if (liveChunks.has(id)) continue;
            if (world.valid(chunk.holder)) world.despawn(chunk.holder);
            assets.releaseBuiltMesh(chunk.handle);
            c.holders.delete(chunk.holder);
            c.chunks.delete(id);
        }

        // Parts drawn by the composite go dark; every other part the pass had switched off draws itself again.
        for (const e of drawn) {
            if (c.owned.has(e) || !world.valid(e)) continue;
            world.insert(e, MeshRenderer, { ...(world.get(e, MeshRenderer) as MeshRendererData), enabled: false });
            c.owned.add(e);
        }
        for (const e of [...c.owned]) {
            if (drawn.has(e)) continue;
            this.restore(app, e);
            c.owned.delete(e);
        }
        this.stamp(app, c, plan.sets.reduce((n, s) => n + s.entities.length, 0), drawn.size);
    }

    /** Mesh data the scan has already read, so a merge never waits. */
    private cached(handle: number): MeshData | null {
        return this.resolved_.get(handle) ?? null;
    }
    private readonly resolved_ = new Map<number, MeshData | null>();

    private holder(app: App, c: CompositeState, name: string, mr: MeshRendererData): Entity {
        const world = app.world;
        const holder = world.spawn(name);
        world.insert(holder, RuntimeOnly);
        world.insert(holder, Transform, {});
        world.insert(holder, MeshRenderer, { ...mr, enabled: true });
        world.setParent(holder, c.root);
        c.holders.add(holder);
        return holder;
    }

    private writePlacements(app: App, holder: Entity, placements: Float32Array): boolean {
        const api = engineApi(app);
        const set = api?.meshInstances_set;
        if (!set || !api._malloc || !api._free || !api.HEAPU8) return false;
        const registry = app.world.getCppRegistry() as CppRegistry;
        app.getResource(CompositeBatchingRes).counts.placementWrites++;
        withScratch({ _malloc: api._malloc, _free: api._free }, (alloc) => {
            const ptr = alloc(Math.max(4, placements.byteLength));
            new Float32Array(api.HEAPU8!.buffer, ptr, placements.length).set(placements);
            set(registry, holder, ptr, placements.length / COMPOSITE_PLACEMENT_FLOATS);
        });
        return true;
    }

    private restore(app: App, e: Entity): void {
        const world = app.world;
        const mr = world.valid(e) ? world.tryGet(e, MeshRenderer) as MeshRendererData | null : null;
        if (mr) world.insert(e, MeshRenderer, { ...mr, enabled: true });
    }

    private stamp(app: App, c: CompositeState, instanced: number, drawnCount: number): void {
        const world = app.world;
        if (!world.valid(c.root) || !world.has(c.root, CompositeBatch)) return;
        const all = [...c.parts.values()];
        const drawsBefore = new Set(all.map((p) => `${p.key}|${p.mesh}`)).size + c.moving.size;
        const draws = c.sets.size + c.chunks.size + (all.length - drawnCount) + c.moving.size;
        world.insert(c.root, CompositeBatch, {
            ...(world.get(c.root, CompositeBatch) as CompositeBatchData),
            parts: drawnCount, instanced, draws, drawsBefore, moving: c.moving.size,
        });
    }

    private discard(app: App, c: CompositeState): void {
        const world = app.world;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const set of c.sets.values()) if (world.valid(set.holder)) world.despawn(set.holder);
        for (const chunk of c.chunks.values()) { if (world.valid(chunk.holder)) world.despawn(chunk.holder); assets?.releaseBuiltMesh(chunk.handle); }
        for (const e of c.owned) this.restore(app, e);
        c.sets.clear(); c.chunks.clear(); c.owned.clear(); c.holders.clear(); c.parts.clear();
    }
}

function sameFloats(a: Float32Array, b: Float32Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export const compositeBatchPlugin: Plugin = new CompositeBatchPlugin();
