// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  footsteps.ts
 * @brief What a body leaves behind it as it walks: a ring spreading on water, a print in mud, each fading as it ages.
 *
 * @details `Footsteps` goes on what walks. Every `stride` world units it travels it takes a step, alternating left and right of its heading, and what
 *          the step makes depends on what it stands on: `StepSurface` goes on a sprite (the pond, the mud flat, the snow) and its covered ground, the
 *          rectangle of the sprite or the ellipse inside it, is that surface. On water a step is a ring that grows and fades; on a print surface it is
 *          a footprint that stays a while and fades; anywhere else it is nothing, unless the walker says `onBareGround`.
 *
 *          A step is a sprite of its own, spawned and despawned by this system and never saved. With no texture named, the rings and the prints are drawn
 *          once into two small textures: a ring, and a disc that the print's oval is cut from. Name a texture for either and that is used instead.
 *          Prints are a sprite below the walker (`layer`), so they need a layer between the ground and the characters. It runs in play only.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, RuntimeOnly, Sprite, Transform, type SpriteData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule, GetWorld } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { World } from '../ecs/world';
import { isEditor, isPlayMode } from '../ecs/env';
import { coveredGround, coversPoint } from './coverFade';
import { Draw } from './draw';
import { BlendMode } from './blend';
import { Renderer } from './renderer';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { log } from '../util/logger';

/** What a surface makes of a step. */
export enum StepKind {
    /** A ring that spreads and fades. */
    Water = 0,
    /** A footprint that stays a while and fades. */
    Print = 1,
}

/** The fields of the `StepSurface` component. @experimental */
export interface StepSurfaceData {
    kind: StepKind;
    /** The covered ground is the ellipse inside the sprite's rectangle, not the whole of it. */
    round: boolean;
    /** Ground around the sprite's edge that counts as on it, in world units. */
    margin: number;
    enabled: boolean;
}

/**
 * Makes the ground this sprite covers a surface that steps leave water rings or footprints on.
 *
 * @experimental
 */
export const StepSurface = defineComponent<StepSurfaceData>('StepSurface',
    { kind: StepKind.Water, round: false, margin: 0, enabled: true },
    {
        fields: {
            kind: { enum: [{ label: 'Water (a ring)', value: StepKind.Water }, { label: 'Print (a footprint)', value: StepKind.Print }], tooltip: 'What a step on this ground leaves: a ring that spreads, or a footprint.' },
            round: { tooltip: "The covered ground is the ellipse inside the sprite's rectangle and not the whole of it." },
            margin: { min: 0, step: 1, tooltip: "Ground around the sprite's edge that counts as on it, in world units." },
        },
    },
);

/** The fields of the `Footsteps` component. @experimental */
export interface FootstepsData {
    /** How far it travels between two steps, in world units. */
    stride: number;
    /** How far apart the left and right feet are, in world units. */
    width: number;
    /** A footprint's length, in world units, and how long it lasts, in seconds. */
    printSize: number;
    printLife: number;
    printColor: { r: number; g: number; b: number; a: number };
    /** A ring's final size (its width), in world units, and how long it takes to spread and fade, in seconds. */
    rippleSize: number;
    rippleLife: number;
    rippleColor: { r: number; g: number; b: number; a: number };
    /** The sprite layer the steps are drawn on: above the ground, below whatever walks. */
    layer: number;
    /** Also leave a print where there is no surface at all. */
    onBareGround: boolean;
    /** Optional textures for a print and a ring (a texture handle); 0 uses the ones drawn here. */
    printTexture: number;
    rippleTexture: number;
    enabled: boolean;
}

/**
 * Makes what walks leave rings on water and prints on soft ground, by what it stands on (see `StepSurface`).
 *
 * @experimental
 */
export const Footsteps = defineComponent<FootstepsData>('Footsteps',
    {
        stride: 28, width: 10, printSize: 14, printLife: 6, printColor: { r: 0, g: 0, b: 0, a: 0.4 },
        rippleSize: 64, rippleLife: 1.4, rippleColor: { r: 1, g: 1, b: 1, a: 0.7 },
        layer: 1, onBareGround: false, printTexture: 0, rippleTexture: 0, enabled: true,
    },
    {
        fields: {
            stride: { min: 1, step: 1, unit: 'wu', tooltip: 'How far it travels between two steps.' },
            width: { min: 0, step: 1, unit: 'wu', tooltip: 'How far apart the left and right feet are.' },
            printSize: { min: 1, step: 1, unit: 'wu', tooltip: "A footprint's length." },
            printLife: { min: 0.1, step: 0.1, unit: 's', tooltip: 'How long a footprint lasts before it has faded.' },
            rippleSize: { min: 1, step: 1, unit: 'wu', tooltip: "A ring's width when it has spread." },
            rippleLife: { min: 0.1, step: 0.1, unit: 's', tooltip: 'How long a ring takes to spread and fade.' },
            layer: { step: 1, tooltip: 'The sprite layer the steps are drawn on: above the ground, below whatever walks.' },
            onBareGround: { tooltip: 'Also leave a print where there is no StepSurface.' },
        },
    },
);

