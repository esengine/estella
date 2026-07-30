// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpriteAnimator.ts
 * @brief   Sprite frame animation component and system (pure TypeScript)
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import type { Entity, TextureHandle } from '../types';
import type { World } from '../ecs/world';
import { Sprite, type SpriteData } from '../ecs/component';

// =============================================================================
// Sprite Animation Clip
// =============================================================================

export interface SpriteAnimFrame {
    texture: TextureHandle;
    duration?: number;
    uvOffset?: { x: number; y: number };
    uvScale?: { x: number; y: number };
    /**
     * The anchor this frame renders with, in `Sprite.pivot`'s own space — resolved
     * at load time from the clip's per-frame/clip-wide anchors. Absent on EVERY
     * frame of a clip that authors no anchors, which is what keeps playback from
     * touching a pivot the entity owns.
     */
    pivot?: { x: number; y: number };
}

export interface SpriteAnimEvent {
    frame: number;
    name: string;
    data?: unknown;
}

export type SpriteAnimEventHandler = (event: SpriteAnimEvent, entity: Entity) => void;

export interface SpriteAnimClip {
    name: string;
    frames: SpriteAnimFrame[];
    fps: number;
    loop: boolean;
    labels?: Record<string, number>;
    events?: SpriteAnimEvent[];
}

export function shouldFireEvent(eventFrame: number, prevFrame: number, newFrame: number, totalFrames: number, loop: boolean): boolean {
    // Frame-0 initial apply only. Without the `=== 0`, the completion clamp
    // (currentFrame overflows → clamped to last, so prev === new === last) re-fires
    // the last frame's event a second time.
    if (prevFrame === newFrame && eventFrame === newFrame && newFrame === 0) return true;
    if (newFrame > prevFrame) {
        return eventFrame > prevFrame && eventFrame <= newFrame;
    }
    if (loop && newFrame < prevFrame) {
        return eventFrame > prevFrame || eventFrame <= newFrame;
    }
    return false;
}

// =============================================================================
// SpriteAnimation — per-App clip registry + frame-event listeners + system
// =============================================================================

/**
 * Owns one App's sprite-animation clip registry and frame-event listeners,
 * advances SpriteAnimator components, and drives goto-frame/label. Published as
 * the {@link SpriteAnimation} resource; read it as
 * `app.getResource(SpriteAnimation)`.
 */
export class SpriteAnimationAPI {
    private readonly clips = new Map<string, SpriteAnimClip>();
    private readonly entityListeners = new Map<Entity, SpriteAnimEventHandler[]>();
    private readonly globalListeners: SpriteAnimEventHandler[] = [];

    // -- clip registry --------------------------------------------------------

    registerClip(clip: SpriteAnimClip): void {
        this.clips.set(clip.name, clip);
    }

    /**
     * Register an EXISTING clip object under an additional lookup name. Loaders
     * register a clip under its resolved load path, which in some realms is an
     * absolute URL — components reference the serialized project-relative ref,
     * so the two must alias to the SAME object (events attached through one
     * name fire for the other).
     */
    aliasClip(name: string, clip: SpriteAnimClip): void {
        this.clips.set(name, clip);
    }

    unregisterClip(name: string): void {
        this.clips.delete(name);
    }

    getClip(name: string): SpriteAnimClip | undefined {
        return this.clips.get(name);
    }

    clearClips(): void {
        this.clips.clear();
    }

    // -- frame-event listeners ------------------------------------------------

    onEvent(entity: Entity, handler: SpriteAnimEventHandler): () => void {
        let list = this.entityListeners.get(entity);
        if (!list) {
            list = [];
            this.entityListeners.set(entity, list);
        }
        list.push(handler);
        return () => {
            const arr = this.entityListeners.get(entity);
            if (arr) {
                const idx = arr.indexOf(handler);
                if (idx >= 0) arr.splice(idx, 1);
                if (arr.length === 0) this.entityListeners.delete(entity);
            }
        };
    }

    onEventGlobal(handler: SpriteAnimEventHandler): () => void {
        this.globalListeners.push(handler);
        return () => {
            const idx = this.globalListeners.indexOf(handler);
            if (idx >= 0) this.globalListeners.splice(idx, 1);
        };
    }

    removeEntityListeners(entity: Entity): void {
        this.entityListeners.delete(entity);
    }

    private fireEvents(entity: Entity, clip: SpriteAnimClip, prevFrame: number, newFrame: number): void {
        if (!clip.events || clip.events.length === 0) return;

        for (const evt of clip.events) {
            if (shouldFireEvent(evt.frame, prevFrame, newFrame, clip.frames.length, clip.loop)) {
                const listeners = this.entityListeners.get(entity);
                if (listeners) {
                    for (const handler of listeners) {
                        handler(evt, entity);
                    }
                }
                for (const handler of this.globalListeners) {
                    handler(evt, entity);
                }
            }
        }
    }

    // -- per-frame system -----------------------------------------------------

