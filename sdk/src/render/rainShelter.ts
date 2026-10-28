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
 *          Every frame the shelters are painted into a small texture that covers the view, each one's dryness in its alpha, and a `rain2d` effect
 *          reads that. A shelter costs a rectangle or a few strips of one draw, not a test in the shader on every pixel, so a village of roofs
 *          costs what a hut does.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, Sprite, Transform, type SpriteData, type TransformData } from '../ecs/component';
import { defineSystem, Schedule } from '../ecs/system';
import { Query } from '../ecs/query';
import { CameraView } from '../camera/Camera';
import { coveredGround } from './coverFade';
import { Draw } from './draw';
import { BlendMode } from './blend';
import { Renderer } from './renderer';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { log } from '../util/logger';
import { RAIN_SHELTER_MASK_SIZE, RAIN_SHELTER_MASK_MIN, RAIN_SHELTER_MASK_MAX, RAIN_SHELTER_MASK_TEXTURE } from '../postprocess/rainShelterMask';
import { Quality } from './qualityRuntime';
import { runtimeTextureRef } from '../postprocess/runtimeTextures';
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

/** The fields of the `RainUpright` component. @experimental */
export interface RainUprightData {
    /** Ground around the sprite's edge that the rain still draws on, in world units: the feet, or a trunk's base. */
    inset: number;
    /** Off: the sprite is treated as ground like any other. */
    enabled: boolean;
}

/**
 * Marks a sprite that STANDS on the ground (a character, a trunk, a crate), so the 2D rain's rings, splashes and wet darkening are not drawn over
 * it. The rain is laid over the finished picture and cannot tell a character from the floor under them; this tells it. Falling streaks still cross it.
 *
 * @experimental
 */
export const RainUpright = defineComponent<RainUprightData>('RainUpright',
    { inset: 0, enabled: true },
    {
        fields: {
            inset: { min: 0, step: 1, tooltip: 'Ground around the sprite\'s edge that the rain still draws on, in world units: the feet, or a trunk\'s base.' },
        },
    },
);

/** One upright sprite's rectangle, and how much of it shows (a faded one shows the ground behind it). */
export interface Upright {
    x: number;
    y: number;
    hx: number;
    hy: number;
    amount: number;
}

/** The upright a sprite is, or null where it has no body to keep the rain off. */
export function uprightOf(sprite: SpriteData, transform: TransformData, data: RainUprightData): Upright | null {
    if (!data.enabled || !sprite.enabled) return null;
    const amount = Math.min(Math.max(sprite.color.a, 0), 1);
    if (amount <= 0) return null;
    const { centre, half } = coveredGround(sprite, transform);
    const hx = half.x - data.inset;
    const hy = half.y - data.inset;
    if (hx <= 0 || hy <= 0) return null;
    return { x: centre.x, y: centre.y, hx, hy, amount };
}

/** What to draw for the uprights the view can see: a rectangle each, the amount in the red channel. */
export function uprightRects(uprights: readonly Upright[], view: { left: number; bottom: number; right: number; top: number }): MaskRect[] {
    const rects: MaskRect[] = [];
    for (const u of uprights) {
        if (u.x + u.hx < view.left || u.x - u.hx > view.right || u.y + u.hy < view.bottom || u.y - u.hy > view.top) continue;
        rects.push({ x: u.x, y: u.y, w: u.hx * 2, h: u.hy * 2, dry: u.amount });
    }
    return rects;
}

/** One shelter: its ground and how dry it is. A negative half height says round. */
export interface Shelter {
    x: number;
    y: number;
    hx: number;
    /** Negative for an ellipse. */
    hy: number;
    /** 0 where the ground under it cannot be seen, 1 where all of it can. */
    dry: number;
}

