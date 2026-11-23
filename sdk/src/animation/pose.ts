// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pose.ts
 * @brief   What a motion evaluates to before anything is written: component
 *          values, held so several motions can be composed into one result.
 *
 * @details A sampler that writes the world as it goes cannot be blended - the
 *          second motion overwrites the first, and the result depends on which
 *          ran last. Sampling into a pose separates "what this motion says at
 *          this time" from "what the entity ends up as", so composition is an
 *          operation on values and the world is written once.
 *
 *          Runtime-internal: the buffers are reused between frames, so nothing
 *          outside the animation runtime should hold one.
 */

import type { Entity } from '../types';
import type { AnyComponentDef } from '../ecs/component';
import { readProjection, writeProjection } from '../ecs/componentProjection';
import { poseStorageFor, StoredPoseTracks, type PoseStorage } from './poseStorage';

/** The world surface a pose is seeded from and written back to. */
export interface PoseWorld {
    has(entity: Entity, def: AnyComponentDef): boolean;
    get(entity: Entity, def: AnyComponentDef): Record<string, unknown>;
    set(entity: Entity, def: AnyComponentDef, data: Record<string, unknown>): void;
}

function writeComponent(world: PoseWorld, entity: Entity, def: AnyComponentDef, data: Record<string, unknown>): void {
    world.set(entity, def, data);
}

/** One component on one entity, as some motion posed it. */
export interface PoseTrack {
    entity: Entity;
    def: AnyComponentDef;
    /** The component's values with this motion's channels written in. */
    data: Record<string, unknown>;
    /** Top-level fields this motion wrote; the rest of `data` is the base. */
    touched: Set<string>;
}

interface PoseSlot {
    track: PoseTrack;
    /** Which generation of this pose last seeded the track. */
    stamp: number;
}

/** @internal Components with the same registered name address the same track.
 *  Keep the full entity handle, including its generation, as the numeric key. */
export class PoseTrackIndex<T> {
    private readonly components_ = new Map<string, Map<Entity, T>>();

    lookup(entity: Entity, def: AnyComponentDef): T | undefined {
        return this.components_.get(def._name)?.get(entity);
    }

    set(entity: Entity, def: AnyComponentDef, value: T): void {
        let entities = this.components_.get(def._name);
        if (!entities) {
            entities = new Map();
            this.components_.set(def._name, entities);
        }
        entities.set(entity, value);
    }
}

/**
 * One motion's evaluated result. {@link reset} retains the track records and
 * their nested values for the next frame.
 */
export class Pose {
    private readonly slots_: PoseTrackIndex<PoseSlot> | StoredPoseTracks<PoseSlot>;
    private readonly stored_?: StoredPoseTracks<PoseSlot>;
    private readonly live_: PoseTrack[] = [];
    private stamp_ = 0;
    private held_ = false;
    private retirementAtSeed_ = 0;

    constructor();
    /** @internal Only evaluator scratch poses are released at the end of a sample. */
    constructor(storage: PoseStorage);
    constructor(storage?: PoseStorage) {
        if (storage) this.stored_ = new StoredPoseTracks(storage);
        this.slots_ = this.stored_ ?? new PoseTrackIndex();
    }

    /** @internal Drop the ordered live view after every consumer has finished blending. */
    finishEvaluation(): void {
        this.held_ = false;
        this.reset();
    }

    /** Drop this frame's contents, keeping the buffers. */
    reset(): void {
        this.stamp_++;
        this.live_.length = 0;
    }

    get tracks(): readonly PoseTrack[] {
        return this.live_;
    }

    /** @internal Look up a track sampled since reset, without reading the world. */
    findTrack(entity: Entity, def: AnyComponentDef): PoseTrack | undefined {
        const slot = this.slots_.lookup(entity, def);
        return slot?.stamp === this.stamp_ ? slot.track : undefined;
    }

    /**
     * The track for this component, seeded from the world the first time this
     * frame asks for it. The seed is what makes an untouched field survive: a
     * motion animating only position must not zero the rotation beside it.
     */
    track(world: PoseWorld, entity: Entity, def: AnyComponentDef): PoseTrack | null {
        if (this.stored_ && this.live_.length === 0) {
            const storage = poseStorageFor(world);
            this.stored_.storage = storage;
            this.retirementAtSeed_ = storage.retirementRevision;
            if (!this.held_) this.held_ = storage.hold(this);
        }
        const slot = this.slots_.lookup(entity, def);
        if (slot && slot.stamp === this.stamp_) return slot.track;
        if (!world.has(entity, def)) return null;

        const key = !slot ? this.stored_?.keyFor(entity, def, world) : undefined;
        const track = slot?.track ?? { entity, def, data: {}, touched: new Set<string>() };
        readProjection(world, entity, def, track.data);
        track.touched.clear();
        if (slot) slot.stamp = this.stamp_;
        else {
            const sampled = { track, stamp: this.stamp_ };
            if (this.slots_ instanceof PoseTrackIndex) this.slots_.set(entity, def, sampled);
            else this.slots_.remember(key, sampled);
        }
        this.live_.push(track);
        return track;
    }

    /** Write this pose's touched fields to the world. */
    applyTo(world: PoseWorld): void {
        this.writeTracks_(world, writeComponent);
    }

    /** @internal Apply the animation runtime's own fully evaluated buffers. */
    applyEvaluatedTo(world: PoseWorld): void {
        this.writeTracks_(world, writeProjection);
    }

    private writeTracks_(world: PoseWorld, write: typeof writeComponent): void {
        const storage = this.stored_?.storage;
        for (const track of this.live_) {
            if (track.touched.size === 0) continue;
            // A previous write can despawn a later joint or replace its core while this list is in use.
            if (storage && storage.retirementRevision !== this.retirementAtSeed_ && this.findTrack(track.entity, track.def) !== track) continue;
            write(world, track.entity, track.def, track.data);
        }
    }
}
