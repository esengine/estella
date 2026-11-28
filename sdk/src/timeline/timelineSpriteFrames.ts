// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Sprite } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import { setSpriteFrameTexture } from '../animation/spriteFrameProjection';
import { atlasFrameUv, type AtlasFrameInfo } from '../asset/Catalog';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { TrackType, type AnimFramesTrack, type PublishedTimeline, type TimelineAsset } from './TimelineTypes';
import { collectSequenceLayers, type ChildResolver, type SequenceLayer } from './timelineSequences';

type FramePublication = Pick<PublishedTimeline, 'asset'> & Partial<Pick<PublishedTimeline, 'textureHandles' | 'textureAtlases'>>;

/** @experimental */
export interface TimelineFrameImage {
    texture: number;
    atlas?: AtlasFrameInfo | null;
}

/** @experimental */
export interface TimelineSpriteFrame extends TimelineFrameImage {
    track: AnimFramesTrack;
    layer: string;
    frame: number;
}

interface AppliedFrame extends TimelineSpriteFrame { incarnation: number }

/** Half-open frame intervals, with the last frame held through the end of the timeline. */
function frameIndexAt(track: AnimFramesTrack, time: number): number {
    let end = 0;
    for (let i = 0; i < track.frames.length - 1; i++) {
        end += track.frames[i].duration ?? 1 / 12;
        if (time < end) return i;
    }
    return track.frames.length - 1;
}

/** Sample the last drawable frame for each target, including active nested timelines. @experimental */
export function sampleTimelineSpriteFrames(
    asset: TimelineAsset, time: number, root: Entity, resolveChild: ChildResolver,
    textureFor: (ref: string, layer?: SequenceLayer) => TimelineFrameImage | undefined,
    accepts: (entity: Entity) => boolean, layers: readonly SequenceLayer[] = [],
): Map<Entity, TimelineSpriteFrame> {
    const samples = new Map<Entity, TimelineSpriteFrame>();
    const sample = (source: TimelineAsset, targetRoot: Entity, localTime: number, layer?: SequenceLayer) => {
        for (const track of source.tracks ?? []) {
            if (track.type !== TrackType.AnimFrames || track.muted) continue;
            const frame = frameIndexAt(track, localTime);
            if (frame < 0) continue;
            const target = track.childPath ? resolveChild(targetRoot, track.childPath) : targetRoot;
            if (target === null || !accepts(target)) continue;
            const image = textureFor(track.frames[frame].texture, layer);
            if (image?.texture) samples.set(target, { ...image, track, layer: layer?.key ?? '', frame });
        }
    };
    sample(asset, root, time);
    for (const layer of layers) sample(layer.asset, layer.root, layer.time, layer);
    return samples;
}

/** Apply a sampled image and its atlas window, preserving unrelated Sprite fields. @experimental */
export function projectTimelineSpriteFrame(world: World, target: Entity, image: TimelineFrameImage): boolean {
    const sprite = world.tryGet(target, Sprite);
    if (!sprite) return false;
    const uv = image.atlas ? atlasFrameUv(image.atlas) : undefined;
    setSpriteFrameTexture(sprite, image.texture, uv?.uvOffset, uv?.uvScale);
    writeProjection(world, target, Sprite, sprite);
    return true;
}

/** Resolve the last usable track on each target before projecting any frames. */
export class TimelineSpriteFrames {
    private tracks_ = new WeakMap<TimelineAsset, { frames: boolean; nested: boolean }>();
    private readonly players_ = new Map<Entity, { asset: TimelineAsset; samples: Map<Entity, AppliedFrame> }>();
    private lifetime_: symbol | null = null;

    sync(
        world: World, player: Entity, asset: TimelineAsset, time: number,
        source: FramePublication, resolveChild: ChildResolver,
        lookup: (ref: string) => FramePublication | undefined,
        resolvedLayers?: readonly SequenceLayer[],
    ): void {
        const tracks = this.tracksFor_(asset);
        if ((!tracks.nested || resolvedLayers?.length === 0) && (!tracks.frames || !source.textureHandles?.size)) {
            this.players_.delete(player);
            return;
        }
        const lifetime = world.entityLifetime;
        if (this.lifetime_ !== lifetime) {
            this.players_.clear();
            this.lifetime_ = lifetime;
            world.enableIncarnationTracking(Sprite);
        }

        const publications = new Map<string, FramePublication | undefined>();
        const publicationFor = (ref: string) => {
            if (!publications.has(ref)) publications.set(ref, lookup(ref));
            return publications.get(ref);
        };
        const layers = tracks.nested ? resolvedLayers ?? collectSequenceLayers(asset, time, player, resolveChild, ref => publicationFor(ref)?.asset) : [];
        const sampled = sampleTimelineSpriteFrames(asset, time, player, resolveChild, (ref, layer) => {
            const publication = layer ? publicationFor(layer.ref) : source;
            const texture = publication?.textureHandles?.get(ref);
            return texture ? { texture, atlas: publication?.textureAtlases?.get(ref) } : undefined;
        }, target => world.has(target, Sprite), layers);
        const previous = this.players_.get(player);
        const samples = previous?.asset === asset ? previous.samples : new Map<Entity, AppliedFrame>();
        for (const [target, frame] of sampled) {
            const incarnation = world.getComponentIncarnation(target, Sprite);
            const last = samples.get(target);
            if (last && last.track === frame.track && last.layer === frame.layer && last.frame === frame.frame
                && last.texture === frame.texture && last.atlas === frame.atlas && last.incarnation === incarnation) continue;
            if (projectTimelineSpriteFrame(world, target, frame)) samples.set(target, { ...frame, incarnation });
            else samples.delete(target);
        }
        for (const target of samples.keys()) if (!sampled.has(target)) samples.delete(target);
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
        let frames = false;
        let nested = false;
        for (const track of asset.tracks ?? []) {
            if (track.type === TrackType.AnimFrames) frames = true;
            else if (track.type === TrackType.Sequence) nested = true;
        }
        const tracks = { frames, nested };
        this.tracks_.set(asset, tracks);
        return tracks;
    }
}
