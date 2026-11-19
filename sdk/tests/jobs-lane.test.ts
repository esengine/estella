import { describe, expect, it } from 'vitest';
import { workerLane } from '../src/runtime/jobs';

describe('workerLane', () => {
    it('keeps the ground and the rest on different workers', () => {
        for (const size of [2, 3, 4, 8]) {
            const ground = new Set<number>(), rest = new Set<number>();
            for (let key = -40; key < 40; key++) { ground.add(workerLane({ size }, key * 7919, true)); rest.add(workerLane({ size }, key * 7919, false)); }
            for (const w of ground) expect(rest.has(w)).toBe(false);
            // Every worker has work of one kind or the other.
            expect(ground.size + rest.size).toBe(size);
            for (const w of [...ground, ...rest]) { expect(w).toBeGreaterThanOrEqual(0); expect(w).toBeLessThan(size); }
        }
    });
    it('gives a pool of one its one worker for both', () => {
        expect(workerLane({ size: 1 }, 5, true)).toBe(0);
        expect(workerLane({ size: 1 }, 5, false)).toBe(0);
    });
});
