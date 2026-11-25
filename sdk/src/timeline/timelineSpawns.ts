// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineSpawns.ts
 * @brief   Spawn tracks: entities a timeline makes from a prefab for as long as the playhead is inside a clip.
 *
 * @details A spawn clip names a prefab and what to call what
 *          it makes; while the playhead is inside the clip an instance exists, under the entity the track names, and
 *          when the playhead leaves it (or the timeline is stopped, or its player goes) the instance is taken away. The
 *          instance is named, so the timeline's other tracks address it by that name like any child: a dragon a cut
 *          scene brings in is animated, moved and filmed by the same tracks as one placed in the scene.
 *
 *          Each frame the instances a player should have are compared with the ones it has, as audio clips are. The
 *          loader prepares a saved timeline's prefabs with its scene settings. A code timeline or editor preview
 *          prepares them per player. A ready instance appears before other tracks address it on that frame.
 *          An asynchronous spawn is kept only while its original clip is still active.
 */
import { TrackType, timelineSpawnPrefabRefs, type PublishedTimeline, type SpawnClip, type TimelineAsset } from './TimelineTypes';
import type { PreparedPrefab } from '../prefab/preparedPrefab';
import type { Entity } from '../types';
import { disposeAll } from '../util/disposeAll';

/** A prefab loaded ahead of its first spawn: held until released, and made on the spot while it is. */
export interface PreparedTimelineSpawn {
    release(): void;
    /** Makes it now under `parent` (null: a root) named `name`; its root, or null where it cannot be made. */
    spawn?(parent: Entity | null, name: string): Entity | null;
}

/** How a spawn track makes and takes away its instances: the game's prefab server, or the editor's preview. */
export interface TimelineSpawner {
    /** Makes `prefab` under `parent` (null: a root) named `name`; its root, or null where it cannot be made. */
    spawn(prefab: string, parent: Entity | null, name: string, player?: Entity): Promise<Entity | null>;
    /** Makes an instance synchronously from a recipe held by the timeline publication. */
    spawnPrepared?(recipe: PreparedPrefab, parent: Entity | null, name: string, player: Entity): Entity | null;
    /** Takes an instance away, with everything under it. */
    despawn(entity: Entity): void;
    /** Loads `prefab` and what it uses ahead of its first spawn; what it answers is released when no longer wanted. */
    prepare?(prefab: string, player?: Entity): Promise<PreparedTimelineSpawn>;
}

/** Whether `clip` has an instance at track time `time`: from its start up to (not including) its end. */
export const spawnClipActive = (clip: SpawnClip, time: number): boolean =>
    clip.duration > 0 && time >= clip.start && time < clip.start + clip.duration;

interface Instance {
    entity: Entity | null;
    /** A failed authored spawn may be retried when its recipe changes. Null means the recipe was missing. */
    failedRecipe?: PreparedPrefab | null;
}

interface PlayerPreparations {
    key: string;
    byPrefab: Map<string, PreparedTimelineSpawn | null>;
    pending: Map<string, symbol>;
}

/** The instances of every playing timeline's spawn tracks, by player. */
export class TimelineSpawns {
    private readonly live_ = new Map<Entity, Map<string, Instance>>();
    /** What each player's timeline spawns, loaded or loading: by prefab, null until it lands. */
    private readonly prepared_ = new Map<Entity, PlayerPreparations>();

