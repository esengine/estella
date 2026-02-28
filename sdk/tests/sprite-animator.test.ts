import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/world';
import { Sprite, type SpriteData } from '../src/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';
import {
    SpriteAnimator,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    registerAnimClip,
    unregisterAnimClip,
    getAnimClip,
    clearAnimClips,
    spriteAnimatorSystemUpdate,
} from '../src/animation/SpriteAnimator';

function createAnimTestWorld(): { world: World; registry: CppRegistry } {
    const spriteStore = new Map<Entity, Record<string, unknown>>();
    let nextEntity = 1;

    const registry: Record<string, Function | undefined> = {
        create: () => nextEntity++ as Entity,
        destroy: () => {},
        isValid: (e: Entity) => true,
        delete: () => {},
        removeParent: () => {},
        addSprite(entity: Entity, data: Record<string, unknown>) {
            spriteStore.set(entity, { ...data });
        },
        getSprite(entity: Entity) {
            return spriteStore.get(entity);
        },
        hasSprite(entity: Entity) {
            return spriteStore.has(entity);
        },
        removeSprite(entity: Entity) {
            spriteStore.delete(entity);
        },
    };

    const module = {
        registry_getGeneration: () => 0,
    } as unknown as ESEngineModule;

    const cppRegistry = registry as unknown as CppRegistry;
    const world = new World();
    world.connectCpp(cppRegistry, module);
    return { world, registry: cppRegistry };
}

describe('SpriteAnimator', () => {
    let world: World;

    beforeEach(() => {
        const ctx = createAnimTestWorld();
        world = ctx.world;
        clearAnimClips();
    });

    // =========================================================================
    // Component Definition
    // =========================================================================

    describe('component definition', () => {
        it('should be a named component', () => {
            expect(SpriteAnimator._name).toBe('SpriteAnimator');
        });

        it('should have correct defaults', () => {
            expect(SpriteAnimator._default).toEqual({
                clip: '',
                speed: 1.0,
                playing: true,
                loop: true,
                enabled: true,
                currentFrame: 0,
                frameTimer: 0,
            });
        });

        it('should be a user component (not builtin)', () => {
            expect(SpriteAnimator._builtin).toBe(false);
        });
    });

    // =========================================================================
    // Clip Registry
    // =========================================================================

    describe('clip registry', () => {
        const testClip: SpriteAnimClip = {
            name: 'walk',
            frames: [
                { texture: 1 },
                { texture: 2 },
                { texture: 3 },
            ],
            fps: 10,
            loop: true,
        };

        it('should register and retrieve a clip', () => {
            registerAnimClip(testClip);
            const retrieved = getAnimClip('walk');
            expect(retrieved).toEqual(testClip);
        });

        it('should return undefined for unregistered clip', () => {
            expect(getAnimClip('nonexistent')).toBeUndefined();
        });

        it('should unregister a clip', () => {
            registerAnimClip(testClip);
            unregisterAnimClip('walk');
            expect(getAnimClip('walk')).toBeUndefined();
        });

        it('should clear all clips', () => {
            registerAnimClip(testClip);
            registerAnimClip({ ...testClip, name: 'run' });
            clearAnimClips();
            expect(getAnimClip('walk')).toBeUndefined();
            expect(getAnimClip('run')).toBeUndefined();
        });
    });

    // =========================================================================
    // System Update
    // =========================================================================

    describe('system update', () => {
        const walkClip: SpriteAnimClip = {
            name: 'walk',
            frames: [
                { texture: 10 },
                { texture: 20 },
                { texture: 30 },
            ],
            fps: 10,
            loop: true,
        };

        beforeEach(() => {
            registerAnimClip(walkClip);
        });

        it('should apply first frame texture on initial tick', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 0 });
            world.insert(entity, SpriteAnimator, { clip: 'walk' });

            spriteAnimatorSystemUpdate(world, 0.001);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should advance frame after enough time', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk' });

            // fps=10, frameDuration=0.1s, dt=0.1 should advance one frame
            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(20);
        });

        it('should not advance frame before duration', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk' });

            spriteAnimatorSystemUpdate(world, 0.05);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should loop back to first frame', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk' });

            // Advance through all 3 frames (3 * 0.1 = 0.3s)
            spriteAnimatorSystemUpdate(world, 0.1);
            spriteAnimatorSystemUpdate(world, 0.1);
            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10); // looped back to frame 0
        });

        it('should stop at last frame when loop is false', () => {
            const noLoopClip: SpriteAnimClip = {
                name: 'explode',
                frames: [{ texture: 100 }, { texture: 200 }],
                fps: 10,
                loop: false,
            };
            registerAnimClip(noLoopClip);

            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 100 });
            world.insert(entity, SpriteAnimator, { clip: 'explode', loop: false });

            spriteAnimatorSystemUpdate(world, 0.1); // frame 0 -> 1
            spriteAnimatorSystemUpdate(world, 0.1); // frame 1 -> would be 2, clamp to 1

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(200);

            const animator = world.get(entity, SpriteAnimator) as SpriteAnimatorData;
            expect(animator.playing).toBe(false);
        });

        it('should skip disabled entities', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk', enabled: false });

            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should skip paused entities', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk', playing: false });

            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should skip entities with empty clip name', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: '' });

            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should skip entities with unregistered clip', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'missing_clip' });

            spriteAnimatorSystemUpdate(world, 0.1);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(10);
        });

        it('should respect speed multiplier', () => {
            const entity = world.spawn();
            world.insert(entity, Sprite, { texture: 10 });
            world.insert(entity, SpriteAnimator, { clip: 'walk', speed: 2.0 });

            // speed=2, fps=10, frameDuration=0.05s
            spriteAnimatorSystemUpdate(world, 0.05);

            const sprite = world.get(entity, Sprite) as SpriteData;
            expect(sprite.texture).toBe(20);
        });

        it('should handle multiple entities independently', () => {
            const e1 = world.spawn();
            world.insert(e1, Sprite, { texture: 10 });
            world.insert(e1, SpriteAnimator, { clip: 'walk' });

            const e2 = world.spawn();
            world.insert(e2, Sprite, { texture: 10 });
            world.insert(e2, SpriteAnimator, { clip: 'walk', speed: 2.0 });

            // e1: frameDuration=0.1, e2: frameDuration=0.05
            spriteAnimatorSystemUpdate(world, 0.05);

            const s1 = world.get(e1, Sprite) as SpriteData;
            const s2 = world.get(e2, Sprite) as SpriteData;
            expect(s1.texture).toBe(10); // not advanced yet
            expect(s2.texture).toBe(20); // advanced
        });
    });
});
