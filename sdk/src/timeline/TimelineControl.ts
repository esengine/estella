// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import { defineResource } from '../resource';
import { createTimelineState, type TimelineState } from './TimelineDrive';
import { WrapMode } from './TimelineTypes';

/**
 * @internal How the api reaches the `TimelinePlayer` component flags. Injected
 * by `TimelinePlugin` (which owns both sides, avoiding a module cycle). The
 * component flags are the authoritative playback channel — the per-frame system
 * reconciles them into {@link TimelineState} — so play/pause/stop must write
 * through to them or they would be overwritten on the next tick.
 */
export interface PlayerFlagChannel {
    /** Raise `playing` (replays from the top when the clip is finished). */
    raise(entity: Entity): void;
    /** Lower `playing`, keeping the clock (pause). */
    lower(entity: Entity): void;
    /** Lower `playing` and clear `finished` (a stopped clip is rewound, not completed). */
    reset(entity: Entity): void;
}

/**
 * Per-App timeline playback control. Holds this App's per-entity playback state
 * and is published as the {@link Timeline} resource; game code drives playback via
 * `app.getResource(Timeline)`.
 *
 * The timeline runtime is pure TS now — there is no
 * C++ handle or wasm module here. `TimelinePlugin` advances each entity's
 * {@link TimelineState} every frame; these methods flip/seek that state and
 * write the play flags through to the entity's `TimelinePlayer` component.
 */
export class TimelineApi {
    private readonly states_ = new Map<Entity, TimelineState>();

    constructor(private readonly flags_: PlayerFlagChannel | null = null) {}

    /** @internal Plugin ensures (creating if needed) the per-entity playback state. */
    ensureState(entity: Entity, wrapMode: WrapMode, speed: number): TimelineState {
        let s = this.states_.get(entity);
        if (!s) {
            s = createTimelineState(wrapMode, speed);
            this.states_.set(entity, s);
        }
        return s;
    }

    getState(entity: Entity): TimelineState | undefined {
        return this.states_.get(entity);
    }

    /** @internal Forget an entity's state (on despawn). */
    removeState(entity: Entity): void {
        this.states_.delete(entity);
    }

    /** @internal */
    clearStates(): void {
        this.states_.clear();
    }

    play(entity: Entity): void {
        const s = this.states_.get(entity);
        if (s) s.playing = true;
        this.flags_?.raise(entity);
    }

    pause(entity: Entity): void {
        const s = this.states_.get(entity);
        if (s) s.playing = false;
        this.flags_?.lower(entity);
    }

    stop(entity: Entity): void {
        const s = this.states_.get(entity);
        if (s) {
            s.playing = false;
            s.time = 0;
            s.prevTime = 0;
            s.spineClipIndices = {};
        }
        this.flags_?.reset(entity);
    }

    setTime(entity: Entity, time: number): void {
        const s = this.states_.get(entity);
        if (s) {
            s.prevTime = s.time;
            s.time = time;
        }
    }

    isPlaying(entity: Entity): boolean {
        return this.states_.get(entity)?.playing ?? false;
    }

    getCurrentTime(entity: Entity): number {
        return this.states_.get(entity)?.time ?? 0;
    }
}

/**
 * Per-App timeline control resource, published by `TimelinePlugin`. Drive
 * playback as `app.getResource(Timeline).play(entity)`.
 */
export const Timeline = defineResource<TimelineApi>(null!, 'Timeline');