    /**
     * Brings `player`'s instances in line with `asset` at `time`: each spawn clip the playhead is inside has one, under
     * the entity its track names. A stopped player (`time === null`) only prepares its resources.
     */
    sync(
        player: Entity, asset: TimelineAsset, time: number | null, spawner: TimelineSpawner,
        resolve: (childPath: string) => Entity | null,
        prefabs?: PublishedTimeline['prefabs'],
    ): void {
        const ready = prefabs ? undefined : this.prepare(player, asset, spawner);
        if (prefabs) this.releasePreparations(player);
        if (time === null) { this.stop(player, spawner); return; }
        let live = this.live_.get(player);
        const want = new Map<string, { clip: SpawnClip; parent: Entity | null }>();
        asset.tracks.forEach((track, ti) => {
            if (track.type !== TrackType.Spawn) return;
            track.clips.forEach((clip, ci) => {
                if (!clip.prefab || !spawnClipActive(clip, time)) return;
                const parent = resolve(track.childPath);
                if (parent == null && track.childPath) return;
                // Keyed by what makes it, so an edit that changes the prefab, the name or the parent makes a new one.
                want.set(`${ti}:${ci}:${clip.prefab}:${clip.name}:${parent ?? ''}`, { clip, parent });
            });
        });
        if (live) {
            for (const [key, inst] of live) {
                if (want.has(key)) continue;
                if (inst.entity !== null) spawner.despawn(inst.entity);
                live.delete(key);
            }
        }
        if (want.size === 0) return;
        if (!live) this.live_.set(player, (live = new Map()));
        for (const [key, { clip, parent }] of want) {
            const recipe = prefabs ? prefabs.get(clip.prefab) ?? null : undefined;
            const previous = live.get(key);
            if (previous && (previous.entity !== null || previous.failedRecipe === recipe)) continue;
            const inst: Instance = { entity: null };
            live.set(key, inst);
            if (recipe !== undefined) {
                try {
                    if (recipe && spawner.spawnPrepared) inst.entity = spawner.spawnPrepared(recipe, parent, clip.name, player);
                } catch { /* An unspawnable prefab leaves this clip empty. */ }
                if (inst.entity === null) inst.failedRecipe = recipe;
                continue;
            }
            const now = ready?.get(clip.prefab);
            if (now?.spawn) {
                try { inst.entity = now.spawn(parent, clip.name); } catch { inst.entity = null; }
                continue;
            }
            void spawner.spawn(clip.prefab, parent, clip.name, player).then((entity) => {
                if (entity === null) return;
                if (this.live_.get(player)?.get(key) !== inst) { spawner.despawn(entity); return; }
                inst.entity = entity;
            }, () => { /* a prefab that cannot be made leaves the clip empty */ });
        }
    }

    /** Takes away every instance of `player` (what was prepared for it is kept, for when it plays again). */
    stop(player: Entity, spawner: TimelineSpawner | null): void {
        const live = this.live_.get(player);
        if (!live) return;
        for (const inst of live.values()) {
            if (inst.entity !== null) spawner?.despawn(inst.entity);
        }
        this.live_.delete(player);
    }

    /** Takes away every instance of `player` and lets go of what was prepared for it: the player or its timeline went. */
    forget(player: Entity, spawner: TimelineSpawner | null): void {
        this.stop(player, spawner);
        this.releasePreparations(player);
    }

    private releasePreparations(player: Entity): void {
        const held = this.prepared_.get(player);
        if (!held) return;
        this.prepared_.delete(player);
        held.pending.clear();
        const prepared = [...held.byPrefab.values()];
        held.byPrefab.clear();
        disposeAll(prepared, p => p?.release());
    }

    /** Forgets every player. */
    stopAll(spawner: TimelineSpawner | null): void {
        for (const player of [...this.live_.keys(), ...this.prepared_.keys()]) this.forget(player, spawner);
    }

    /** The entities `player` has spawned and still has. */
    instancesOf(player: Entity): Entity[] {
        return [...(this.live_.get(player)?.values() ?? [])].flatMap((i) => (i.entity !== null ? [i.entity] : []));
    }

    /**
     * Starts loading what `asset` spawns for `player`, once per set of prefabs (a changed set lets go of the old one);
     * answers what has landed so far. Called every frame a player has its timeline, so loading starts before it plays.
     */
    prepare(player: Entity, asset: TimelineAsset, spawner: TimelineSpawner): ReadonlyMap<string, PreparedTimelineSpawn | null> {
        const prefabs = timelineSpawnPrefabRefs(asset);
        const key = [...prefabs].sort().join('\n');
        let held = this.prepared_.get(player);
        if (held?.key === key) return held.byPrefab;
        if (held) held.key = key;
        else {
            held = { key, byPrefab: new Map(), pending: new Map() };
            this.prepared_.set(player, held);
        }
        const { byPrefab, pending } = held;
        for (const [prefab, prepared] of byPrefab) {
            if (prefabs.has(prefab)) continue;
            byPrefab.delete(prefab);
            pending.delete(prefab);
            prepared?.release();
        }
        if (!spawner.prepare) return byPrefab;
        for (const prefab of prefabs) {
            if (byPrefab.has(prefab)) continue;
            byPrefab.set(prefab, null);
            const request = Symbol();
            pending.set(prefab, request);
            void spawner.prepare(prefab, player).then((p) => {
                if (pending.get(prefab) !== request) { p.release(); return; }
                pending.delete(prefab);
                byPrefab.set(prefab, p);
            }, () => {
                if (pending.get(prefab) !== request) return;
                pending.delete(prefab);
                byPrefab.delete(prefab);
            });
        }
        return byPrefab;
    }
}
