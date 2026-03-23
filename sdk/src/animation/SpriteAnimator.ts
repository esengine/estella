/**
 * @file    SpriteAnimator.ts
 * @brief   Sprite frame animation component and system (pure TypeScript)
 */

import { defineComponent, type ComponentDef } from '../component';
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

// =============================================================================
// Clip Registry
// =============================================================================

const clipRegistry = new Map<string, SpriteAnimClip>();

export function registerAnimClip(clip: SpriteAnimClip): void {
    clipRegistry.set(clip.name, clip);
}

export function unregisterAnimClip(name: string): void {
    clipRegistry.delete(name);
}

export function getAnimClip(name: string): SpriteAnimClip | undefined {
    return clipRegistry.get(name);
}

export function clearAnimClips(): void {
    clipRegistry.clear();
}

// =============================================================================
// Frame Event Listeners
// =============================================================================

const animEventListeners = new Map<Entity, SpriteAnimEventHandler[]>();
const globalAnimEventListeners: SpriteAnimEventHandler[] = [];

export function onAnimEvent(entity: Entity, handler: SpriteAnimEventHandler): () => void {
    let list = animEventListeners.get(entity);
    if (!list) {
        list = [];
        animEventListeners.set(entity, list);
    }
    list.push(handler);
    return () => {
        const arr = animEventListeners.get(entity);
        if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
            if (arr.length === 0) animEventListeners.delete(entity);
        }
    };
}

export function onAnimEventGlobal(handler: SpriteAnimEventHandler): () => void {
    globalAnimEventListeners.push(handler);
    return () => {
        const idx = globalAnimEventListeners.indexOf(handler);
        if (idx >= 0) globalAnimEventListeners.splice(idx, 1);
    };
}

export function removeAnimEventListeners(entity: Entity): void {
    animEventListeners.delete(entity);
}

function fireAnimEvents(entity: Entity, clip: SpriteAnimClip, prevFrame: number, newFrame: number): void {
    if (!clip.events || clip.events.length === 0) return;

    for (const evt of clip.events) {
        if (shouldFireEvent(evt.frame, prevFrame, newFrame, clip.frames.length, clip.loop)) {
            const listeners = animEventListeners.get(entity);
            if (listeners) {
                for (const handler of listeners) {
                    handler(evt, entity);
                }
            }
            for (const handler of globalAnimEventListeners) {
                handler(evt, entity);
            }
        }
    }
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

// =============================================================================
// SpriteAnimator System
// =============================================================================

export function spriteAnimatorSystemUpdate(world: World, deltaTime: number): void {
    const entities = world.getEntitiesWithComponents([SpriteAnimator]);

    for (const entity of entities) {
        const animator = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
        if (!animator.enabled || !animator.playing || !animator.clip) continue;

        const clip = clipRegistry.get(animator.clip);
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
            fireAnimEvents(entity, clip, prevFrame, animator.currentFrame);
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

// =============================================================================
// Goto Frame / Label
// =============================================================================

export function spriteAnimatorGotoFrame(
    animator: SpriteAnimatorData,
    frameIndex: number,
    andPlay: boolean = true,
): void {
    const clip = clipRegistry.get(animator.clip);
    if (!clip || clip.frames.length === 0) return;

    animator.currentFrame = Math.max(0, Math.min(frameIndex, clip.frames.length - 1));
    animator.frameTimer = 0;
    animator.playing = andPlay;
}

export function spriteAnimatorGotoLabel(
    animator: SpriteAnimatorData,
    label: string,
    andPlay: boolean = true,
): void {
    const clip = clipRegistry.get(animator.clip);
    if (!clip || !clip.labels) return;

    const frameIndex = clip.labels[label];
    if (frameIndex === undefined) return;

    spriteAnimatorGotoFrame(animator, frameIndex, andPlay);
}
