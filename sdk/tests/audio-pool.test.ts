import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioPool, type PooledAudioNode } from '../src/audio/AudioPool';

function createMockAudioContext(): AudioContext {
    const ctx = {
        currentTime: 0,
        createGain: vi.fn(),
        createStereoPanner: vi.fn(),
    } as unknown as AudioContext;

    (ctx.createGain as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        gain: { value: 1.0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        context: ctx,
    }));

    (ctx.createStereoPanner as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        pan: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
    }));

    return ctx;
}

describe('AudioPool', () => {
    let context: AudioContext;

    beforeEach(() => {
        context = createMockAudioContext();
    });

    it('should pre-allocate initialSize nodes', () => {
        const pool = new AudioPool(context, 8);
        expect(pool.capacity).toBe(8);
        expect(pool.activeCount).toBe(0);
    });

    it('should default to 16 pre-allocated slots', () => {
        const pool = new AudioPool(context);
        expect(pool.capacity).toBe(16);
    });

    describe('acquire', () => {
        it('should acquire a free node', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            expect(node).not.toBeNull();
            expect(node.inUse).toBe(true);
            expect(pool.activeCount).toBe(1);
        });

        it('should reset gain and pan on acquire', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            expect(node.gain.gain.value).toBe(1.0);
            expect(node.panner.pan.value).toBe(0);
        });

        it('should set priority and startTime', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire(5);
            expect(node.priority).toBe(5);
            expect(node.startTime).toBe(0);
        });

        it('should expand pool when all nodes are in use', () => {
            const pool = new AudioPool(context, 2);
            pool.acquire();
            pool.acquire();
            expect(pool.capacity).toBe(2);

            const node = pool.acquire();
            expect(node).not.toBeNull();
            expect(node.inUse).toBe(true);
            expect(pool.activeCount).toBe(3);
            expect(pool.capacity).toBe(3);
        });

        it('should expand to accommodate many concurrent sounds', () => {
            const pool = new AudioPool(context, 2);
            const nodes: PooledAudioNode[] = [];
            for (let i = 0; i < 100; i++) {
                const n = pool.acquire();
                expect(n).not.toBeNull();
                nodes.push(n);
            }
            expect(pool.activeCount).toBe(100);
            expect(pool.capacity).toBe(100);
        });

        it('should reuse released nodes before expanding', () => {
            const pool = new AudioPool(context, 2);
            const n1 = pool.acquire();
            pool.acquire();
            pool.release(n1);

            pool.acquire();
            expect(pool.capacity).toBe(2);
            expect(pool.activeCount).toBe(2);
        });
    });

    describe('release', () => {
        it('should mark node as free', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            expect(pool.activeCount).toBe(1);
            pool.release(node);
            expect(pool.activeCount).toBe(0);
            expect(node.inUse).toBe(false);
        });

        it('should stop and disconnect source', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            const mockSource = {
                stop: vi.fn(),
                disconnect: vi.fn(),
            } as unknown as AudioBufferSourceNode;
            node.source = mockSource;

            pool.release(node);
            expect(mockSource.stop).toHaveBeenCalled();
            expect(mockSource.disconnect).toHaveBeenCalled();
            expect(node.source).toBeNull();
        });

        it('should handle already stopped source gracefully', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            node.source = {
                stop: vi.fn().mockImplementation(() => { throw new Error('already stopped'); }),
                disconnect: vi.fn(),
            } as unknown as AudioBufferSourceNode;

            expect(() => pool.release(node)).not.toThrow();
        });

        it('should be idempotent on double release', () => {
            const pool = new AudioPool(context, 4);
            const node = pool.acquire();
            expect(pool.activeCount).toBe(1);

            pool.release(node);
            expect(pool.activeCount).toBe(0);

            pool.release(node);
            expect(pool.activeCount).toBe(0);
        });
    });

    describe('activeCount', () => {
        it('should track acquire/release accurately', () => {
            const pool = new AudioPool(context, 4);
            expect(pool.activeCount).toBe(0);

            const n1 = pool.acquire();
            const n2 = pool.acquire();
            expect(pool.activeCount).toBe(2);

            pool.release(n1);
            expect(pool.activeCount).toBe(1);

            pool.release(n2);
            expect(pool.activeCount).toBe(0);
        });
    });
});
