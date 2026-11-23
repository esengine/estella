// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Sprite } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { TrackType, type AnimFramesTrack, type TimelineAsset } from './TimelineTypes';
import type { ChildResolver } from './timelineSequences';

interface PlayingTrack {
    track: AnimFramesTrack;
    lastTarget: Entity | null;
    lastFrame: number;
    lastTexture: number;
}

/** Half-open frame intervals, with the last frame held through the end of the timeline. */
function frameIndexAt(track: AnimFramesTrack, time: number): number {
    let end = 0;
    for (let i = 0; i < track.frames.length - 1; i++) {
        end += track.frames[i].duration ?? 1 / 12;
        if (time < end) return i;
    }
    return track.frames.length - 1;
}

/** Applied sprite frames belong to the player and the playable asset it sampled. */
export class TimelineSpriteFrames {
    private readonly players_ = new Map<Entity, { asset: TimelineAsset; tracks: PlayingTrack[] }>();

    sync(
        world: World, player: Entity, asset: TimelineAsset, time: number,
        handles: ReadonlyMap<string, number> | undefined, resolveChild: ChildResolver,
    ): void {
        for (const state of this.tracksFor_(player, asset)) {
            const { track } = state;
            const frame = frameIndexAt(track, time);
            const texture = frame >= 0 ? handles?.get(track.frames[frame].texture) : undefined;
            const target = track.childPath ? resolveChild(player, track.childPath) : player;
            if (!texture || target === null || !world.has(target, Sprite)) {
                state.lastTarget = null;
                continue;
            }
            if (state.lastTarget === target && state.lastFrame === frame && state.lastTexture === texture) continue;

            const sprite = world.get(target, Sprite);
            sprite.texture = texture;
            writeProjection(world, target, Sprite, sprite);
            state.lastTarget = target;
            state.lastFrame = frame;
            state.lastTexture = texture;
        }
    }

    forget(player: Entity): void { this.players_.delete(player); }
    clear(): void { this.players_.clear(); }

    private tracksFor_(player: Entity, asset: TimelineAsset): PlayingTrack[] {
        const cached = this.players_.get(player);
        if (cached?.asset === asset) return cached.tracks;
        const tracks: PlayingTrack[] = [];
        for (const track of asset.tracks) {
            if (track.type === TrackType.AnimFrames) {
                tracks.push({ track, lastTarget: null, lastFrame: -1, lastTexture: 0 });
            }
        }
        this.players_.set(player, { asset, tracks });
        return tracks;
    }
}
