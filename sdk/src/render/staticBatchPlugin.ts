// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    staticBatchPlugin.ts
 * @brief   Folds the meshes an author marked `StaticBatch` into a few larger ones, while the game runs.
 *
 * @details Run time, not export time, so the editor's Play, a web build, a mini game and a native
 *          app all draw the same thing. The marked entities stay exactly as authored — scripts can
 *          still find them, colliders still collide, the editor still picks them — and only their
 *          MeshRenderer is switched off; one entity per merged group draws them instead.
 *
 *          The contract is the usual one for static batching: a marked mesh does not move after the
 *          pass has seen it. Destroying one is supported (its group is rebuilt without it); moving
 *          one is not, and nothing here can notice.
 *
 *          A pass waits until entities stop arriving: a scene spawns over several frames, and merging
 *          what has arrived so far would leave a batch per frame instead of a batch per room.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    defineComponent, getComponent, MeshRenderer, Transform, SceneOwner,
    type ComponentDef, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { BodyType } from '../wasm/wasm.generated';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { MeshChannel, type MeshData } from '../asset/meshFormat';
import { log } from '../util/logger';
import type { Entity } from '../types';
import {
    STATIC_BATCH_DEFAULTS, channelSignature, layoutRefusal, mergeMeshes, planStaticBatches, staticBatchKey, worldMatrix,
    type BatchPart, type StaticBatchCandidate, type StaticBatchGroup, type StaticBatchLimits, type StaticBatchRefusal,
    type StaticBatchReport,
} from './staticBatch';
import { underComposite } from './compositeBatchPlugin';

/** Where a marked mesh stands after the last pass: not decided yet, merged, or left out and why. @experimental */
export const StaticBatchState = {
    Pending: 0,
    Merged: 1,
    Skinned: 2,
    Morph: 3,
    Lod: 4,
    Blended: 5,
    Moves: 6,
    Baked: 7,
    Alone: 8,
    NoMesh: 9,
    Layout: 10,
    Disabled: 11,
    Billboard: 12,
} as const;

const REFUSAL_STATE: Record<StaticBatchRefusal, number> = {
    skinned: StaticBatchState.Skinned, morph: StaticBatchState.Morph, lod: StaticBatchState.Lod,
    blended: StaticBatchState.Blended, moves: StaticBatchState.Moves, baked: StaticBatchState.Baked,
    alone: StaticBatchState.Alone, 'no-mesh': StaticBatchState.NoMesh, layout: StaticBatchState.Layout,
    disabled: StaticBatchState.Disabled, billboard: StaticBatchState.Billboard,
};

/** The fields of the `StaticBatch` component. @experimental */
export interface StaticBatchData {
    /** Meshes batch only with others of the same group, so two rooms can be kept apart. */
    group: string;
    /** What the last pass did with this mesh (a {@link StaticBatchState}); written by the pass, 0 until it has run. */
    state: number;
    /** How many meshes were drawn together with this one, itself included; 0 unless merged. */
    batched: number;
}

/**
 * Marks a mesh as one that will not move, so it may be drawn together with others that share its material.
 * Presence is the opt-in.
 *
 * @experimental
 */
