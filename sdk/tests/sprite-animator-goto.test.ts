import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    registerAnimClip,
    clearAnimClips,
    spriteAnimatorGotoFrame,
    spriteAnimatorGotoLabel,
    type SpriteAnimClip,
    type SpriteAnimatorData,
} from '../src/animation/SpriteAnimator';

function createTestClip(): SpriteAnimClip {
    return {
        name: 'walk',
        fps: 10,
        loop: true,
        frames: [
            { texture: 1 },
            { texture: 2 },
            { texture: 3 },
            { texture: 4 },
        ],
        labels: {
            'start': 0,
            'mid': 2,
        },
    };
}

function createAnimatorData(): SpriteAnimatorData {
    return {
        clip: 'walk',
        speed: 1,
        playing: true,
        loop: true,
        enabled: true,
        currentFrame: 0,
        frameTimer: 0,
    };
}

describe('SpriteAnimator goto', () => {
    beforeEach(() => {
        clearAnimClips();
        registerAnimClip(createTestClip());
    });

    describe('gotoFrame', () => {
        it('should jump to specified frame', () => {
            const data = createAnimatorData();
            spriteAnimatorGotoFrame(data, 2, true);
            expect(data.currentFrame).toBe(2);
            expect(data.frameTimer).toBe(0);
            expect(data.playing).toBe(true);
        });

        it('should clamp to last frame', () => {
            const data = createAnimatorData();
            spriteAnimatorGotoFrame(data, 99, false);
            expect(data.currentFrame).toBe(3);
            expect(data.playing).toBe(false);
        });

        it('should stop when andPlay=false', () => {
            const data = createAnimatorData();
            spriteAnimatorGotoFrame(data, 1, false);
            expect(data.currentFrame).toBe(1);
            expect(data.playing).toBe(false);
        });
    });

    describe('gotoLabel', () => {
        it('should jump to named label', () => {
            const data = createAnimatorData();
            spriteAnimatorGotoLabel(data, 'mid', true);
            expect(data.currentFrame).toBe(2);
            expect(data.playing).toBe(true);
        });

        it('should do nothing for unknown label', () => {
            const data = createAnimatorData();
            data.currentFrame = 1;
            spriteAnimatorGotoLabel(data, 'nonexistent', true);
            expect(data.currentFrame).toBe(1);
        });

        it('should jump to start label', () => {
            const data = createAnimatorData();
            data.currentFrame = 3;
            spriteAnimatorGotoLabel(data, 'start', false);
            expect(data.currentFrame).toBe(0);
            expect(data.playing).toBe(false);
        });
    });
});
