/**
 * @file    SpriteAnimator.ts
 * @brief   Sprite frame animation component and system (pure TypeScript)
 */

import { defineComponent, type ComponentDef } from '../component';
import { defineResource } from '../resource';
import type { Entity, TextureHandle } from '../types';
import type { World } from '../world';
import { Sprite, type SpriteData } from '../component';

// =============================================================================
// Sprite Animation Clip
// =============================================================================

export interface SpriteAnimFrame {
    texture: TextureHandle;
    duration?: number;
    uvOffset?: { x: number; y: number };
    uvScale?: { x: number; y: number };
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
    if (prevFrame === newFrame && eventFrame === newFrame) return true;
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
export class SpriteAnimationApi {
    private readonly clips = new Map<string, SpriteAnimClip>();
    private readonly entityListeners = new Map<Entity, SpriteAnimEventHandler[]>();
    private readonly globalListeners: SpriteAnimEventHandler[] = [];

    // -- clip registry --------------------------------------------------------

    registerClip(clip: SpriteAnimClip): void {
        this.clips.set(clip.name, clip);
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

            const currentFrame = clip.frames[animator.currentFrame];
            const frameDuration = currentFrame?.duration ?? 1.0 / (clip.fps * animator.speed);

            const needsInitialApply = animator.frameTimer === 0 && animator.currentFrame === 0;
            const prevFrame = animator.currentFrame;

            animator.frameTimer += deltaTime;

            let frameChanged = needsInitialApply;
            if (animator.frameTimer >= frameDuration) {
                animator.frameTimer -= frameDuration;
                animator.currentFrame++;

                if (animator.currentFrame >= clip.frames.length) {
                    if (animator.loop && clip.loop) {
                        animator.currentFrame = 0;
                    } else {
                        animator.currentFrame = clip.frames.length - 1;
                        animator.playing = false;
                    }
                }

                frameChanged = true;
            }

            if (frameChanged) {
                this.fireEvents(entity, clip, prevFrame, animator.currentFrame);
            }

            if (frameChanged && world.has(entity, Sprite)) {
                const frame = clip.frames[animator.currentFrame];
                const sprite = world.get(entity, Sprite) as SpriteData;
                sprite.texture = frame.texture;
                if (frame.uvOffset) {
                    sprite.uvOffset = frame.uvOffset;
                    sprite.uvScale = frame.uvScale!;
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
export const SpriteAnimation = defineResource<SpriteAnimationApi>(null!, 'SpriteAnimation');

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
}

export const SpriteAnimator: ComponentDef<SpriteAnimatorData> = defineComponent('SpriteAnimator', {
    clip: '',
    speed: 1.0,
    playing: true,
    loop: true,
    enabled: true,
    currentFrame: 0,
    frameTimer: 0,
}, {
    assetFields: [{ field: 'clip', type: 'anim-clip' }],
});