/** The surface a step lands on: the highest sprite layer of the surfaces that cover the point, or null. */
export function surfaceAt(
    x: number, y: number,
    surfaces: readonly { kind: StepKind; layer: number; centre: { x: number; y: number }; half: { x: number; y: number }; margin: number; round: boolean }[],
): StepKind | null {
    let best: { kind: StepKind; layer: number } | null = null;
    for (const s of surfaces) {
        if (!coversPoint(x, y, s.centre, s.half, s.margin, s.round)) continue;
        if (!best || s.layer >= best.layer) best = { kind: s.kind, layer: s.layer };
    }
    return best ? best.kind : null;
}

/** Where one foot lands: `stride` along from the last step is not asked here; this is the foot's side of a body heading `heading` (radians). */
export function footAt(x: number, y: number, heading: number, width: number, left: boolean): { x: number; y: number } {
    const side = left ? 1 : -1;
    return { x: x - Math.sin(heading) * width * 0.5 * side, y: y + Math.cos(heading) * width * 0.5 * side };
}

/** A step's look at `age` of `life` seconds: how big and how clear. A ring spreads from a third of its size and fades; a print stays full size and fades. */
export function stampLook(kind: StepKind, age: number, life: number): { scale: number; alpha: number } {
    const t = Math.min(Math.max(age / Math.max(life, 1e-3), 0), 1);
    if (kind === StepKind.Water) return { scale: 0.33 + 0.67 * (1 - (1 - t) * (1 - t)), alpha: (1 - t) * (1 - t) };
    return { scale: 1, alpha: 1 - t * t };
}

/** The most steps alive at once, over every walker: a crowd that walks for ever holds a bounded number of sprites. */
const MAX_STEPS = 256;

interface Stamp {
    entity: Entity;
    kind: StepKind;
    age: number;
    life: number;
    width: number;
    length: number;
    color: { r: number; g: number; b: number; a: number };
}

interface Walker {
    x: number;
    y: number;
    carried: number;
    left: boolean;
}

interface DefaultTextures {
    ring: RenderTextureHandle;
    disc: RenderTextureHandle;
}

/** Column-major orthographic projection over a rectangle: what RenderTexture.begin wants. */
function ortho(l: number, r: number, b: number, t: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -1;
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[15] = 1;
    return m;
}

