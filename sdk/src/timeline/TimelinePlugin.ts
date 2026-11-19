// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { SystemLabel } from '../ecs/systemLabels';
import { Res } from '../ecs/resource';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { TimelineEvent, TimelinePlayback, type TimelineEventPayload, type TimelinePlaybackPayload } from './timelineEvents';
import { TimelineAudioVoices } from './timelineAudio';
import { TimelineSpawns, type TimelineSpawner } from './timelineSpawns';
import { Prefabs } from '../prefab/prefabServer';
import { Name } from '../ecs/component';
import { resolveTimelinePath } from './timelineBindings';
import { installTimeDilation } from './timeDilation';
import { Time, type TimeData } from '../ecs/resource';
import { getComponent } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { Audio, type AudioAPI } from '../audio/Audio';
import { TrackType, type TimelineAsset,
         type AnimFramesTrack, type PublishedTimeline } from './TimelineTypes';
import { TimelinePlayer, resolveWrapMode, type TimelinePlayerData } from './TimelinePlayerComponent';
import { Timeline, TimelineAPI } from './TimelineControl';
import { AnimatorController } from '../animation/Animator';
import { TIMELINE_MOTION, createTimelineMotionDriver } from './timelineMotion';
import { Particle } from '../particle/ParticleAPI';
import { advanceTimelineTS, applyPlayerFlags, latchPlayerFinish } from './TimelineDrive';
import { CameraDirector, setTimelineShot } from '../camera/CameraDirector';
import type { SampleDeps } from './TimelineEvaluator';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';
export { TimelinePlayer, resolveWrapMode, type TimelinePlayerData } from './TimelinePlayerComponent';

interface AnimFramesState {
    tracks: AnimFramesTrack[];
    lastFrameIndices: number[];
}

export class TimelinePlugin implements Plugin {
    name = 'timeline';

    private animFramesStates_ = new Map<number, AnimFramesState>();
    private offDespawn_: (() => void) | null = null;
    /** Each player's state as of last frame, to tell what it did this one. */
    private readonly lastPlayback_ = new Map<Entity, { playing: boolean; laps: number }>();
    /** The audio clips each player is playing. */
    private readonly voices_ = new TimelineAudioVoices();
    /** What each player's spawn tracks have made. */
    private readonly spawns_ = new TimelineSpawns();
    private spawner_: TimelineSpawner | null = null;

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

        // Let an animator state play a timeline. Guarded rather than assumed:
        // the animation plugin is registered before this one in every plugin set,
        // and a build without it still plays timelines through TimelinePlayer.
        if (app.hasResource(AnimatorController)) {
            app.getResource(AnimatorController).registerMotionDriver(
                TIMELINE_MOTION, createTimelineMotionDriver(app.getResource(Timeline), {
                    particle: () => app.hasResource(Particle) ? app.getResource(Particle) : null,
                }),
            );
        }

        // Spawn clips make their prefab through the game's prefab server, named so the other tracks find it.
        this.spawner_ = {
            spawn: async (prefab, parent, name) => {
                if (!app.hasResource(Prefabs)) return null;
                const made = await app.getResource(Prefabs).instantiate(prefab, parent !== null && world.valid(parent) ? { parent } : undefined);
                if (name && world.valid(made.root)) world.insert(made.root, Name, { value: name });
                return made.root;
            },
            despawn: (entity) => { if (world.valid(entity)) world.despawn(entity); },
            prepare: (prefab) => (app.hasResource(Prefabs) ? app.getResource(Prefabs).prepare(prefab) : Promise.resolve({ release() {} })),
        };

        this.offDespawn_ = world.onDespawn((entity: Entity) => {
            app.getResource(Timeline).removeState(entity);
            this.animFramesStates_.delete(entity);
            this.voices_.stop(entity);
            this.spawns_.stop(entity, this.spawner_);
            this.lastPlayback_.delete(entity);
            if (app.hasResource(CameraDirector)) setTimelineShot(app.getResource(CameraDirector), entity, null);
        });

