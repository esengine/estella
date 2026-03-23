import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    type SpriteAnimClip,
    type SpriteAnimEvent,
    registerAnimClip,
    clearAnimClips,
    onAnimEvent,
    onAnimEventGlobal,
    removeAnimEventListeners,
} from '../src/animation/SpriteAnimator';

import { shouldFireEvent } from '../src/animation/SpriteAnimator';

describe('SpriteAnimator Frame Events', () => {
    beforeEach(() => {
        clearAnimClips();
    });

    describe('shouldFireEvent', () => {
        it('fires when frame advances past event frame', () => {
            expect(shouldFireEvent(2, 1, 3, 5, false)).toBe(true);
        });

        it('fires on exact frame', () => {
            expect(shouldFireEvent(2, 1, 2, 5, false)).toBe(true);
        });

        it('does not fire when event frame not in range', () => {
            expect(shouldFireEvent(4, 1, 3, 5, false)).toBe(false);
        });

        it('fires across loop boundary', () => {
            expect(shouldFireEvent(1, 4, 1, 5, true)).toBe(true);
        });

        it('fires for frame 0 on loop wrap', () => {
            expect(shouldFireEvent(0, 3, 0, 4, true)).toBe(true);
        });

        it('does not fire across boundary without loop', () => {
            expect(shouldFireEvent(1, 4, 1, 5, false)).toBe(false);
        });
    });

    describe('onAnimEvent', () => {
        it('registers and removes listener', () => {
            const handler = vi.fn();
            const unsub = onAnimEvent(1 as any, handler);
            unsub();
        });
    });

    describe('onAnimEventGlobal', () => {
        it('registers and removes global listener', () => {
            const handler = vi.fn();
            const unsub = onAnimEventGlobal(handler);
            unsub();
        });
    });

    describe('removeAnimEventListeners', () => {
        it('removes all listeners for entity', () => {
            const handler = vi.fn();
            onAnimEvent(1 as any, handler);
            onAnimEvent(1 as any, handler);
            removeAnimEventListeners(1 as any);
        });
    });

    describe('clip events definition', () => {
        it('stores events on clip', () => {
            const clip: SpriteAnimClip = {
                name: 'attack',
                frames: [{ texture: 1 as any }, { texture: 2 as any }, { texture: 3 as any }],
                fps: 10,
                loop: false,
                events: [
                    { frame: 1, name: 'hit' },
                    { frame: 2, name: 'end', data: { sound: 'swoosh' } },
                ],
            };
            registerAnimClip(clip);
            expect(clip.events).toHaveLength(2);
            expect(clip.events![0].name).toBe('hit');
            expect(clip.events![1].data).toEqual({ sound: 'swoosh' });
        });
    });
});
