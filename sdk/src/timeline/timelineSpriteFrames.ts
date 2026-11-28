// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Sprite } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import { setSpriteFrameTexture } from '../animation/spriteFrameProjection';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { TrackType, type AnimFramesTrack, type PublishedTimeline, type TimelineAsset } from './TimelineTypes';
import { collectSequenceLayers, type ChildResolver, type SequenceLayer } from './timelineSequences';

type FramePublication = Pick<PublishedTimeline, 'asset'> & Partial<Pick<PublishedTimeline, 'textureHandles'>>;

interface FrameSample {
    track: AnimFramesTrack;
    layer: string;
    frame: number;
    texture: number;
    incarnation: number;
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

/** Resolve the last usable track on each target before projecting any frames. */
export class TimelineSpriteFrames {
    private tracks_ = new WeakMap<TimelineAsset, { frames: AnimFramesTrack[]; nested: boolean }>();
    private readonly players_ = new Map<Entity, { asset: TimelineAsset; samples: Map<Entity, FrameSample> }>();
    private lifetime_: symbol | null = null;

    sync(
        world: World, player: Entity, asset: TimelineAsset, time: number,
        handles: ReadonlyMap<string, number> | undefined, resolveChild: ChildResolver,
        lookup: (ref: string) => FramePublication | undefined,
        resolvedLayers?: readonly SequenceLayer[],
    ): void {
        const tracks = this.tracksFor_(asset);
        if ((!tracks.nested || resolvedLayers?.length === 0) && (!tracks.frames.length || !handles?.size)) {
            this.players_.delete(player);
            return;
        }
        const lifetime = world.entityLifetime;
        if (this.lifetime_ !== lifetime) {
            this.players_.clear();
            this.lifetime_ = lifetime;
            world.enableIncarnationTracking(Sprite);
        }

        const samples = new Map<Entity, FrameSample>();
        const sample = (root: Entity, layer: string, frames: readonly AnimFramesTrack[], localTime: number, textures?: ReadonlyMap<string, number>) => {
            if (!textures?.size) return;
            for (const track of frames) {
                const frame = frameIndexAt(track, localTime);
                const texture = frame >= 0 ? textures.get(track.frames[frame].texture) : undefined;
                if (!texture) continue;
                const target = track.childPath ? resolveChild(root, track.childPath) : root;
                if (target === null || !world.has(target, Sprite)) continue;
                samples.set(target, { track, layer, frame, texture, incarnation: world.getComponentIncarnation(target, Sprite) });
            }
        };
        sample(player, '', tracks.frames, time, handles);
        if (tracks.nested && resolvedLayers?.length !== 0) {
            const publications = new Map<string, FramePublication | undefined>();
            const publicationFor = (ref: string) => {
                if (!publications.has(ref)) publications.set(ref, lookup(ref));
                return publications.get(ref);
            };
            const layers = resolvedLayers ?? collectSequenceLayers(asset, time, player, resolveChild, ref => publicationFor(ref)?.asset);
            for (const layer of layers) {
                sample(layer.root, layer.key, this.tracksFor_(layer.asset).frames, layer.time, publicationFor(layer.ref)?.textureHandles);
            }
        }

        const previous = this.players_.get(player);
        for (const [target, frame] of samples) {
            const last = previous?.asset === asset ? previous.samples.get(target) : undefined;
            if (last && last.track === frame.track && last.layer === frame.layer && last.frame === frame.frame
                && last.texture === frame.texture && last.incarnation === frame.incarnation) continue;
            // A projection observer can replace another target while applying this batch.
            const sprite = world.getComponentIncarnation(target, Sprite) === frame.incarnation ? world.tryGet(target, Sprite) : null;
            if (!sprite) { samples.delete(target); continue; }
            setSpriteFrameTexture(sprite, frame.texture);
            writeProjection(world, target, Sprite, sprite);
        }
        if (samples.size) this.players_.set(player, { asset, samples });
        else this.players_.delete(player);
    }

    forget(player: Entity): void { this.players_.delete(player); }
    clear(): void {
        this.players_.clear();
        this.tracks_ = new WeakMap();
    }

    private tracksFor_(asset: TimelineAsset) {
        const cached = this.tracks_.get(asset);
        if (cached) return cached;
        const frames: AnimFramesTrack[] = [];
        let nested = false;
        for (const track of asset.tracks ?? []) {
            if (track.type === TrackType.AnimFrames) frames.push(track);
            else if (track.type === TrackType.Sequence) nested = true;
        }
        const tracks = { frames, nested };
        this.tracks_.set(asset, tracks);
        return tracks;
    }
}
