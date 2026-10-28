// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  coverFade.ts
 * @brief A roof or a tree crown that thins out while something stands under it, so the player is never hidden by the thing they walked into.
 *
 * @details Top-down games draw a roof OVER the floor it covers, and the player walking in is then behind it. The usual answer is to fade the roof;
 *          this is that, as two components and no code. `CoverFade` goes on the sprite that covers (its own rectangle, or the ellipse inside it, is
 *          the covered ground); `CoverFadeTarget` goes on whatever should never be hidden. While a target stands inside the covered ground the sprite
 *          eases down to `opacity`, and eases back when it leaves. The sprite's own authored alpha is what it eases from and back to.
 *
 *          The covered ground is read from the sprite's size, pivot and the entity's scale, not its rotation: a roof is axis-aligned in a top-down
 *          view, and a rotated crown is a circle either way. It runs in play only; in the editor a scene is left as authored.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, defineTag, Sprite, Transform, type SpriteData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule, GetWorld } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { World } from '../ecs/world';
import { isEditor, isPlayMode } from '../ecs/env';

/** The fields of the `CoverFade` component. @experimental */
export interface CoverFadeData {
    /** The sprite's alpha, as a share of its own, while something stands under it. 0 is gone, 1 is no fade. */
    opacity: number;
    /** Seconds the fade takes, either way. */
    fadeTime: number;
    /** Ground around the sprite's edge, in world units, that counts as under it: the fade starts as a target steps up to the edge, not after it is in. */
    margin: number;
    /** The covered ground is the ellipse inside the sprite's rectangle, not the whole rectangle: a tree crown, not a roof. */
    round: boolean;
    /** Off: the sprite stays as authored. */
    enabled: boolean;
}

/**
 * Makes the sprite on this entity thin out while a `CoverFadeTarget` stands under it.
 *
 * @experimental
 */
export const CoverFade = defineComponent<CoverFadeData>('CoverFade',
    { opacity: 0.25, fadeTime: 0.25, margin: 0, round: false, enabled: true },
    {
        fields: {
            opacity: { min: 0, max: 1, step: 0.01, tooltip: "The sprite's alpha, as a share of its own, while something stands under it." },
            fadeTime: { min: 0, max: 5, step: 0.05, unit: 's', tooltip: 'Seconds the fade takes, either way.' },
            margin: { min: 0, step: 1, tooltip: "Ground around the sprite's edge that counts as under it, in world units." },
            round: { tooltip: "The covered ground is the ellipse inside the sprite's rectangle (a tree crown) and not the whole of it (a roof)." },
        },
    },
);

/** Marks what a `CoverFade` keeps visible: the player, and anything else that must not be hidden. @experimental */
export const CoverFadeTarget = defineTag('CoverFadeTarget');

/**
 * The ground a sprite covers: its rectangle's centre and half extents, from its size and pivot under the entity's scale. The pivot is where the
 * entity's position sits in the sprite (0.5 is the middle). Rotation is not read.
 */
export function coveredGround(sprite: SpriteData, transform: TransformData): { centre: { x: number; y: number }; half: { x: number; y: number } } {
    const scale = transform.worldScale;
    const half = { x: Math.abs(sprite.size.x * scale.x) / 2, y: Math.abs(sprite.size.y * scale.y) / 2 };
    const origin = transform.worldPosition;
    return {
        half,
        centre: { x: origin.x + (0.5 - sprite.pivot.x) * half.x * 2, y: origin.y + (0.5 - sprite.pivot.y) * half.y * 2 },
    };
}

/** Whether the point (px, py) is on the ground a sprite covers. */
export function coversPoint(
    px: number, py: number,
    centre: { x: number; y: number }, half: { x: number; y: number },
    margin: number, round: boolean,
): boolean {
    const hx = half.x + margin;
    const hy = half.y + margin;
    if (hx <= 0 || hy <= 0) return false;
    const dx = (px - centre.x) / hx;
    const dy = (py - centre.y) / hy;
    return round ? dx * dx + dy * dy <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

/** The share of its alpha a sprite shows after `dt`, moving from `current` toward `goal` in `fadeTime` seconds. */
export function stepFade(current: number, goal: number, dt: number, fadeTime: number): number {
    if (fadeTime <= 0) return goal;
    const step = dt / fadeTime;
    return goal > current ? Math.min(goal, current + step) : Math.max(goal, current - step);
}

interface Fading {
    /** The alpha the sprite was authored with, which the fade is a share of. */
    authored: number;
    /** The share shown now, 1 down to the component's `opacity`. */
    shown: number;
}

/** Installs the system that does the fading. Returns the function that removes what it changed. */
export function installCoverFade(app: App): () => void {
    const fading = new Map<Entity, Fading>();

    const put = (world: World, entity: Entity, alpha: number): void => {
        const sprite = world.get(entity, Sprite) as SpriteData;
        if (sprite.color.a === alpha) return;
        world.set(entity, Sprite, { ...sprite, color: { ...sprite.color, a: alpha } });
    };
    const restore = (world: World, entity: Entity, state: Fading): void => {
        if (world.has(entity, Sprite)) put(world, entity, state.authored);
        fading.delete(entity);
    };

    // system-access: the sprite's alpha is read and written through the world, per entity, because the fade owns a share of it.
    const system = defineSystem(
        [Query(CoverFade, Sprite, Transform), Query(CoverFadeTarget, Transform), Res(Time), GetWorld()],
        (
            covers: Iterable<[Entity, CoverFadeData, SpriteData, TransformData]>,
            targets: Iterable<[Entity, unknown, TransformData]>,
            time: TimeData, world: World,
        ) => {
            if (isEditor() && !isPlayMode()) {
                if (fading.size > 0) for (const [entity, state] of [...fading]) restore(world, entity, state);
                return;
            }
            const points: { x: number; y: number }[] = [];
            for (const [, , transform] of targets) points.push({ x: transform.worldPosition.x, y: transform.worldPosition.y });

            const seen = new Set<Entity>();
            for (const [entity, cover, sprite, transform] of covers) {
                seen.add(entity);
                let state = fading.get(entity);
                if (!cover.enabled) { if (state) restore(world, entity, state); continue; }
                if (!state) { state = { authored: sprite.color.a, shown: 1 }; fading.set(entity, state); }

                const { centre, half } = coveredGround(sprite, transform);
                let under = false;
                for (const p of points) {
                    if (coversPoint(p.x, p.y, centre, half, cover.margin, cover.round)) { under = true; break; }
                }
                const goal = under ? Math.min(Math.max(cover.opacity, 0), 1) : 1;
                if (state.shown === goal) continue;
                state.shown = stepFade(state.shown, goal, time.delta, cover.fadeTime);
                put(world, entity, state.authored * state.shown);
            }
            // What lost its component, or was despawned, goes back to what it was authored as.
            for (const [entity, state] of [...fading]) if (!seen.has(entity)) restore(world, entity, state);
        },
        { name: 'CoverFadeSystem' },
    );
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        const world = app.world;
        for (const [entity, state] of [...fading]) restore(world, entity, state);
    };
}
