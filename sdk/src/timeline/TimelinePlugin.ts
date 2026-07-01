// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { defineComponent, getComponent } from '../component';
import { playModeOnly } from '../env';
import { Audio, type AudioAPI } from '../audio/Audio';
import { wrapModeFromName, TrackType, type TimelineAsset, type AnimFramesTrack } from './TimelineTypes';
import { Timeline, TimelineApi } from './TimelineControl';
import { resolveChildEntity } from './TimelineRuntime';
import { advanceTimelineTS } from './TimelineDrive';
import type { SampleDeps } from './TimelineEvaluator';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    wrapMode: string;
}

export const TimelinePlayer = defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: 'once',
}, {
    assetFields: [{ field: 'timeline', type: 'timeline' }],
});

let activeTimelinePlugin: TimelinePlugin | null = null;

export function registerTimelineAsset(path: string, asset: TimelineAsset): void {
    activeTimelinePlugin?.registerAsset(path, asset);
}

export function getTimelineAsset(path: string): TimelineAsset | undefined {
    return activeTimelinePlugin?.getAsset(path);
}

export function registerTimelineTextureHandles(path: string, handles: Map<string, number>): void {
    activeTimelinePlugin?.registerTextureHandles(path, handles);
}

export function getTimelineTextureHandle(timelinePath: string, textureUuid: string): number {
    return activeTimelinePlugin?.getTextureHandle(timelinePath, textureUuid) ?? 0;
}

interface AnimFramesState {
    tracks: AnimFramesTrack[];
    lastFrameIndices: number[];
}

export class TimelinePlugin implements Plugin {
    name = 'timeline';

    private loadedAssets_ = new Map<string, TimelineAsset>();
    private textureHandles_ = new Map<string, Map<string, number>>();
    private animFramesStates_ = new Map<number, AnimFramesState>();

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
        activeTimelinePlugin = this;
        const world = app.world;
        app.insertResource(Timeline, new TimelineApi());

        world.onDespawn((entity: Entity) => {
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
                const deps: SampleDeps = {
                    world,
                    getComponent,
                    resolveChild: (root, childPath) => resolveChildEntity(world, root, childPath),
                };

                for (const entity of world.getEntitiesWithComponents([TimelinePlayer])) {
                    const player = world.get(entity, TimelinePlayer) as TimelinePlayerData;
                    if (!player.timeline) continue;
                    const asset = this.loadedAssets_.get(player.timeline);
                    if (!asset) continue;

                    const wrapMode = wrapModeFromName(player.wrapMode);
                    const state = tl.ensureState(entity, wrapMode, player.speed);
                    state.speed = player.speed;
                    state.wrapMode = wrapMode;
                    state.playing = player.playing;

                    this.ensureAnimFrames(entity, asset);

                    advanceTimelineTS(asset, entity, state, time.delta, { deps, audio });
                    this.processAnimFrames(world, entity, state.time, player.timeline);

                    // A clip that hit its end (Once) clears the component's play flag.
                    if (!state.playing && player.playing) {
                        player.playing = false;
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
        this.animFramesStates_.clear();
        this.loadedAssets_.clear();
        this.textureHandles_.clear();
        activeTimelinePlugin = null;
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