/** Installs the system that takes steps and ages them. Returns the function that puts every step away. */
export function installFootsteps(app: App): () => void {
    const stamps: Stamp[] = [];
    const walkers = new Map<Entity, Walker>();
    let textures: DefaultTextures | null = null;
    let failed = false;

    /** The ring and the disc, drawn once; drawn again where the device was lost. */
    const defaults = (): DefaultTextures | null => {
        if (failed) return null;
        try {
            if (textures && !RenderTexture.contentLost(textures.ring) && !RenderTexture.contentLost(textures.disc)) return textures;
            if (!textures) {
                const ring = RenderTexture.create({ width: 64, height: 64, depth: false, filter: 'linear' });
                const disc = RenderTexture.create({ width: 64, height: 64, depth: false, filter: 'linear' });
                // The renderer may not be up yet: try again next frame.
                if (ring.texture === 0 || disc.texture === 0) { RenderTexture.release(ring); RenderTexture.release(disc); return null; }
                textures = { ring, disc };
            }
            const vp = ortho(-1, 1, -1, 1);
            const paint = (target: RenderTextureHandle, body: () => void): void => {
                RenderTexture.begin(target, vp);
                Draw.begin(vp);
                Renderer.setViewport(0, 0, target.width, target.height);
                Draw.setBlendMode(BlendMode.None);
                Draw.rect({ x: 0, y: 0 }, { x: 2, y: 2 }, { r: 1, g: 1, b: 1, a: 0 });
                body();
                Draw.end();
                RenderTexture.end();
                RenderTexture.contentDrawn(target);
            };
            paint(textures.ring, () => Draw.circleOutline({ x: 0, y: 0 }, 0.86, { r: 1, g: 1, b: 1, a: 1 }, 0.1, 48));
            paint(textures.disc, () => Draw.circle({ x: 0, y: 0 }, 0.95, { r: 1, g: 1, b: 1, a: 1 }, true, 32));
            return textures;
        } catch (error) {
            failed = true;
            log.warn('footsteps', `the footstep textures cannot be drawn on this device: ${String(error)}`);
            return null;
        }
    };

    const away = (world: World, stamp: Stamp): void => {
        if (world.valid(stamp.entity)) world.despawn(stamp.entity);
    };

    interface Request { kind: StepKind; foot: { x: number; y: number }; heading: number; step: FootstepsData }
    const pending: Request[] = [];

    const spawnStep = (world: World, { kind, foot, heading, step }: Request): void => {
        const made = defaults();
        const texture = kind === StepKind.Water ? (step.rippleTexture || made?.ring.texture || 0) : (step.printTexture || made?.disc.texture || 0);
        if (texture === 0) return;
        while (stamps.length >= MAX_STEPS) { away(world, stamps[0]!); stamps.shift(); }
        const entity = world.spawn();
        const half = heading / 2;
        const water = kind === StepKind.Water;
        const color = water ? step.rippleColor : step.printColor;
        // A print is an oval with its length along the heading; a ring is round.
        const length = water ? step.rippleSize : step.printSize;
        const width = water ? step.rippleSize : step.printSize * 0.55;
        world.insert(entity, RuntimeOnly);
        world.insert(entity, Transform, {
            position: { x: foot.x, y: foot.y, z: 0 },
            rotation: water ? { w: 1, x: 0, y: 0, z: 0 } : { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) },
        });
        world.insert(entity, Sprite, {
            texture, size: { x: length * (water ? 0.33 : 1), y: width * (water ? 0.33 : 1) },
            color: { r: color.r, g: color.g, b: color.b, a: color.a }, layer: step.layer,
        });
        stamps.push({ entity, kind, age: 0, life: water ? step.rippleLife : step.printLife, width: width, length, color });
    };

    // system-access: steps are spawned, written and despawned through the world, one sprite each, because they are not authored.
    const system = defineSystem(
        [Query(Footsteps, Transform), Query(StepSurface, Sprite, Transform), Res(Time), GetWorld()],
        (
            movers: Iterable<[Entity, FootstepsData, TransformData]>,
            surfaces: Iterable<[Entity, StepSurfaceData, SpriteData, TransformData]>,
            time: TimeData, world: World,
        ) => {
            if (isEditor() && !isPlayMode()) {
                if (stamps.length > 0) { for (const s of stamps) away(world, s); stamps.length = 0; }
                walkers.clear();
                return;
            }
            // Age what is there, and put away what has run out.
            for (let i = stamps.length - 1; i >= 0; i--) {
                const stamp = stamps[i]!;
                stamp.age += time.delta;
                if (stamp.age >= stamp.life || !world.valid(stamp.entity)) {
                    away(world, stamp);
                    stamps.splice(i, 1);
                    continue;
                }
                const look = stampLook(stamp.kind, stamp.age, stamp.life);
                const sprite = world.get(stamp.entity, Sprite) as SpriteData;
                world.set(stamp.entity, Sprite, {
                    ...sprite,
                    size: { x: stamp.length * look.scale, y: stamp.width * look.scale },
                    color: { r: stamp.color.r, g: stamp.color.g, b: stamp.color.b, a: stamp.color.a * look.alpha },
                });
            }

            const covers: Array<Parameters<typeof surfaceAt>[2][number]> = [];
            const walking = new Set<Entity>();
            let surfacesRead = false;
            for (const [entity, step, transform] of movers) {
                walking.add(entity);
                const here = { x: transform.worldPosition.x, y: transform.worldPosition.y };
                const known = walkers.get(entity);
                if (!known || !step.enabled) { walkers.set(entity, { ...here, carried: 0, left: true }); continue; }
                const dx = here.x - known.x, dy = here.y - known.y;
                const moved = Math.hypot(dx, dy);
                known.x = here.x;
                known.y = here.y;
                if (moved <= 1e-4) continue;
                // A jump across the world (a teleport) is not a walk.
                if (moved > step.stride * 20) { known.carried = 0; continue; }
                known.carried += moved;
                if (known.carried < step.stride) continue;
                const heading = Math.atan2(dy, dx);

                if (!surfacesRead) {
                    surfacesRead = true;
                    for (const [, surface, sprite, st] of surfaces) {
                        if (!surface.enabled) continue;
                        const ground = coveredGround(sprite, st);
                        covers.push({ kind: surface.kind, layer: sprite.layer, centre: ground.centre, half: ground.half, margin: surface.margin, round: surface.round });
                    }
                }
                while (known.carried >= step.stride) {
                    known.carried -= step.stride;
                    known.left = !known.left;
                    const foot = footAt(here.x, here.y, heading, step.width, known.left);
                    const kind = surfaceAt(foot.x, foot.y, covers) ?? (step.onBareGround ? StepKind.Print : null);
                    if (kind === null) continue;
                    // Spawned after the queries are done: an entity cannot be made while they are walked.
                    pending.push({ kind, foot, heading, step });
                }
            }
            for (const entity of [...walkers.keys()]) if (!walking.has(entity)) walkers.delete(entity);
            for (const request of pending.splice(0)) spawnStep(world, request);
        },
        { name: 'FootstepsSystem' },
    );
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        const world = app.world;
        for (const s of stamps) away(world, s);
        stamps.length = 0;
        walkers.clear();
        if (textures) { RenderTexture.release(textures.ring); RenderTexture.release(textures.disc); textures = null; }
    };
}
