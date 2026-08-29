// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import { defineComponent, getComponent } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { Audio, type AudioAPI } from '../audio/Audio';
import { wrapModeFromName, isWrapModeName, TrackType, WrapMode, type TimelineAsset,
         type AnimFramesTrack, type PublishedTimeline } from './TimelineTypes';
import { Timeline, TimelineAPI } from './TimelineControl';
import { resolveChildEntity } from './TimelineRuntime';
import { advanceTimelineTS, applyPlayerFlags, latchPlayerFinish } from './TimelineDrive';
import type { SampleDeps } from './TimelineEvaluator';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    /** Overrides the wrap mode the CLIP declares; empty means the clip's own. */
    wrapMode: string;
    /**
     * Latched true when a Once clip completes; cleared when `playing` is raised
     * again (which replays from the top). Runtime-observable — don't author it.
     */
    finished: boolean;
}

/**
 * Which wrap mode a playing clip runs under: the CLIP's, unless the player names
 * one to override it with. A string that is not a wrap mode name is a typo, not
 * a choice, and leaves the clip's own mode standing.
 */
export function resolveWrapMode(playerWrapMode: string, assetWrapMode: WrapMode): WrapMode {
    return isWrapModeName(playerWrapMode) ? wrapModeFromName(playerWrapMode) : assetWrapMode;
}

export const TimelinePlayer = defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: '',
    finished: false,
}, {
    assetFields: [{ field: 'timeline', type: 'timeline' }],
    fields: {
        wrapMode: { tooltip: "Override the clip's own wrap mode: once, loop or pingPong. Empty uses what the clip declares." },
        finished: { advanced: true, tooltip: 'Clip completed (runtime, read-only). Raise Playing to replay.' },
    },
});

interface AnimFramesState {
    tracks: AnimFramesTrack[];
    lastFrameIndices: number[];
}

export class TimelinePlugin implements Plugin {
    name = 'timeline';

    private animFramesStates_ = new Map<number, AnimFramesState>();
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
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
        // A `.estimeline` comes from THIS app's realm; a code registration wins.
        app.getResource(Timeline).useAssetTimelines(
            (ref) => (app.hasResource(Assets)
                ? app.getResource(Assets).resolveRegistryAsset<PublishedTimeline>('timeline', ref)?.asset
                : undefined),
        );

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
                    // A code registration first, then this app's realm — by the
                    // ref the component carries, since the slot answers to that
                    // spelling as well as to the path it resolved to.
                    const asset = tl.getAsset(player.timeline);
                    if (!asset) continue;
                    const published = assets?.resolveRegistryAsset<PublishedTimeline>(
                        'timeline', player.timeline,
                    );

                    const wrapMode = resolveWrapMode(player.wrapMode, asset.wrapMode);
                    const state = tl.ensureState(entity, wrapMode, player.speed);
                    state.speed = player.speed;
                    state.wrapMode = wrapMode;
                    const rewound = applyPlayerFlags(player, state);

                    this.ensureAnimFrames(entity, asset);

                    const justFinished = advanceTimelineTS(asset, entity, state, time.delta, { deps, audio });
                    this.processAnimFrames(world, entity, state.time, published?.textureHandles);

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
        world: any, entity: Entity, currentTime: number,
        textureHandles: ReadonlyMap<string, number> | undefined,
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
                const textureHandle = textureHandles?.get(frames[frameIndex].texture) ?? 0;
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
