// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  swayPush.ts
 * @brief Grass that parts as something walks through it: a `SwayPusher` is a body the plants of a sway material lean away from.
 *
 * @details The wind (the `sprite-sway` template) leans a plant by a gust that travels across the world. A body walking through the plants needs the
 *          other half: each plant leaning AWAY from it, more the nearer it stands, and standing up again as it goes. The sway shader takes the bodies
 *          as eight uniforms (where each is, how far it reaches, how hard it pushes) and works the lean out per pixel, so a plant is parted by exactly
 *          the bodies near it and no plant is a component or an entity of its own. This system picks the eight pushers nearest the camera each frame
 *          and writes them to every material that declares them, so a field of grass and a hundred creatures cost eight values.
 *
 *          More than eight bodies near the camera at once: the farthest go unpushed, which a player sees as grass that did not part for a creature at
 *          the edge of the screen. It runs in play only; in the editor a scene is left as authored.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, Transform, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Query } from '../ecs/query';
import { CameraView } from '../camera/Camera';
import { isEditor, isPlayMode } from '../ecs/env';
import { Material } from './material';

/** The most bodies the sway shader leans plants away from at once. */
export const SWAY_PUSHERS = 8;

/** The fields of the `SwayPusher` component. @experimental */
export interface SwayPusherData {
    /** How far from the entity the plants lean away, in world units. */
    radius: number;
    /** How hard: 1 is the full lean the material's \`u_swayPushStrength\` says, 0 none. */
    strength: number;
    /** Off: plants do not lean away from it. */
    enabled: boolean;
}

/**
 * Makes the plants of a `sprite-sway` material lean away from this entity as it walks through them.
 *
 * @experimental
 */
export const SwayPusher = defineComponent<SwayPusherData>('SwayPusher',
    { radius: 48, strength: 1, enabled: true },
    {
        fields: {
            radius: { min: 1, step: 1, unit: 'wu', tooltip: 'How far from the entity the plants lean away.' },
            strength: { min: 0, max: 2, step: 0.01, tooltip: "How hard they lean: 1 is the full lean the material's Push Strength says." },
        },
    },
);

/** One body, as the shader takes it: where it stands, how far it reaches, how hard it pushes. */
export interface PushValue { x: number; y: number; z: number; w: number }

/** The names of the eight uniforms, in the order the pushers fill them. */
export const SWAY_PUSH_UNIFORMS: readonly string[] = Array.from({ length: SWAY_PUSHERS }, (_, i) => `u_swayPush${i}`);

/** The eight bodies nearest `focus`, farthest dropped, as the shader's values; an unused one reaches nowhere (radius 0). */
export function nearestPushers(
    bodies: readonly { x: number; y: number; radius: number; strength: number }[], focus: { x: number; y: number },
): PushValue[] {
    const near = bodies
        .filter((b) => b.radius > 0 && b.strength > 0)
        .map((b) => ({ b, d: Math.hypot(b.x - focus.x, b.y - focus.y) }))
        .sort((a, c) => a.d - c.d)
        .slice(0, SWAY_PUSHERS);
    const out: PushValue[] = near.map(({ b }) => ({ x: b.x, y: b.y, z: b.radius, w: b.strength }));
    while (out.length < SWAY_PUSHERS) out.push({ x: 0, y: 0, z: 0, w: 0 });
    return out;
}

/** Installs the system that tells sway materials where the pushers are. Returns the function that puts them back. */
export function installSwayPush(app: App): () => void {
    let written = false;

    const clear = (): void => {
        if (!written) return;
        written = false;
        for (const material of Material.materialsDeclaring(SWAY_PUSH_UNIFORMS[0]!)) {
            for (const name of SWAY_PUSH_UNIFORMS) Material.setUniform(material, name, { x: 0, y: 0, z: 0, w: 0 });
        }
    };

    const system = defineSystem(
        [Query(SwayPusher, Transform)],
        (pushers: Iterable<[Entity, SwayPusherData, TransformData]>) => {
            if (isEditor() && !isPlayMode()) { clear(); return; }
            const bodies: { x: number; y: number; radius: number; strength: number }[] = [];
            for (const [, pusher, transform] of pushers) {
                if (!pusher.enabled) continue;
                bodies.push({ x: transform.worldPosition.x, y: transform.worldPosition.y, radius: pusher.radius, strength: pusher.strength });
            }
            if (bodies.length === 0) { clear(); return; }
            const view = app.hasResource(CameraView) ? app.getResource(CameraView).getWorldBounds() : null;
            const focus = view ? { x: (view.left + view.right) / 2, y: (view.bottom + view.top) / 2 } : { x: bodies[0]!.x, y: bodies[0]!.y };
            const values = nearestPushers(bodies, focus);
            written = true;
            for (const material of Material.materialsDeclaring(SWAY_PUSH_UNIFORMS[0]!)) {
                for (let i = 0; i < SWAY_PUSHERS; i++) Material.setUniform(material, SWAY_PUSH_UNIFORMS[i]!, values[i]!);
            }
        },
        { name: 'SwayPushSystem' },
    );
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => { clear(); };
}
