// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineSpawns.ts
 * @brief   Spawn tracks: entities a timeline makes from a prefab for as long as the playhead is inside a clip.
 *
 * @details UE's spawnables and the prefab of Unity's Control track. A spawn clip names a prefab and what to call what
 *          it makes; while the playhead is inside the clip an instance exists, under the entity the track names, and
 *          when the playhead leaves it (or the timeline is stopped, or its player goes) the instance is taken away. The
 *          instance is named, so the timeline's other tracks address it by that name like any child: a dragon a cut
 *          scene brings in is animated, moved and filmed by the same tracks as one placed in the scene.
 *
 *          Each frame the instances a player should have are compared with the ones it has, as audio clips are. Making
 *          one is asynchronous (the prefab may still be loading), so a clip's instance is asked for once and kept when
 *          it arrives only if the playhead is still inside the clip. The prefabs a timeline spawns are prepared when
 *          its player first plays, so an instance appears on the frame its clip starts rather than when its files land.
 */
import { TrackType, type SpawnClip, type TimelineAsset } from './TimelineTypes';
import type { Entity } from '../types';

/** How a spawn track makes and takes away its instances: the game's prefab server, or the editor's preview. */
export interface TimelineSpawner {
    /** Makes `prefab` under `parent` (null: a root) named `name`; its root, or null where it cannot be made. */
    spawn(prefab: string, parent: Entity | null, name: string): Promise<Entity | null>;
    /** Takes an instance away, with everything under it. */
    despawn(entity: Entity): void;
    /** Loads `prefab` and what it uses ahead of its first spawn; what it answers is released when no longer wanted. */
    prepare?(prefab: string): Promise<{ release(): void }>;
}

/** Whether `clip` has an instance at track time `time`: from its start up to (not including) its end. */
export const spawnClipActive = (clip: SpawnClip, time: number): boolean =>
    clip.duration > 0 && time >= clip.start && time < clip.start + clip.duration;

interface Instance {
    entity: Entity | null;
    /** Still wanted once it arrives; cleared when the playhead leaves the clip before it does. */
    wanted: boolean;
}

/** The instances of every playing timeline's spawn tracks, by player. */
export class TimelineSpawns {
    private readonly live_ = new Map<Entity, Map<string, Instance>>();
    private readonly prepared_ = new Map<Entity, { release(): void }[]>();

    /**
     * Brings `player`'s instances in line with `asset` at `time`: each spawn clip the playhead is inside has one, under
     * the entity its track names (`resolve`, null where that is not there: no instance then).
     */
    sync(
        player: Entity, asset: TimelineAsset, time: number, spawner: TimelineSpawner,
        resolve: (childPath: string) => Entity | null,
    ): void {
        let live = this.live_.get(player);
        if (!this.prepared_.has(player)) this.prepare(player, asset, spawner);
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
                inst.wanted = false;
                if (inst.entity !== null) spawner.despawn(inst.entity);
                live.delete(key);
            }
        }
        if (want.size === 0) return;
        if (!live) this.live_.set(player, (live = new Map()));
        for (const [key, { clip, parent }] of want) {
            if (live.has(key)) continue;
            const inst: Instance = { entity: null, wanted: true };
            live.set(key, inst);
            const map = live;
            void spawner.spawn(clip.prefab, parent, clip.name).then((entity) => {
                if (entity === null) return;
                if (!inst.wanted || map.get(key) !== inst) { spawner.despawn(entity); return; }
                inst.entity = entity;
            }, () => { /* a prefab that cannot be made leaves the clip empty */ });
        }
    }

    /** Takes away every instance of `player`, and lets go of what was prepared for it. */
    stop(player: Entity, spawner: TimelineSpawner | null): void {
        const live = this.live_.get(player);
        if (live) {
            for (const inst of live.values()) {
                inst.wanted = false;
                if (inst.entity !== null) spawner?.despawn(inst.entity);
            }
            this.live_.delete(player);
        }
        for (const p of this.prepared_.get(player) ?? []) p.release();
        this.prepared_.delete(player);
    }

    /** Takes away every instance of every player. */
    stopAll(spawner: TimelineSpawner | null): void {
        for (const player of [...this.live_.keys(), ...this.prepared_.keys()]) this.stop(player, spawner);
    }

    /** The entities `player` has spawned and still has. */
    instancesOf(player: Entity): Entity[] {
        return [...(this.live_.get(player)?.values() ?? [])].flatMap((i) => (i.entity !== null ? [i.entity] : []));
    }

    private prepare(player: Entity, asset: TimelineAsset, spawner: TimelineSpawner): void {
        const held: { release(): void }[] = [];
        this.prepared_.set(player, held);
        if (!spawner.prepare) return;
        const prefabs = new Set<string>();
        for (const t of asset.tracks) if (t.type === TrackType.Spawn) for (const c of t.clips) if (c.prefab) prefabs.add(c.prefab);
        for (const prefab of prefabs) {
            void spawner.prepare(prefab).then((p) => {
                if (this.prepared_.get(player) === held) held.push(p); else p.release();
            }, () => { /* spawned unprepared, then */ });
        }
    }
}
