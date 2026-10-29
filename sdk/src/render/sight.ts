// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sight.ts
 * @brief What a viewer can see in a 2D scene: the walls that block a line, and the things that are hidden while a wall stands between.
 *
 * @details A lit sprite behind a wall is already dark, because the wall's `ShadowCaster2D` shadows the light that would show it. Everything that
 *          is not lit is not: an enemy drawn unlit, its health bar, a pickup glowing on its own. So the same walls are read again here as a
 *          test on the CPU, `segmentBlocked`, and two components use it. `SightViewer` is an eye (the player); `SightTarget` goes on a sprite that
 *          should not be seen unless some viewer has a clear line to it, and eases to `hiddenOpacity` while none does. The viewer's own `radius`
 *          is how far it sees (0: as far as the line is clear).
 *
 *          A caster that contains the viewer or the target blocks nothing for that pair: standing in a bush you see out of it, and a thing in a
 *          wall's own footprint is seen from outside. The test is segment against edge, so its cost is viewers times targets times the edges near
 *          the line, which is what a few hundred targets and a village of walls cost on a phone. It runs in play only.
 *
 *          A sprite carries one fade: do not put a `SightTarget` and a `CoverFade` on the same sprite.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, ShadowCaster2D, Sprite, Transform, type ShadowCaster2DData, type SpriteData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule, GetWorld } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { World } from '../ecs/world';
import { isEditor, isPlayMode } from '../ecs/env';
import { stepFade } from './coverFade';

/** The fields of the `SightViewer` component. @experimental */
export interface SightViewerData {
    /** How far this eye sees, in world units. 0 is no limit: only a wall stops it. */
    radius: number;
    /** Off: this eye sees nothing. */
    enabled: boolean;
}

/**
 * An eye: the sprites with a `SightTarget` are seen while some viewer has a clear line to them.
 *
 * @experimental
 */
export const SightViewer = defineComponent<SightViewerData>('SightViewer',
    { radius: 0, enabled: true },
    { fields: { radius: { min: 0, step: 1, unit: 'wu', tooltip: 'How far this eye sees. 0 is no limit: only a wall stops it.' } } },
);

/** The fields of the `SightTarget` component. @experimental */
export interface SightTargetData {
    /** The sprite's alpha, as a share of its own, while no viewer sees it. 0 is gone. */
    hiddenOpacity: number;
    /** Seconds the fade takes, either way. */
    fadeTime: number;
    /** Off: the sprite stays as authored. */
    enabled: boolean;
}

/**
 * Hides the sprite on this entity while no `SightViewer` has a clear line to it.
 *
 * @experimental
 */
export const SightTarget = defineComponent<SightTargetData>('SightTarget',
    { hiddenOpacity: 0, fadeTime: 0.15, enabled: true },
    {
        fields: {
            hiddenOpacity: { min: 0, max: 1, step: 0.01, tooltip: "The sprite's alpha, as a share of its own, while no viewer sees it." },
            fadeTime: { min: 0, max: 5, step: 0.05, unit: 's', tooltip: 'Seconds the fade takes, either way.' },
        },
    },
);

/** A point in the world plane. */
export interface SightPoint {
    x: number;
    y: number;
}

/** One blocker: the outline of a wall, in world units, in order round the shape. */
export type SightRing = readonly SightPoint[];

/** Whether the open segments a-b and c-d cross. A touch at an end is not a crossing: a viewer standing against a wall is not behind it. */
function crosses(a: SightPoint, b: SightPoint, c: SightPoint, d: SightPoint): boolean {
    const d1x = b.x - a.x, d1y = b.y - a.y, d2x = d.x - c.x, d2y = d.y - c.y;
    const denom = d1x * d2y - d1y * d2x;
    if (denom === 0) return false;
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
    const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
    return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1;
}

/** Whether a point lies inside a ring (even-odd). */
export function ringContains(ring: SightRing, p: SightPoint): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, b = ring[j]!;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/**
 * Whether the line from `from` to `to` runs through a wall. A ring that contains either end blocks nothing for this pair.
 */
export function segmentBlocked(from: SightPoint, to: SightPoint, rings: readonly SightRing[]): boolean {
    const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
    for (const ring of rings) {
        if (ring.length < 3) continue;
        let rx0 = Infinity, rx1 = -Infinity, ry0 = Infinity, ry1 = -Infinity;
        for (const p of ring) {
            if (p.x < rx0) rx0 = p.x;
            if (p.x > rx1) rx1 = p.x;
            if (p.y < ry0) ry0 = p.y;
            if (p.y > ry1) ry1 = p.y;
        }
        if (rx1 < minX || rx0 > maxX || ry1 < minY || ry0 > maxY) continue;
        if (ringContains(ring, from) || ringContains(ring, to)) continue;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            if (crosses(from, to, ring[j]!, ring[i]!)) return true;
        }
    }
    return false;
}

