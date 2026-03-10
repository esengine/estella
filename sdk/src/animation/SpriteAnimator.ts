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

export interface SpriteAnimClip {
    name: string;
    frames: SpriteAnimFrame[];
    fps: number;
    loop: boolean;
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