    update(world: World, deltaTime: number): void {
        const entities = world.getEntitiesWithComponents([SpriteAnimator]);

        for (const entity of entities) {
            const animator = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
            if (!animator.enabled || !animator.playing || !animator.clip) continue;

            const clip = this.clips.get(animator.clip);
            if (!clip || clip.frames.length === 0) continue;

            // playing raised on a finished one-shot = replay from the top
            // (TimelinePlayer's flag contract).
            if (animator.finished) {
                animator.finished = false;
                animator.currentFrame = 0;
                animator.frameTimer = 0;
            }

            // Speed scales EVERY frame's duration (not just the fps fallback), and
            // is guarded: 0/negative would otherwise freeze (Infinity) or run the
            // timer backward.
            const speed = Math.max(animator.speed, 1e-4);
            const durationOf = (i: number): number =>
                (clip.frames[i]?.duration ?? 1.0 / clip.fps) / speed;

            const needsInitialApply = animator.frameTimer === 0 && animator.currentFrame === 0;
            const prevFrame = animator.currentFrame;

            animator.frameTimer += deltaTime;

            let frameChanged = needsInitialApply;
            // Advance as MANY frames as elapsed — a fast clip (fps·speed > host fps)
            // or a lag spike can cross several in one update; a single `if` would
            // play in slow motion and let frameTimer grow unbounded. Capped at ~one
            // full loop so a huge dt can't spin forever.
            let guard = clip.frames.length + 1;
            let frameDuration = durationOf(animator.currentFrame);
            while (animator.playing && animator.frameTimer >= frameDuration && guard-- > 0) {
                animator.frameTimer -= frameDuration;
                animator.currentFrame++;
                if (animator.currentFrame >= clip.frames.length) {
                    if (animator.loop && clip.loop) {
                        animator.currentFrame = 0;
                    } else {
                        animator.currentFrame = clip.frames.length - 1;
                        animator.playing = false;
                        animator.finished = true;
                    }
                }
                frameChanged = true;
                frameDuration = durationOf(animator.currentFrame);
            }

            if (frameChanged) {
                this.fireEvents(entity, clip, prevFrame, animator.currentFrame);
            }

            if (frameChanged && world.has(entity, Sprite)) {
                const frame = clip.frames[animator.currentFrame];
                const sprite = world.get(entity, Sprite) as SpriteData;
                sprite.texture = frame.texture;
                // Copy (don't alias the clip's frame objects), and RESET to the full
                // texture when a frame carries no sub-rect — else a plain frame after
                // a sheet-cell frame renders through the stale cell window.
                if (frame.uvOffset) {
                    sprite.uvOffset = { x: frame.uvOffset.x, y: frame.uvOffset.y };
                    sprite.uvScale = frame.uvScale ? { x: frame.uvScale.x, y: frame.uvScale.y } : { x: 1, y: 1 };
                } else {
                    sprite.uvOffset = { x: 0, y: 0 };
                    sprite.uvScale = { x: 1, y: 1 };
                }
                // No reset branch: the loader gives EVERY frame of an anchor-authoring
                // clip a pivot, so absent here means the clip authors none at all and
                // the entity's own pivot stands.
                if (frame.pivot) {
                    sprite.pivot = { x: frame.pivot.x, y: frame.pivot.y };
                }
                world.insert(entity, Sprite, sprite);
            }

            if (frameChanged) {
                world.insert(entity, SpriteAnimator, animator);
            }
        }
    }

    // -- goto frame / label ---------------------------------------------------

    gotoFrame(animator: SpriteAnimatorData, frameIndex: number, andPlay: boolean = true): void {
        const clip = this.clips.get(animator.clip);
        if (!clip || clip.frames.length === 0) return;

        animator.currentFrame = Math.max(0, Math.min(frameIndex, clip.frames.length - 1));
        animator.frameTimer = 0;
        animator.playing = andPlay;
        animator.finished = false;
    }

    gotoLabel(animator: SpriteAnimatorData, label: string, andPlay: boolean = true): void {
        const clip = this.clips.get(animator.clip);
        if (!clip || !clip.labels) return;

        const frameIndex = clip.labels[label];
        if (frameIndex === undefined) return;

        this.gotoFrame(animator, frameIndex, andPlay);
    }
}

/**
 * Per-App sprite-animation resource (clip registry + frame-event listeners),
 * published by `AnimationPlugin`. Read as `app.getResource(SpriteAnimation)`.
 */
export const SpriteAnimation = defineResource<SpriteAnimationAPI>(null!, 'SpriteAnimation');

// =============================================================================
// SpriteAnimator Component
// =============================================================================

export interface SpriteAnimatorData {
    clip: string;
    speed: number;
    playing: boolean;
    loop: boolean;
    enabled: boolean;
    currentFrame: number;
    frameTimer: number;
    /** Latched when a one-shot clip completes; runtime-only, do not author.
     *  Raising `playing` on a finished animator replays from frame 0 — the
     *  same flag contract as TimelinePlayer. */
    finished: boolean;
}

export const SpriteAnimator: ComponentDef<SpriteAnimatorData> = defineComponent('SpriteAnimator', {
    clip: '',
    speed: 1.0,
    playing: true,
    loop: true,
    enabled: true,
    currentFrame: 0,
    frameTimer: 0,
    finished: false,
}, {
    assetFields: [{ field: 'clip', type: 'anim-clip' }],
});