/** A filled rectangle of the mask, centred, in world units. */
export interface MaskRect {
    x: number;
    y: number;
    w: number;
    h: number;
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

/** How many strips an ellipse is cut into at the default mask size. */
export const ELLIPSE_STRIPS = 32;

/** The size a mask is painted at: what the effect asks for, held to what the quality level allows (none: as asked), in whole sixteens of texels. */
export function shelterMaskSizeOf(asked: number, allowed: number | null): number {
    const wanted = Number.isFinite(asked) ? asked : RAIN_SHELTER_MASK_SIZE;
    const size = Math.round(Math.min(wanted, allowed ?? wanted) / 16) * 16;
    return Math.min(Math.max(size, RAIN_SHELTER_MASK_MIN), RAIN_SHELTER_MASK_MAX);
}

/** How many strips an ellipse is cut into for a mask this big: one per sixteen texels, since more would draw what the mask cannot show. */
export function ellipseStripsOf(size: number): number {
    return Math.min(Math.max(Math.round(size / 16), 8), 64);
}

/**
 * What to draw for the shelters: a rectangle each, an ellipse as strips of one, the driest last so where two overlap the drier wins (a draw
 * overwrites, and a max is what overlapping shelters want). The mask is not drawn for shelters the view cannot see.
 *
 * @param view  The world rectangle the mask covers.
 */
export function maskRects(
    shelters: readonly Shelter[], view: { left: number; bottom: number; right: number; top: number }, strips: number = ELLIPSE_STRIPS,
): MaskRect[] {
    const rects: MaskRect[] = [];
    const ordered = [...shelters].sort((a, b) => a.dry - b.dry);
    for (const s of ordered) {
        const h = Math.abs(s.hy);
        if (s.x + s.hx < view.left || s.x - s.hx > view.right || s.y + h < view.bottom || s.y - h > view.top) continue;
        if (s.hy >= 0) {
            rects.push({ x: s.x, y: s.y, w: s.hx * 2, h: h * 2, dry: s.dry });
            continue;
        }
        const strip = (h * 2) / strips;
        for (let i = 0; i < strips; i++) {
            const t = ((i + 0.5) / strips) * 2 - 1;
            const width = s.hx * 2 * Math.sqrt(Math.max(1 - t * t, 0));
            if (width <= 0) continue;
            rects.push({ x: s.x, y: s.y + t * h, w: width, h: strip, dry: s.dry });
        }
    }
    return rects;
}

/** The mask as the last frame painted it: the texture the effect reads and the world rectangle it covers. */
interface MaskState {
    ref: string;
    left: number;
    bottom: number;
    width: number;
    height: number;
}

let maskNow: MaskState | null = null;
/** The mask size the last resolved `rain2d` asked for. */
let askedSize = RAIN_SHELTER_MASK_SIZE;

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

/**
 * Hands a `rain2d` effect the mask painted this frame and where it lies in the world; with no mask (no shelters, no view) the effect
 * keeps its black default, which is dry nowhere. Other effects, and a disabled rain, are left alone.
 */
export function applyRainSheltersToRain(effects: Map<string, BlendedEffect>): void {
    const rain = effects.get('rain2d');
    if (!rain || !rain.enabled) return;
    const mask = maskNow;
    askedSize = rain.uniforms.get('u_maskSize') ?? RAIN_SHELTER_MASK_SIZE;
    rain.uniforms.set('u_maskL', mask ? mask.left : 0);
    rain.uniforms.set('u_maskB', mask ? mask.bottom : 0);
    rain.uniforms.set('u_maskW', mask ? mask.width : 0);
    rain.uniforms.set('u_maskH', mask ? mask.height : 0);
    if (mask) rain.textures.set(RAIN_SHELTER_MASK_TEXTURE, mask.ref);
}

/** Installs the system that lists the shelters and paints the mask each frame. Returns the function that lets both go. */
export function installRainShelter(app: App): () => void {
    let target: RenderTextureHandle | null = null;
    let failed = false;

    /** The size the quality level lets the mask be, or null with no quality policy running. */
    const allowedSize = (): number | null => {
        const policy = app.hasResource(Quality) ? app.getResource(Quality) : null;
        return policy && policy.enabled ? policy.profile.shelterMaskSize : null;
    };

    /** The world rectangle the camera shows, or null where there is none to cover. */
    const viewOf = (): { left: number; right: number; bottom: number; top: number } | null => {
        const view = app.hasResource(CameraView) ? app.getResource(CameraView).getWorldBounds() : null;
        return view && view.right > view.left && view.top > view.bottom ? view : null;
    };

    const paint = (rects: readonly MaskRect[], stands: readonly MaskRect[], view: { left: number; right: number; bottom: number; top: number }): boolean => {
        if (failed) return false;
        try {
            const size = shelterMaskSizeOf(askedSize, allowedSize());
            // Asked for another size (the effect's field, or the level changed): the old one goes and a new one is made.
            if (target && target.width !== size) { RenderTexture.release(target); target = null; }
            if (!target) {
                const created = RenderTexture.create({ width: size, height: size, depth: false, filter: 'linear' });
                // The renderer may not be up yet: try again next frame.
                if (created.textureId === 0 || created.texture === 0) { RenderTexture.release(created); return false; }
                target = created;
            }
            const vp = ortho(view.left, view.right, view.bottom, view.top);
            const cx = (view.left + view.right) / 2;
            const cy = (view.bottom + view.top) / 2;
            RenderTexture.begin(target, vp);
            Draw.begin(vp);
            // Draw.begin resets the viewport to the screen's; the target's own is what this pass is.
            Renderer.setViewport(0, 0, target.width, target.height);
            // Blend off, so a draw writes its colour AND its alpha as given, and the dryness in the alpha is exact whatever the colour space does to the colour.
            Draw.setBlendMode(BlendMode.None);
            Draw.rect({ x: cx, y: cy }, { x: view.right - view.left, y: view.top - view.bottom }, { r: 0, g: 0, b: 0, a: 0 });
            for (const r of rects) Draw.rect({ x: r.x, y: r.y }, { x: r.w, y: r.h }, { r: 0, g: 0, b: 0, a: r.dry });
            // What stands on the ground goes in the red channel, and Lighten keeps the alpha the shelters wrote.
            Draw.setBlendMode(BlendMode.Lighten);
            for (const r of stands) Draw.rect({ x: r.x, y: r.y }, { x: r.w, y: r.h }, { r: r.dry, g: 0, b: 0, a: 0 });
            Draw.end();
            RenderTexture.end();
            RenderTexture.contentDrawn(target);
            maskNow = {
                ref: runtimeTextureRef(RAIN_SHELTER_MASK_TEXTURE, target.texture),
                left: view.left, bottom: view.bottom, width: view.right - view.left, height: view.top - view.bottom,
            };
            return true;
        } catch (error) {
            failed = true;
            log.warn('rain', `the rain shelter mask cannot be painted on this device: ${String(error)}`);
            return false;
        }
    };

    const system = defineSystem(
        [Query(RainShelter, Sprite, Transform), Query(RainUpright, Sprite, Transform)],
        (shelters: Iterable<[Entity, RainShelterData, SpriteData, TransformData]>, uprights: Iterable<[Entity, RainUprightData, SpriteData, TransformData]>) => {
            const found: Shelter[] = [];
            for (const [, data, sprite, transform] of shelters) {
                const shelter = shelterOf(sprite, transform, data);
                if (shelter) found.push(shelter);
            }
            const standing: Upright[] = [];
            for (const [, data, sprite, transform] of uprights) {
                const upright = uprightOf(sprite, transform, data);
                if (upright) standing.push(upright);
            }
            sheltersNow = found;
            maskNow = null;
            if (found.length === 0 && standing.length === 0) return;
            const view = viewOf();
            if (view) paint(maskRects(found, view, ellipseStripsOf(shelterMaskSizeOf(askedSize, allowedSize()))), uprightRects(standing, view), view);
        },
        { name: 'RainShelterSystem' },
    );
    // After the cover fade has moved the sprites' alpha (it is installed first), and before the frame is drawn.
    app.addSystemToSchedule(Schedule.PostUpdate, system);

    return () => {
        sheltersNow = [];
        maskNow = null;
        if (target) RenderTexture.release(target);
        target = null;
    };
}
