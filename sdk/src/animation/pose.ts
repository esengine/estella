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

/** The world surface a pose is seeded from and written back to. */
export interface PoseWorld {
    has(entity: Entity, def: AnyComponentDef): boolean;
    get(entity: Entity, def: AnyComponentDef): Record<string, unknown>;
    set(entity: Entity, def: AnyComponentDef, data: Record<string, unknown>): void;
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

const keyOf = (entity: Entity, def: AnyComponentDef): string => `${entity} ${def._name}`;

/**
 * Copy `src`'s values into `dst`, reusing whatever objects `dst` already holds.
 * A pose OWNS its values: a builtin component's `get` hands back a projection
 * the next reader may share, so two poses seeded from one entity would be the
 * same object, and blending them would compare a value with itself.
 */
function copyInto(dst: Record<string, unknown>, src: Record<string, unknown>): void {
    for (const key of Object.keys(src)) {
        const value = src[key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const nested = (dst[key] ??= {}) as Record<string, unknown>;
            Object.assign(nested, value);
        } else {
            dst[key] = value;
        }
    }
}

/**
 * One motion's evaluated result. Reused across frames: {@link reset} keeps the
 * track objects and their buffers, so a steady animation allocates nothing
 * after its first frame.
 */
export class Pose {
    private readonly slots_ = new Map<string, PoseSlot>();
    private readonly live_: PoseTrack[] = [];
    private stamp_ = 0;

    /** Drop this frame's contents, keeping the buffers. */
    reset(): void {
        this.stamp_++;
        this.live_.length = 0;
    }

    get tracks(): readonly PoseTrack[] {
        return this.live_;
    }

    /**
     * The track for this component, seeded from the world the first time this
     * frame asks for it. The seed is what makes an untouched field survive: a
     * motion animating only position must not zero the rotation beside it.
     */
    track(world: PoseWorld, entity: Entity, def: AnyComponentDef): PoseTrack | null {
        const key = keyOf(entity, def);
        const slot = this.slots_.get(key);
        if (slot && slot.stamp === this.stamp_) return slot.track;
        if (!world.has(entity, def)) return null;

        const track = slot?.track ?? { entity, def, data: {}, touched: new Set<string>() };
        copyInto(track.data, world.get(entity, def));
        track.touched.clear();
        if (slot) slot.stamp = this.stamp_;
        else this.slots_.set(key, { track, stamp: this.stamp_ });
        this.live_.push(track);
        return track;
    }

    /** Write this pose's touched fields to the world. */
    applyTo(world: PoseWorld): void {
        for (const track of this.live_) {
            if (track.touched.size > 0) world.set(track.entity, track.def, track.data);
        }
    }
}