        // The timeline runs entirely in TS: a per-entity
        // clock + the shared evaluator (property tracks) + edge-detected event
        // dispatch — no wasm timeline, no upload, no per-frame poll. Property writes
        // land via world.set (the same path the editor preview uses).
        // Slow motion a timeline keys (UE's Time Dilation track): a component, so a script can use it too.
        installTimeDilation(app);
        app.addEvent(TimelineEvent);
        app.addEvent(TimelinePlayback);
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), EventWriter(TimelineEvent), EventWriter(TimelinePlayback)],
            (time: TimeData, events: EventWriterInstance<TimelineEventPayload>, playback: EventWriterInstance<TimelinePlaybackPayload>) => {
                const tl = app.getResource(Timeline);
                const audio: AudioAPI | null = app.hasResource(Audio) ? app.getResource(Audio) : null;
                const assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
                const director = app.hasResource(CameraDirector) ? app.getResource(CameraDirector) : null;
                // Paths resolve below their root, or through the playing player's bindings (`@Name`).
                let current = 0 as Entity;
                const deps: SampleDeps = {
                    world,
                    getComponent,
                    resolveChild: (root, childPath) => resolveTimelinePath(world, current, root, childPath),
                };

                for (const entity of world.getEntitiesWithComponents([TimelinePlayer])) {
                    const player = world.get(entity, TimelinePlayer) as TimelinePlayerData;
                    current = entity;
                    // A player with no timeline (or one that cannot be found) is not heard either.
                    if (!player.timeline) { this.voices_.stop(entity); this.spawns_.stop(entity, this.spawner_); continue; }
                    // A code registration first, then this app's realm — by the
                    // ref the component carries, since the slot answers to that
                    // spelling as well as to the path it resolved to.
                    const asset = tl.getAsset(player.timeline);
                    if (!asset) { this.voices_.stop(entity); this.spawns_.stop(entity, this.spawner_); continue; }
                    const published = assets?.resolveRegistryAsset<PublishedTimeline>(
                        'timeline', player.timeline,
                    );

                    const wrapMode = resolveWrapMode(player.wrapMode, asset.wrapMode);
                    const state = tl.ensureState(entity, wrapMode, player.speed);
                    state.speed = player.speed;
                    state.rangeStart = player.rangeStart ?? 0;
                    state.rangeEnd = player.rangeEnd ?? 0;
                    const was = this.lastPlayback_.get(entity) ?? { playing: false, laps: state.laps ?? 0 };
                    state.wrapMode = wrapMode;
                    const rewound = applyPlayerFlags(player, state);

                    this.ensureAnimFrames(entity, asset);

                    // Real time for a player that runs while the game is paused.
                    const dt = player.unscaledTime ? time.unscaledDelta : time.delta;
                    const justFinished = advanceTimelineTS(asset, entity, state, dt, {
                        particle: app.hasResource(Particle) ? app.getResource(Particle) : null,
                        deps, audio,
                        lookup: (ref) => tl.getAsset(ref),
                        onShot: director ? (shot) => setTimelineShot(director, entity, shot) : undefined,
                        // What the playhead crossed, for the game: each about the entity its track names.
                        onSignals: (signals) => {
                            for (const s of signals) {
                                const target = resolveTimelinePath(world, entity, entity, s.childPath) ?? entity;
                                events.send({ kind: s.kind, name: s.name, payload: s.payload, time: s.time, player: entity, target });
                            }
                        },
                    });
                    this.processAnimFrames(world, entity, state.time, published?.textureHandles);
                    // Audio clips: kept while the playhead is inside them, paused with the timeline.
                    this.voices_.sync(entity, asset, state.time, state.playing, audio);
                    // Spawned entities: there while the playhead is inside their clip, gone once the timeline is stopped.
                    const owner = entity;
                    if (!state.playing && !state.started && state.time === 0) this.spawns_.stop(entity, this.spawner_);
                    else if (this.spawner_) this.spawns_.sync(entity, asset, state.time, this.spawner_, (p) => resolveTimelinePath(world, owner, owner, p));
                    // A clip that ran out gives the view back; one that is only paused keeps it.
                    if (justFinished && director) setTimelineShot(director, entity, null);

                    // What the player did this frame, for the game: started, paused, stopped, finished, came round.
                    const laps = state.laps ?? 0;
                    if (!was.playing && state.playing) playback.send({ kind: 'played', player: entity, time: state.time });
                    if (laps > was.laps) playback.send({ kind: 'looped', player: entity, time: state.time });
                    if (was.playing && !state.playing) {
                        const kind = justFinished ? 'finished' : !state.started && state.time === 0 ? 'stopped' : 'paused';
                        playback.send({ kind, player: entity, time: state.time });
                    }
                    this.lastPlayback_.set(entity, { playing: state.playing, laps });

                    if (latchPlayerFinish(player, state, justFinished) || rewound) {
                        world.insert(entity, TimelinePlayer, player);
                    }
                }
            },
            { name: 'TimelineSystem' },
        // After the Animator: an animation track blends over (or, at full weight, replaces) the pose it gave the rig
        // this frame, and a property track has the last word on a field both animate, as in Unity's Timeline.
        ), { runIf: playModeOnly, runAfter: [SystemLabel.Animator] });
    }

    clearHandles(): void {
        this.animFramesStates_.clear();
    }

    cleanup(): void {
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.voices_.stopAll();
        this.spawns_.stopAll(this.spawner_);
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

export const timelinePlugin = /* @__PURE__ */ new TimelinePlugin();
