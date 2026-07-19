// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { defineComponent, getComponent } from '../component';
import { playModeOnly } from '../env';
import { Assets } from '../asset/AssetPlugin';
import { resolveAssetKey } from '../asset/resolveAssetKey';
import { Audio, type AudioAPI } from '../audio/Audio';
import { wrapModeFromName, TrackType, type TimelineAsset, type AnimFramesTrack } from './TimelineTypes';
import { Timeline, TimelineAPI } from './TimelineControl';
import { resolveChildEntity } from './TimelineRuntime';
import { advanceTimelineTS, applyPlayerFlags, latchPlayerFinish } from './TimelineDrive';
import type { SampleDeps } from './TimelineEvaluator';
import {
    setActiveTimelineAssetRegistry,
    getTimelineTextureHandle,
    type TimelineAssetRegistry,
} from './TimelineAssetRegistry';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    wrapMode: string;
    /**
     * Latched true when a Once clip completes; cleared when `playing` is raised
     * again (which replays from the top). Runtime-observable — don't author it.
     */
    finished: boolean;
}

export const TimelinePlayer = defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: 'once',
    finished: false,
}, {
    assetFields: [{ field: 'timeline', type: 'timeline' }],
    fields: {
        finished: { advanced: true, tooltip: 'Clip completed (runtime, read-only). Raise Playing to replay.' },
    },
});

interface AnimFramesState {
    tracks: AnimFramesTrack[];
    lastFrameIndices: number[];
}

export class TimelinePlugin implements Plugin, TimelineAssetRegistry {
    name = 'timeline';

    private loadedAssets_ = new Map<string, TimelineAsset>();
    private textureHandles_ = new Map<string, Map<string, number>>();
    private animFramesStates_ = new Map<number, AnimFramesState>();
    private offDespawn_: (() => void) | null = null;

    registerAsset(path: string, asset: TimelineAsset): void {
        this.loadedAssets_.set(path, asset);
    }

    getAsset(path: string): TimelineAsset | undefined {
        return this.loadedAssets_.get(path);
    }

    registerTextureHandles(path: string, handles: Map<string, number>): void {
        this.textureHandles_.set(path, handles);
    }

    getTextureHandle(timelinePath: string, textureUuid: string): number {
        return this.textureHandles_.get(timelinePath)?.get(textureUuid) ?? 0;
    }

    build(app: App): void {
        setActiveTimelineAssetRegistry(this);
        const world = app.world;

        // The api's play/pause/stop write through to the component flags (the
        // authoritative channel this system reconciles from — see PlayerFlagChannel).
        const setFlags = (entity: Entity, playing: boolean, clearFinished: boolean): void => {
            if (!world.has(entity, TimelinePlayer)) return;
            const player = world.get(entity, TimelinePlayer) as TimelinePlayerData;
            if (player.playing === playing && !(clearFinished && player.finished)) return;
            player.playing = playing;
            if (clearFinished) player.finished = false;
            world.insert(entity, TimelinePlayer, player);
        };
        app.insertResource(Timeline, new TimelineAPI({
            raise: entity => setFlags(entity, true, false),
            lower: entity => setFlags(entity, false, false),
            reset: entity => setFlags(entity, false, true),
        }));

        this.offDespawn_ = world.onDespawn((entity: Entity) => {
            app.getResource(Timeline).removeState(entity);
            this.animFramesStates_.delete(entity);
        });

        // The timeline runs entirely in TS: a per-entity
        // clock + the shared evaluator (property tracks) + edge-detected event
        // dispatch — no wasm timeline, no upload, no per-frame poll. Property writes
        // land via world.set (the same path the editor preview uses).
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                const tl = app.getResource(Timeline);
                const audio: AudioAPI | null = app.hasResource(Audio) ? app.getResource(Audio) : null;
                const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
                const deps: SampleDeps = {
                    world,
                    getComponent,
                    resolveChild: (root, childPath) => resolveChildEntity(world, root, childPath),
                };

                for (const entity of world.getEntitiesWithComponents([TimelinePlayer])) {
                    const player = world.get(entity, TimelinePlayer) as TimelinePlayerData;
                    if (!player.timeline) continue;
                    // The loader keys loadedAssets_/textureHandles_ by the RESOLVED
                    // path; the component holds the authored ref (see resolveAssetKey).
                    const timelineKey = resolveAssetKey(assets, player.timeline);
                    const asset = this.loadedAssets_.get(timelineKey) ?? this.loadedAssets_.get(player.timeline);
                    if (!asset) continue;

                    const wrapMode = wrapModeFromName(player.wrapMode);
                    const state = tl.ensureState(entity, wrapMode, player.speed);
                    state.speed = player.speed;
                    state.wrapMode = wrapMode;
                    const rewound = applyPlayerFlags(player, state);

                    this.ensureAnimFrames(entity, asset);

                    const justFinished = advanceTimelineTS(asset, entity, state, time.delta, { deps, audio });
                    this.processAnimFrames(world, entity, state.time, timelineKey);

                    if (latchPlayerFinish(player, state, justFinished) || rewound) {
                        world.insert(entity, TimelinePlayer, player);
                    }
                }
            },
            { name: 'TimelineSystem' },
        ), { runIf: playModeOnly });
    }

    clearHandles(): void {
        this.animFramesStates_.clear();
    }

    cleanup(): void {
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.animFramesStates_.clear();
        this.loadedAssets_.clear();
        this.textureHandles_.clear();
        setActiveTimelineAssetRegistry(null);
    }

    private ensureAnimFrames(entity: Entity, asset: TimelineAsset): void {
        if (this.animFramesStates_.has(entity)) return;
        const afTracks = asset.tracks.filter(
            (t): t is AnimFramesTrack => t.type === TrackType.AnimFrames,
        );
        if (afTracks.length > 0) {
            this.animFramesStates_.set(entity, {
                tracks: afTracks,
                lastFrameIndices: afTracks.map(() => -1),
            });
        }
    }

    private processAnimFrames(
        world: any, entity: Entity, currentTime: number, timelinePath: string,
    ): void {
        const state = this.animFramesStates_.get(entity);
        if (!state) return;

        const Sprite = getComponent('Sprite');
        if (!Sprite || !world.has(entity, Sprite)) return;

        const DEFAULT_DURATION = 1.0 / 12;

        for (let t = 0; t < state.tracks.length; t++) {
            const frames = state.tracks[t].frames;
            if (frames.length === 0) continue;

            let elapsed = 0;
            let frameIndex = 0;
            for (let i = 0; i < frames.length; i++) {
                const dur = frames[i].duration ?? DEFAULT_DURATION;
                if (currentTime < elapsed + dur) {
                    frameIndex = i;
                    break;
                }
                elapsed += dur;
                if (i === frames.length - 1) {
                    frameIndex = frames.length - 1;
                }
            }

            if (frameIndex !== state.lastFrameIndices[t]) {
                state.lastFrameIndices[t] = frameIndex;
                const textureHandle = getTimelineTextureHandle(timelinePath, frames[frameIndex].texture);
                if (textureHandle) {
                    const sprite = world.get(entity, Sprite);
                    sprite.texture = textureHandle;
                    world.set(entity, Sprite, sprite);
                }
            }
        }
    }
}

export const timelinePlugin = new TimelinePlugin();
