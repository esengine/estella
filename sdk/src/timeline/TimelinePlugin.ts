// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { PluginInstallations } from '../app/pluginInstallations';
import { disposeAll } from '../util/disposeAll';
import { defineSystem, Schedule } from '../ecs/system';
import { SystemLabel } from '../ecs/systemLabels';
import { Res } from '../ecs/resource';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { TimelineEvent, TimelinePlayback, type TimelineEventPayload, type TimelinePlaybackPayload } from './timelineEvents';
import { TimelineAudioVoices } from './timelineAudio';
import { TimelineSpawns, type TimelineSpawner } from './timelineSpawns';
import { TimelineSpriteFrames } from './timelineSpriteFrames';
import { TIMELINE_VIEW_SHAKE } from './timelineCameraShake';
import { Prefabs } from '../prefab/prefabServer';
import { Name } from '../ecs/component';
import { ensureEntityEvents } from '../ecs/entityEvents';
import { resolveTimelinePath } from './timelineBindings';
import { installTimeDilation } from './timeDilation';
import { Time, type TimeData } from '../ecs/resource';
import { getComponent } from '../ecs/component';
import { playModeOnly } from '../ecs/env';
import { appRegistryAsset } from '../asset/registryLookup';
import { Audio, type AudioAPI } from '../audio/Audio';
import type { PublishedTimeline } from './TimelineTypes';
import { TimelinePlayer, resolveWrapMode, type TimelinePlayerData } from './TimelinePlayerComponent';
import { Timeline, TimelineAPI } from './TimelineControl';
import { AnimatorController } from '../animation/Animator';
import { TIMELINE_MOTION, createTimelineMotionDriver } from './timelineMotion';
import { Particle } from '../particle/ParticleAPI';
import { advanceTimelineTS, applyPlayerFlags, latchPlayerFinish } from './TimelineDrive';
import { CameraDirector, setTimelineShot, shakeCamera } from '../camera/CameraDirector';
import { fireImpulse } from '../camera/CameraImpulse';
import type { SampleDeps } from './TimelineEvaluator';
import type { SequenceLayer } from './timelineSequences';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';
export { TimelinePlayer, resolveWrapMode, type TimelinePlayerData } from './TimelinePlayerComponent';

export class TimelinePlugin implements Plugin {
    name = 'timeline';
    private readonly installations_ = new PluginInstallations<TimelinePlaybackSystem>();

    build(app: App): void {
        this.cleanup(app);
        const system = new TimelinePlaybackSystem();
        this.installations_.set(app, system);
        system.install(app);
    }

    clearHandles(app?: App): void {
        this.installations_.get(app)?.clearHandles();
    }

    cleanup(app?: App): void {
        this.installations_.take(app)?.dispose();
    }
}

/** Each App advances and releases the players in its own World. Entity IDs are local to that World. */
class TimelinePlaybackSystem {
    private active_ = true;
    private timeline_: TimelineAPI | null = null;
    private readonly frames_ = new TimelineSpriteFrames();
    private detachPlayers_: (() => void) | null = null;
    /** Each player's state as of last frame, to tell what it did this one. */
    private readonly lastPlayback_ = new Map<Entity, { playing: boolean; laps: number }>();
    /** The audio clips each player is playing. */
    private readonly voices_ = new TimelineAudioVoices();
    /** What each player's spawn tracks have made. */
    private readonly spawns_ = new TimelineSpawns();
    private spawner_: TimelineSpawner | null = null;

