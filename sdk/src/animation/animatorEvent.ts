// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorEvent.ts
 * @brief   What the animator says happened, for anything that cares to hear it.
 *
 * @details The animator's job ends at "the clip declared `hit` and the playhead
 *          just crossed it". Dealing damage, playing a footstep, bursting dust —
 *          those belong to the systems that own damage, sound and particles, and
 *          an animator that called them would be a state machine that imports the
 *          combat rules. So it states the event and stops, and the dependency
 *          runs the other way: gameplay reads the animator, never the reverse.
 *
 *          One channel, the engine's own event bus, rather than a listener list
 *          beside it: a callback fires inside the animator's own loop over
 *          entities, and a handler that spawns or despawns there is mutating the
 *          set being iterated.
 */

import { defineEvent, type EventDef } from '../ecs/event';
import type { Entity } from '../types';

/**
 * One event a clip declared, and who it happened to.
 *
 * The payload is two scalars rather than an open object: what crosses this bus
 * is also what a compiled system reads, and a shape that varies per clip has no
 * layout to bake in. A clip states them as `value` and `text` on the event.
 *
 * @experimental
 */
export interface AnimatorEventPayload {
    /** The animated entity — the character this happened to. */
    entity: Entity;
    /** The event's name as the clip declared it (`footstep`, `hit`). */
    name: string;
    /** Its numeric payload; 0 when the clip states none. */
    value: number;
    /** Its string payload; empty when the clip states none. */
    text: string;
}

/**
 * The bus every animation event arrives on. Read it with
 * `EventReader(AnimatorEvent)` in a system of your own.
 *
 * @experimental
 */
export const AnimatorEvent: EventDef<AnimatorEventPayload> =
    defineEvent<AnimatorEventPayload>('AnimatorEvent', {
        entity: 0 as Entity, name: '', value: 0, text: '',
    });

/**
 * Where the animator posts what it saw. `EventWriter(AnimatorEvent)` satisfies
 * it, and so does a test's array — the animator states events without knowing
 * whether an App is listening.
 *
 * @experimental
 */
export interface AnimatorEventSink {
    send(event: AnimatorEventPayload): void;
}