/** A caster's outline in the world: its box or its traced path, scaled, turned and placed by its transform. Null for one that blocks nothing. */
export function sightRingOf(caster: ShadowCaster2DData, transform: TransformData): SightRing | null {
    if (!caster.enabled) return null;
    const local: SightPoint[] = caster.path.length >= 3
        ? caster.path
        : [
            { x: -caster.size.x / 2, y: -caster.size.y / 2 }, { x: caster.size.x / 2, y: -caster.size.y / 2 },
            { x: caster.size.x / 2, y: caster.size.y / 2 }, { x: -caster.size.x / 2, y: caster.size.y / 2 },
        ];
    if (caster.path.length < 3 && (caster.size.x <= 0 || caster.size.y <= 0)) return null;
    const q = transform.worldRotation;
    const angle = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const s = transform.worldScale, o = transform.worldPosition;
    return local.map((p) => {
        const x = p.x * s.x, y = p.y * s.y;
        return { x: o.x + x * cos - y * sin, y: o.y + x * sin + y * cos };
    });
}

/** Whether `viewer` sees `target`: inside its radius (when it has one) and with no wall between. */
export function seesPoint(viewer: SightPoint, radius: number, target: SightPoint, rings: readonly SightRing[]): boolean {
    if (radius > 0 && Math.hypot(target.x - viewer.x, target.y - viewer.y) > radius) return false;
    return !segmentBlocked(viewer, target, rings);
}

interface Fading {
    authored: number;
    shown: number;
}

let ringsNow: SightRing[] = [];

/** The walls the last frame read, for a game that wants the same answer the sprites got. */
export function currentSightRings(): readonly SightRing[] {
    return ringsNow;
}

/** Installs the system that hides and shows sight targets. Returns the function that puts every sprite back as authored. */
export function installSight(app: App): () => void {
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
        [Query(ShadowCaster2D, Transform), Query(SightViewer, Transform), Query(SightTarget, Sprite, Transform), Res(Time), GetWorld()],
        (
            casters: Iterable<[Entity, ShadowCaster2DData, TransformData]>,
            viewers: Iterable<[Entity, SightViewerData, TransformData]>,
            targets: Iterable<[Entity, SightTargetData, SpriteData, TransformData]>,
            time: TimeData, world: World,
        ) => {
            if (isEditor() && !isPlayMode()) {
                if (fading.size > 0) for (const [entity, state] of [...fading]) restore(world, entity, state);
                return;
            }
            const eyes: Array<{ at: SightPoint; radius: number }> = [];
            for (const [, viewer, transform] of viewers) {
                if (viewer.enabled) eyes.push({ at: { x: transform.worldPosition.x, y: transform.worldPosition.y }, radius: viewer.radius });
            }
            const rings: SightRing[] = [];
            if (eyes.length > 0) {
                for (const [, caster, transform] of casters) {
                    const ring = sightRingOf(caster, transform);
                    if (ring) rings.push(ring);
                }
            }
            ringsNow = rings;

            const seen = new Set<Entity>();
            for (const [entity, target, sprite, transform] of targets) {
                seen.add(entity);
                let state = fading.get(entity);
                if (!target.enabled) { if (state) restore(world, entity, state); continue; }
                if (!state) { state = { authored: sprite.color.a, shown: 1 }; fading.set(entity, state); }
                const at = { x: transform.worldPosition.x, y: transform.worldPosition.y };
                // With no viewer at all there is nobody to see: a scene that has not placed its eye yet hides its targets, which is what "seen by none" means.
                const visible = eyes.some((eye) => seesPoint(eye.at, eye.radius, at, rings));
                const goal = visible ? 1 : Math.min(Math.max(target.hiddenOpacity, 0), 1);
                if (state.shown === goal) continue;
                state.shown = stepFade(state.shown, goal, time.delta, target.fadeTime);
                put(world, entity, state.authored * state.shown);
            }
            for (const [entity, state] of [...fading]) if (!seen.has(entity)) restore(world, entity, state);
        },
        { name: 'SightSystem' },
    );
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        ringsNow = [];
        const world = app.world;
        for (const [entity, state] of [...fading]) restore(world, entity, state);
    };
}