export const StaticBatch: ComponentDef<StaticBatchData> = defineComponent<StaticBatchData>('StaticBatch', {
    group: '',
    state: StaticBatchState.Pending,
    batched: 0,
}, {
    // The pass writes these into the running world; they are outputs, never authoring.
    readonlyFields: ['state', 'batched'],
    fields: {
        group: { tooltip: 'Meshes batch only with others of the same group. Empty is the default group.' },
        state: {
            label: 'Status',
            enum: [
                { label: 'Waiting', value: StaticBatchState.Pending },
                { label: 'Merged', value: StaticBatchState.Merged },
                { label: 'Not merged: skinned', value: StaticBatchState.Skinned },
                { label: 'Not merged: morphing', value: StaticBatchState.Morph },
                { label: 'Not merged: level of detail', value: StaticBatchState.Lod },
                { label: 'Not merged: blended', value: StaticBatchState.Blended },
                { label: 'Not merged: moves', value: StaticBatchState.Moves },
                { label: 'Not merged: baked light', value: StaticBatchState.Baked },
                { label: 'Not merged: alone in its group', value: StaticBatchState.Alone },
                { label: 'Not merged: no mesh', value: StaticBatchState.NoMesh },
                { label: 'Not merged: vertex layout', value: StaticBatchState.Layout },
                { label: 'Not merged: disabled', value: StaticBatchState.Disabled },
                { label: 'Not merged: billboard', value: StaticBatchState.Billboard },
            ],
            // Nothing to say before a pass has run, so the row stays out of the way in the editor.
            shownWhen: { field: 'state', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        },
        batched: { label: 'Batched meshes', min: 0, shownWhen: { field: 'state', values: [1] } },
    },
});

/** Run-time access to the batcher: what it did, and how to ask it to do it again. */
export class StaticBatching {
    limits: StaticBatchLimits = { ...STATIC_BATCH_DEFAULTS };
    /** @internal */ readonly groups_: StaticBatchGroupState[] = [];
    /** @internal */ readonly refused_ = new Map<number, StaticBatchRefusal>();
    /** @internal */ readonly seen_ = new Set<number>();
    /** @internal */ pending_ = 0;
    /** @internal */ stable_ = 0;
    /** @internal */ busy_ = false;
    /** @internal */ dirty_ = true;

    /** What the last passes merged and left out. */
    report(): StaticBatchReport {
        return { groups: this.groups_.map((g) => g.report), refused: new Map(this.refused_) };
    }

    /** The last passes in the small form the profiler reports across a process boundary. */
    summary(): StaticBatchSummary | null {
        if (this.groups_.length === 0 && this.refused_.size === 0) return null;
        const byReason = new Map<string, number[]>();
        for (const [entity, why] of this.refused_) {
            const list = byReason.get(why);
            if (list) list.push(entity); else byReason.set(why, [entity]);
        }
        return {
            groups: this.groups_.map((g) => ({
                entity: g.entity,
                parts: g.parts.slice(0, SUMMARY_IDS),
                partCount: g.parts.length,
                triangles: g.report.triangles,
                bytes: g.report.bytes,
                drawsBefore: g.report.drawsBefore,
            })),
            refused: [...byReason].map(([reason, entities]) => ({ reason, count: entities.length, entities: entities.slice(0, SUMMARY_IDS) })),
        };
    }

    /** Marked entities the pass has not decided on yet (their mesh is still loading). */
    get pending(): number {
        return this.pending_;
    }

    /** Forget every decision and merge again from the scene as it stands. */
    rebuild(): void {
        this.dirty_ = true;
        this.stable_ = 0;
    }
}

/** Entities named per group or reason in {@link StaticBatching.summary}: enough to select, small enough to poll. */
const SUMMARY_IDS = 200;

/** What the profiler shows of the batcher: one entry per merged mesh, and the meshes left out by reason. */
export interface StaticBatchSummary {
    groups: { entity: number; parts: number[]; partCount: number; triangles: number; bytes: number; drawsBefore: number }[];
    refused: { reason: string; count: number; entities: number[] }[];
}

/** The resource the plugin installs. @experimental */
export const StaticBatchingRes = defineResource<StaticBatching>(new StaticBatching(), 'StaticBatching');

interface StaticBatchGroupState {
    entity: Entity;
    handle: number;
    parts: Entity[];
    report: StaticBatchGroup;
}

/** Frames with nothing new to merge before a pass starts. */
const SETTLE_FRAMES = 2;
/** Frames between checks for a part that has gone away. */
const SWEEP_FRAMES = 30;

const drawsOf = (meshes: readonly MeshData[]): number => new Set(meshes).size;

export class StaticBatchPlugin implements Plugin {
    name = 'staticBatch';

    build(app: App): void {
        const state = new StaticBatching();
        app.insertResource(StaticBatchingRes, state);
        const world = app.world;
        let frame = 0;

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            frame++;
            if (state.busy_ || !app.hasResource(Assets)) return;
            const assets = app.getResource(Assets);

            if (state.dirty_) {
                this.discardAll(app, state);
                state.dirty_ = false;
            }
            const fresh = this.freshEntities(app, state);
            if (fresh.length > 0) {
                state.stable_ = 0;
                state.pending_ = fresh.length;
                return;
            }
            state.pending_ = 0;
            const undecided = this.undecided(app, state);
            if (undecided.length > 0) {
                state.stable_++;
                if (state.stable_ < SETTLE_FRAMES) return;
                state.busy_ = true;
                void this.pass(app, state, assets, undecided)
                    .catch((e) => log.error('staticBatch', 'a static batch pass failed', e))
                    .finally(() => { state.busy_ = false; });
                return;
            }
            if (frame % SWEEP_FRAMES === 0) this.sweep(app, state, assets);
        }, { name: 'StaticBatchSystem' }), { runIf: playModeOnly });
    }

    cleanup(app?: App): void {
        if (app?.hasResource(StaticBatchingRes)) this.discardAll(app, app.getResource(StaticBatchingRes));
    }

    /** Marked entities whose mesh handle has not arrived: the pass cannot decide on them yet. */
    private freshEntities(app: App, state: StaticBatching): Entity[] {
        const world = app.world;
        const out: Entity[] = [];
        for (const e of world.getEntitiesWithComponents([StaticBatch, MeshRenderer, Transform])) {
            if (state.seen_.has(e)) continue;
            const mr = world.get(e, MeshRenderer) as MeshRendererData;
            if (mr.enabled && mr.mesh === 0) out.push(e);
        }
        return out;
    }

    /** Marked entities with a mesh, not yet merged or refused. */
    private undecided(app: App, state: StaticBatching): Entity[] {
        const world = app.world;
        // A part under a CompositeBatch root moves with that root: baking it where it stands would leave it behind.
        return world.getEntitiesWithComponents([StaticBatch, MeshRenderer, Transform])
            .filter((e) => !state.seen_.has(e) && !underComposite(world, e));
    }

    private refuse(app: App, state: StaticBatching, entity: Entity, why: StaticBatchRefusal): void {
        state.refused_.set(entity, why);
        state.seen_.add(entity);
        this.stamp(app, entity, REFUSAL_STATE[why], 0);
    }

    /** Records on the component what became of it, which is where the editor reads it from. */
    private stamp(app: App, entity: Entity, status: number, batched: number): void {
        const world = app.world;
        if (!world.valid(entity) || !world.has(entity, StaticBatch)) return;
        world.insert(entity, StaticBatch, { ...(world.get(entity, StaticBatch) as StaticBatchData), state: status, batched });
    }

    private async pass(app: App, state: StaticBatching, assets: ReturnType<App['getResource']> & any, entities: Entity[]): Promise<void> {
        const world = app.world;
        const lodDef = getComponent('LODGroup');
        const billboardDef = getComponent('Billboard');
        const skinDef = getComponent('MeshSkin');
        const probeDef = getComponent('LightProbeVolume');
        const bakedDef = getComponent('BakedLighting');
        // By name, not import: 3D physics is an optional subsystem and a static batch has no business carrying its solver.
        const bodyDef = getComponent('RigidBody3D');
        const characterDef = getComponent('CharacterController3D');
        const probed = !!probeDef && world.getEntitiesWithComponents([probeDef]).length > 0;
        const baked = !!bakedDef && world.getEntitiesWithComponents([bakedDef])
            .some((e) => (world.get(e, bakedDef) as { bakedFrom?: string }).bakedFrom);

        const meshes = new Map<number, MeshData | null>();
        const candidates: StaticBatchCandidate[] = [];
        const info = new Map<number, { mr: MeshRendererData; mesh: MeshData; world: BatchPart['world']; scene: string }>();

        for (const e of entities) {
            if (!world.valid(e)) continue;
            const mr = world.get(e, MeshRenderer) as MeshRendererData;
            const sb = world.get(e, StaticBatch) as StaticBatchData;
            if (!mr.enabled) { this.refuse(app, state, e, 'disabled'); continue; }
            if (!mr.opaque) { this.refuse(app, state, e, 'blended'); continue; }
            if (lodDef && world.has(e, lodDef)) { this.refuse(app, state, e, 'lod'); continue; }
            if (billboardDef && world.has(e, billboardDef) && (world.get(e, billboardDef) as { enabled: boolean }).enabled) { this.refuse(app, state, e, 'billboard'); continue; }
            if (skinDef && world.has(e, skinDef)) { this.refuse(app, state, e, 'skinned'); continue; }
            if ((characterDef && world.has(e, characterDef))
                || (bodyDef && world.has(e, bodyDef) && (world.get(e, bodyDef) as { bodyType: number }).bodyType !== BodyType.Static)) {
                this.refuse(app, state, e, 'moves');
                continue;
            }
            if (probed) { this.refuse(app, state, e, 'baked'); continue; }

            if (!meshes.has(mr.mesh)) meshes.set(mr.mesh, await assets.readMeshData(mr.mesh));
            const mesh = meshes.get(mr.mesh) ?? null;
            if (!mesh) { this.refuse(app, state, e, 'no-mesh'); continue; }
            if (baked && mesh.channels.some((c) => c.semantic === MeshChannel.TexCoord1)) { this.refuse(app, state, e, 'baked'); continue; }
            const layout = layoutRefusal(mesh);
            if (layout) { this.refuse(app, state, e, layout); continue; }
            if (!world.valid(e)) continue;

            const t = world.get(e, Transform) as TransformData;
            const matrix = worldMatrix(t.worldPosition, t.worldRotation, t.worldScale);
            const scene = world.has(e, SceneOwner) ? (world.get(e, SceneOwner) as { scene: string }).scene : '';
            const cx = (mesh.aabbMin[0] + mesh.aabbMax[0]) / 2, cy = (mesh.aabbMin[1] + mesh.aabbMax[1]) / 2, cz = (mesh.aabbMin[2] + mesh.aabbMax[2]) / 2;
            const center: [number, number, number] = [
                matrix[0]! * cx + matrix[4]! * cy + matrix[8]! * cz + matrix[12]!,
                matrix[1]! * cx + matrix[5]! * cy + matrix[9]! * cz + matrix[13]!,
                matrix[2]! * cx + matrix[6]! * cy + matrix[10]! * cz + matrix[14]!,
            ];
            const key = staticBatchKey({
                material: mr.material, texture: mr.texture, normalMap: mr.normalMap, color: mr.color, layer: mr.layer,
                cullBackfaces: mr.cullBackfaces, lit: mr.lit, castShadows: mr.castShadows, parallax: mr.parallax, group: `${sb.group}@${scene}`,
            }, channelSignature(mesh.channels, mesh.vertexStride));
            candidates.push({ entity: e, key, center, vertices: mesh.vertexCount });
            info.set(e, { mr, mesh, world: matrix, scene });
        }

        const plan = planStaticBatches(candidates, state.limits);
        for (const e of plan.alone) this.refuse(app, state, e as Entity, 'alone');

        for (const batch of plan.batches) {
            const members = batch.entities.filter((e) => world.valid(e as Entity)) as Entity[];
            if (members.length < 2) { for (const e of members) this.refuse(app, state, e, 'alone'); continue; }
            const parts: BatchPart[] = members.map((e) => ({ mesh: info.get(e)!.mesh, world: info.get(e)!.world }));
            const merged = mergeMeshes(parts);
            const handle = assets.createMesh(merged);
            if (handle === 0) {
                log.warn('staticBatch', `the engine refused a merged mesh of ${members.length} parts (${merged.vertexCount} vertices)`);
                for (const e of members) this.refuse(app, state, e, 'layout');
                continue;
            }
            const head = info.get(members[0]!)!;
            const holder = world.spawn(`StaticBatch ${state.groups_.length + 1}`);
            world.insert(holder, Transform, {});
            world.insert(holder, MeshRenderer, { ...head.mr, mesh: handle, enabled: true });
            if (head.scene) world.insert(holder, SceneOwner, { scene: head.scene });
            for (const e of members) {
                const mr = world.get(e, MeshRenderer) as MeshRendererData;
                world.insert(e, MeshRenderer, { ...mr, enabled: false });
                state.seen_.add(e);
                this.stamp(app, e, StaticBatchState.Merged, members.length);
            }
            state.groups_.push({
                entity: holder, handle, parts: members,
                report: {
                    entity: holder, parts: members, vertices: merged.vertexCount, triangles: merged.indices.length / 3,
                    bytes: merged.vertices.byteLength + merged.indices.byteLength,
                    drawsBefore: drawsOf(members.map((e) => info.get(e)!.mesh)),
                },
            });
        }
    }

    /** Rebuild any group that lost a part (its scene unloaded, or the entity was destroyed). */
    private sweep(app: App, state: StaticBatching, assets: any): void {
        const world = app.world;
        for (let i = state.groups_.length - 1; i >= 0; i--) {
            const g = state.groups_[i]!;
            const alive = g.parts.filter((e) => world.valid(e));
            if (!world.valid(g.entity)) {
                assets.releaseBuiltMesh(g.handle);
                for (const e of alive) this.restore(world, e);
                state.groups_.splice(i, 1);
                continue;
            }
            if (alive.length === g.parts.length) continue;
            // A part went away: draw the rest from a smaller merge, or one by one when only one is left.
            state.busy_ = true;
            void this.shrink(app, state, assets, g, alive).finally(() => { state.busy_ = false; });
            return;
        }
    }

    private restore(world: App['world'], entity: Entity): void {
        const mr = world.tryGet(entity, MeshRenderer) as MeshRendererData | null;
        if (mr) world.insert(entity, MeshRenderer, { ...mr, enabled: true });
    }

    private async shrink(app: App, state: StaticBatching, assets: any, g: StaticBatchGroupState, alive: Entity[]): Promise<void> {
        const world = app.world;
        const index = state.groups_.indexOf(g);
        if (index < 0) return;
        if (alive.length < 2) {
            for (const e of alive) { this.restore(world, e); this.stamp(app, e, StaticBatchState.Alone, 0); }
            if (world.valid(g.entity)) world.despawn(g.entity);
            assets.releaseBuiltMesh(g.handle);
            state.groups_.splice(index, 1);
            return;
        }
        const meshes = new Map<number, MeshData | null>();
        const parts: BatchPart[] = [];
        for (const e of alive) {
            const handle = (world.get(e, MeshRenderer) as MeshRendererData).mesh;
            if (!meshes.has(handle)) meshes.set(handle, await assets.readMeshData(handle));
            const mesh = meshes.get(handle);
            if (!mesh || !world.valid(e)) continue;
            const t = world.get(e, Transform) as TransformData;
            parts.push({ mesh, world: worldMatrix(t.worldPosition, t.worldRotation, t.worldScale) });
        }
        if (parts.length !== alive.length || !world.valid(g.entity)) return;
        const merged = mergeMeshes(parts);
        const handle = assets.createMesh(merged);
        if (handle === 0) return;
        const holder = world.get(g.entity, MeshRenderer) as MeshRendererData;
        world.insert(g.entity, MeshRenderer, { ...holder, mesh: handle });
        assets.releaseBuiltMesh(g.handle);
        g.handle = handle;
        g.parts = alive;
        for (const e of alive) this.stamp(app, e, StaticBatchState.Merged, alive.length);
        g.report = {
            ...g.report, parts: alive, vertices: merged.vertexCount, triangles: merged.indices.length / 3,
            bytes: merged.vertices.byteLength + merged.indices.byteLength,
            drawsBefore: drawsOf(parts.map((p) => p.mesh)),
        };
    }

    /** Undo everything: parts draw themselves again, merged meshes are released. */
    private discardAll(app: App, state: StaticBatching): void {
        const world = app.world;
        const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
        for (const g of state.groups_) {
            for (const e of g.parts) if (world.valid(e)) this.restore(world, e);
            if (world.valid(g.entity)) world.despawn(g.entity);
            assets?.releaseBuiltMesh(g.handle);
        }
        state.groups_.length = 0;
        state.refused_.clear();
        state.seen_.clear();
    }
}

export const staticBatchPlugin: Plugin = new StaticBatchPlugin();
