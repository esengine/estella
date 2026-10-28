// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  rainShelter.ts
 * @brief A roof, an awning or a tree crown that keeps the ground under it dry, for the 2D rain.
 *
 * @details The 3D rain finds what stands over a place by drawing the scene from straight above. A 2D scene has no "above" to draw it from, so the
 *          sprite that covers says so: `RainShelter` goes on it, and the ground it covers (its rectangle, or the ellipse inside it) is dry. How dry
 *          follows how much of that ground can be SEEN: an opaque roof shows the roof, which the rain falls on, and the same roof faded by a
 *          `CoverFade` to show the room has a room that is dry. So one roof carries both components and the rain stops as the room appears.
 *
 *          The system lists the shelters each frame; the volume system hands the eight nearest the camera to a `rain2d` effect's uniforms.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, Sprite, Transform, type SpriteData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Query } from '../ecs/query';
import { coveredGround } from './coverFade';
import { RAIN_SHELTER_SLOTS, SHELTER_FIELDS, shelterUniform } from '../postprocess/rainShelterSlots';
import type { BlendedEffect } from '../postprocess/volumeBlending';

/** The fields of the `RainShelter` component. @experimental */
export interface RainShelterData {
    /** The covered ground is the ellipse inside the sprite's rectangle (a crown), not the whole of it (a roof). */
    round: boolean;
    /** Ground around the sprite's edge that stays dry too, in world units: eaves. */
    margin: number;
    /** Off: the sprite shelters nothing. */
    enabled: boolean;
}

/**
 * Keeps the ground under this sprite dry in the 2D rain, as far as the sprite lets it be seen.
 *
 * @experimental
 */
export const RainShelter = defineComponent<RainShelterData>('RainShelter',
    { round: false, margin: 0, enabled: true },
    {
        fields: {
            round: { tooltip: "The covered ground is the ellipse inside the sprite's rectangle (a tree crown) and not the whole of it (a roof)." },
            margin: { min: 0, step: 1, tooltip: 'Ground around the sprite\'s edge that stays dry too, in world units.' },
        },
    },
);

/** One shelter as the shader reads it: a negative half height says round. */
export interface Shelter {
    x: number;
    y: number;
    hx: number;
    /** Negative for an ellipse. */
    hy: number;
    /** 0 where the ground under it cannot be seen, 1 where all of it can. */
    dry: number;
}

let sheltersNow: Shelter[] = [];

/** The shelters the last frame found. */
export function currentRainShelters(): readonly Shelter[] {
    return sheltersNow;
}

/** How dry the ground under a sprite is, from how much of it shows through: an opaque sprite hides it, a clear one hides nothing. */
export function drynessOf(alpha: number): number {
    return 1 - Math.min(Math.max(alpha, 0), 1);
}

/** The shelter a sprite is, or null where it has no ground to cover or no dryness to give. */
export function shelterOf(sprite: SpriteData, transform: TransformData, data: RainShelterData): Shelter | null {
    if (!data.enabled || !sprite.enabled) return null;
    const dry = drynessOf(sprite.color.a);
    if (dry <= 0) return null;
    const { centre, half } = coveredGround(sprite, transform);
    const hx = half.x + data.margin;
    const hy = half.y + data.margin;
    if (hx <= 0 || hy <= 0) return null;
    return { x: centre.x, y: centre.y, hx, hy: data.round ? -hy : hy, dry };
}

/** The `count` shelters nearest (x, y), nearest first. The distance is to a shelter's edge, so a large roof is not passed over for a small shed. */
export function nearestShelters(shelters: readonly Shelter[], x: number, y: number, count: number): Shelter[] {
    const reach = (s: Shelter): number => Math.max(Math.hypot(s.x - x, s.y - y) - Math.max(s.hx, Math.abs(s.hy)), 0);
    return [...shelters].sort((a, b) => reach(a) - reach(b)).slice(0, count);
}

/**
 * Writes the shelters nearest the camera into a `rain2d` effect, and empties the slots it does not fill. With no such effect, nothing.
 *
 * @param x  The camera's x.
 * @param y  The camera's y.
 */
export function applyRainSheltersToRain(effects: Map<string, BlendedEffect>, x: number, y: number): void {
    const rain = effects.get('rain2d');
    if (!rain || !rain.enabled) return;
    const chosen = nearestShelters(sheltersNow, x, y, RAIN_SHELTER_SLOTS);
    for (let slot = 0; slot < RAIN_SHELTER_SLOTS; slot++) {
        const s = chosen[slot];
        const values: Record<typeof SHELTER_FIELDS[number], number> = s
            ? { x: s.x, y: s.y, hx: s.hx, hy: s.hy, dry: s.dry }
            : { x: 0, y: 0, hx: 0, hy: 0, dry: 0 };
        for (const field of SHELTER_FIELDS) rain.uniforms.set(shelterUniform(slot, field), values[field]);
    }
}

/** Installs the system that lists the shelters each frame. Returns the function that forgets them. */
export function installRainShelter(app: App): () => void {
    const system = defineSystem(
        [Query(RainShelter, Sprite, Transform)],
        (shelters: Iterable<[Entity, RainShelterData, SpriteData, TransformData]>) => {
            const found: Shelter[] = [];
            for (const [, data, sprite, transform] of shelters) {
                const shelter = shelterOf(sprite, transform, data);
                if (shelter) found.push(shelter);
            }
            sheltersNow = found;
        },
        { name: 'RainShelterSystem' },
    );
    // After the cover fade has moved the sprites' alpha, so the rain stops the frame the roof thins and not the one after.
    app.addSystemToSchedule(Schedule.PostUpdate, system);
    return () => { sheltersNow = []; };
}