    install(app: App): void {
        const world = app.world;
        const directorFor = () => app.hasResource(CameraDirector) ? app.getResource(CameraDirector) : null;
        const clearShot = (entity: Entity) => {
            const director = directorFor();
            if (director) setTimelineShot(director, entity, null);
        };

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
        const timeline = new TimelineAPI({
            raise: entity => setFlags(entity, true, false),
            lower: entity => setFlags(entity, false, false),
            reset: entity => {
                clearShot(entity);
                setFlags(entity, false, true);
            },
        });
        this.timeline_ = timeline;
        app.insertResource(Timeline, timeline);
        // A `.estimeline` comes from THIS app's realm; a code registration wins.
        timeline.useAssetTimelines(
            (ref, entity) => appRegistryAsset<PublishedTimeline>(app, 'timeline', ref, entity),
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
        const nameRoot = (root: Entity, name: string) => {
            if (name && world.valid(root)) world.insert(root, Name, { value: name });
            return root;
        };
        const spawner: TimelineSpawner = {
            spawn: async (prefab, parent, name, player) => {
                if (!app.hasResource(Prefabs)) return null;
                const made = await app.getResource(Prefabs).instantiate(prefab, { parent: parent ?? undefined, owner: player });
                return nameRoot(made.root, name);
            },
            spawnPrepared: (recipe, parent, name, player) => {
                if (!app.hasResource(Prefabs)) return null;
                const made = app.getResource(Prefabs).spawnPrepared(recipe, { parent: parent ?? undefined, owner: player });
                return nameRoot(made.root, name);
            },
            despawn: (entity) => { if (world.valid(entity)) world.despawn(entity); },
            // Prepared ahead, so a clip's instance is made on the frame it starts.
            prepare: async (prefab, player) => {
                if (!app.hasResource(Prefabs)) return { release() {} };
                const prepared = await app.getResource(Prefabs).prepare(prefab);
                return {
                    release: () => prepared.release(),
                    spawn: (parent, name) => {
                        const made = prepared.spawn({ parent: parent ?? undefined, owner: player });
                        return nameRoot(made.root, name);
                    },
                };
            },
        };

        this.spawner_ = spawner;
        const releasePlayer = (entity: Entity) => {
            timeline.removeState(entity);
            this.lastPlayback_.delete(entity);
            clearShot(entity);
            this.forgetOutputs(entity);
        };
        const offDespawn = world.onDespawn(releasePlayer);
        const offRemoval = world.onComponentRemoval(TimelinePlayer, releasePlayer);
        this.detachPlayers_ = () => {
            offDespawn();
            offRemoval();
            const director = directorFor();
            if (director && timeline.getState(director.timelineOwner as Entity)) {
                setTimelineShot(director, director.timelineOwner, null);
            }
        };

        // The timeline runs entirely in TS: a per-entity clock, the shared evaluator and edge-detected event dispatch;
        // property writes land via world.set (the editor preview's path). Slow motion a timeline keys (a Time Dilation
        // track) is a component, so a script can use it too.
        installTimeDilation(app);
        // Signals reach the entity events too, so a visual script, a state machine or an event binding on the track's
        // entity (or on the player, where they bubble to) reacts to `timeline:<name>`.
        const entityEvents = ensureEntityEvents(app);
        app.addEvent(TimelineEvent);
        app.addEvent(TimelinePlayback);
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), EventWriter(TimelineEvent), EventWriter(TimelinePlayback)],
            (time: TimeData, events: EventWriterInstance<TimelineEventPayload>, playback: EventWriterInstance<TimelinePlaybackPayload>) => {
                if (!this.active_) return;
                const tl = app.getResource(Timeline);
                const audio: AudioAPI | null = app.hasResource(Audio) ? app.getResource(Audio) : null;
                const director = directorFor();
                // Paths resolve below their root, or through the playing player's bindings (`@Name`).
                let current = 0 as Entity;
                const deps: SampleDeps = {
                    world,
                    getComponent,
                    resolveChild: (root, childPath) => resolveTimelinePath(world, current, root, childPath),
                };

                for (const entity of world.getEntitiesWithComponents([TimelinePlayer])) {
                    const player = world.tryGet(entity, TimelinePlayer);
                    if (!player) continue;
                    current = entity;
                    // A code registration first, then this app's realm — by the
                    // ref the component carries, since the slot answers to that
                    // spelling as well as to the path it resolved to.
                    const published = player.timeline && tl.playback(player.timeline, entity);
                    if (!published) {
                        if (director) setTimelineShot(director, entity, null);
                        this.forgetOutputs(entity);
                        continue;
                    }
                    const { asset } = published;

                    const wrapMode = resolveWrapMode(player.wrapMode, asset.wrapMode);
                    const state = tl.ensureState(entity, wrapMode, player.speed);
                    state.speed = player.speed;
                    state.rangeStart = player.rangeStart ?? 0;
                    state.rangeEnd = player.rangeEnd ?? 0;
                    const was = this.lastPlayback_.get(entity) ?? { playing: false, laps: state.laps ?? 0 };
                    state.wrapMode = wrapMode;
                    const rewound = applyPlayerFlags(player, state);

                    // Real time for a player that runs while the game is paused.
                    const dt = player.unscaledTime ? time.unscaledDelta : time.delta;
                    let layers: readonly SequenceLayer[] | undefined;
                    const justFinished = advanceTimelineTS(asset, entity, state, dt, {
                        particle: app.hasResource(Particle) ? app.getResource(Particle) : null,
                        deps, audio,
                        syncSpawns: time => this.spawns_.sync(entity, asset, time, spawner,
                            path => deps.resolveChild(entity, path), published.prefabs),
                        lookup: (ref) => tl.getAsset(ref, entity),
                        isCurrent: () => this.active_ && tl.getState(entity) === state,
                        onSequenceLayers: resolved => { layers = resolved; },
                        onShot: director ? (shot) => {
                            if (this.active_ && state.started && tl.getState(entity) === state) setTimelineShot(director, entity, shot);
                        } : undefined,
                        // A shake: an impulse from where the track's entity is, or the view shaken where it is.
                        onShake: (from, force) => {
                            if (force <= 0 || fireImpulse(world, from, force)) return;
                            if (director) shakeCamera(director, { amplitude: TIMELINE_VIEW_SHAKE.amplitude * force, rotation: TIMELINE_VIEW_SHAKE.rotation * force, frequency: TIMELINE_VIEW_SHAKE.frequency, duration: TIMELINE_VIEW_SHAKE.duration });
                        },
                        // What the playhead crossed, for the game: each about the entity its track names.
                        onSignals: (signals, signalRoot, isCurrent) => {
                            for (const s of signals) {
                                if (isCurrent?.() === false) break;
                                const target = resolveTimelinePath(world, entity, signalRoot, s.childPath) ?? signalRoot;
                                if (!world.valid(target)) continue;
                                events.send({ kind: s.kind, name: s.name, payload: s.payload, time: s.time, player: entity, target });
                                const type = timelineSignalType(s.name);
                                if (!s.name || !entityEvents.hasListenersFor(type)) continue;
                                const data: TimelineSignalEventData = { kind: s.kind, name: s.name, payload: s.payload, time: s.time, player: entity, other: entity };
                                const sent = entityEvents.emit(target, type, data);
                                if (target !== entity && !sent.propagationStopped && world.valid(entity)) entityEvents.emitBubbled(entity, sent);
                            }
                        },
                    });
                    // A cue can retire the player synchronously during the advance.
                    if (!this.active_ || tl.getState(entity) !== state) continue;
                    this.frames_.sync(world, entity, asset, state.time, published, deps.resolveChild, ref => tl.playback(ref, entity), layers);
                    // Audio clips: kept while the playhead is inside them, paused with the timeline.
                    this.voices_.sync(entity, asset, state.time, state.playing, audio);
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
        // this frame, and a property track has the last word on a field both animate.
        ), { runIf: playModeOnly, runAfter: [SystemLabel.Animator] });
    }

    clearHandles(): void {
        this.frames_.clear();
    }

    private forgetOutputs(entity: Entity): void {
        this.frames_.forget(entity);
        try { this.voices_.stop(entity); }
        finally { this.spawns_.forget(entity, this.spawner_); }
    }

    dispose(): void {
        this.active_ = false;
        this.detachPlayers_?.();
        this.timeline_?.clearStates();
        this.lastPlayback_.clear();
        this.frames_.clear();
        disposeAll([() => this.voices_.stopAll(), () => this.spawns_.stopAll(this.spawner_)], release => release());
    }
}

export const timelinePlugin = /* @__PURE__ */ new TimelinePlugin();

/** The entity event a timeline signal (a marker or an event named `name`) is sent as: `timeline:<name>`. */
export const timelineSignalType = (name: string): string => `timeline:${name}`;

/**
 * What a `timeline:<name>` entity event carries: the signal, the player that crossed it, and (as `other`, the field a
 * visual script's On Event reads) the player again.
 */
export interface TimelineSignalEventData {
    kind: 'event' | 'marker';
    name: string;
    payload: Record<string, unknown>;
    time: number;
    player: Entity;
    other: Entity;
}
