// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsEventBridge.ts
 * @brief   Contacts and sensor overlaps, republished on the entity event channel.
 *
 * `Physics2DEvents` is a per-frame batch resource: excellent for a system that
 * wants every contact this tick, useless for "when THIS entity is touched". The
 * bridge turns each batch entry into an entity-scoped event on the shared queue
 * — the same channel a button's `click` travels — which is what lets an authored
 * `EventBinding` row wire a trigger area with no code, exactly like a widget.
 *
 * Both participants hear it. A contact has no privileged side, and a trigger's
 * two roles (the area, and whoever walked into it) both routinely want to react;
 * each side receives the OTHER entity in the payload.
 */
import type { App } from '../app/app';
import { Schedule, defineSystem } from '../ecs/system';
import { Res } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { ensureEntityEvents } from '../ecs/entityEvents';
import { Physics2DEvents, type Physics2DEventsData } from './PhysicsTypes';
import type { Entity } from '../types';

/**
 * The event types the physics bridge emits. Open strings, like every other
 * producer's — these constants exist so the editor's palette and game code spell
 * them the same way (mirrors `UIEventType`).
 */
export const Physics2DEventType = {
    CollisionEnter: 'collision_enter',
    CollisionExit: 'collision_exit',
    CollisionHit: 'collision_hit',
    TriggerEnter: 'trigger_enter',
    TriggerExit: 'trigger_exit',
} as const;

export type Physics2DEventType = typeof Physics2DEventType[keyof typeof Physics2DEventType];

/** Payload carried by every bridged event: who else was involved. */
export interface Physics2DContactEventData {
    /** The other participant — the body touched, or the trigger/visitor. */
    other: Entity;
    /** True on the sensor's own `trigger_*` event (false on the visitor's). */
    isSensor?: boolean;
    /** Approach speed, on `collision_hit` only. */
    approachSpeed?: number;
}

/**
 * Republish this frame's physics batch onto the entity event channel. Runs in
 * Update (after the fixed-step physics has filled the resource) and only in play
 * mode — the edit realm never steps the world.
 */
export function registerPhysics2DEventBridge(app: App): void {
    const events = ensureEntityEvents(app);
    const world = app.world;
    const emitPair = (a: Entity, b: Entity, type: string, extra?: Partial<Physics2DContactEventData>): void => {
        if (world.valid(a)) events.emit<Physics2DContactEventData>(a, type, { other: b, ...extra });
        if (world.valid(b)) events.emit<Physics2DContactEventData>(b, type, { other: a, ...extra });
    };

    app.addSystemToSchedule(
        Schedule.Update,
        defineSystem([Res(Physics2DEvents)], (physics: Physics2DEventsData) => {
            for (const c of physics.collisionEnters) {
                emitPair(c.entityA, c.entityB, Physics2DEventType.CollisionEnter);
            }
            for (const c of physics.collisionExits) {
                emitPair(c.entityA, c.entityB, Physics2DEventType.CollisionExit);
            }
            for (const c of physics.collisionHits) {
                emitPair(c.entityA, c.entityB, Physics2DEventType.CollisionHit, { approachSpeed: c.approachSpeed });
            }
            // A sensor pair is asymmetric, so each side is told which it is.
            for (const s of physics.sensorEnters) {
                if (world.valid(s.sensorEntity)) {
                    events.emit<Physics2DContactEventData>(s.sensorEntity, Physics2DEventType.TriggerEnter, { other: s.visitorEntity, isSensor: true });
                }
                if (world.valid(s.visitorEntity)) {
                    events.emit<Physics2DContactEventData>(s.visitorEntity, Physics2DEventType.TriggerEnter, { other: s.sensorEntity, isSensor: false });
                }
            }
            for (const s of physics.sensorExits) {
                if (world.valid(s.sensorEntity)) {
                    events.emit<Physics2DContactEventData>(s.sensorEntity, Physics2DEventType.TriggerExit, { other: s.visitorEntity, isSensor: true });
                }
                if (world.valid(s.visitorEntity)) {
                    events.emit<Physics2DContactEventData>(s.visitorEntity, Physics2DEventType.TriggerExit, { other: s.sensorEntity, isSensor: false });
                }
            }
        }, { name: 'PhysicsEventBridgeSystem' }),
        { runIf: playModeOnly },
    );
}
