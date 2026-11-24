// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NavCrowd, type CrowdBody } from '../src/ai/nav/navCrowd';
import type { Entity } from '../src/types';

function body(order: number, x: number, z: number, radius: number): CrowdBody {
    return { entity: (8192 - order) as Entity, order, x, z, radius, vx: 0, vz: 0 };
}

function exhaustive(bodies: readonly CrowdBody[], self: Entity, x: number, z: number, radius: number) {
    return bodies.filter(b => b.entity !== self && !(Math.hypot(b.x - x, b.z - z) > 6 * (radius + b.radius)));
}

describe('navigation crowd neighbours', () => {
    it('matches an ordered circle query across cells, radius scales and negative coordinates', () => {
        const bodies = Array.from({ length: 256 }, (_, i) => {
            const slot = (i * 73) % 256;
            return body(i, ((slot % 16) - 8) * 12, ((slot >> 4) - 8) * 12, [0.125, 1, 1.5, 3][slot % 4]!);
        });
        bodies.push(body(256, -78, -43, 24), body(257, 0, 0, 1), body(258, 12, 0, 1), body(259, 12.00001, 0, 1));
        const crowd = new NavCrowd(bodies);
        for (const b of bodies) {
            for (const offset of [0, -0.01, 7]) {
                // A live seeker may have moved since the frame's collision snapshot.
                const x = b.x + offset, z = b.z - offset;
                expect(crowd.neighbours(b.entity, x, z, b.radius) ?? []).toEqual(exhaustive(bodies, b.entity, x, z, b.radius));
            }
        }
        const others = crowd.neighbours(bodies[257]!.entity, 0, 0, 1)!;
        expect(others).toContain(bodies[258]);
        expect(others).not.toContain(bodies[259]);
    });

    it('keeps sparse lookups local when one body is much larger', () => {
        let coordinateReads = 0;
        const bodies = Array.from({ length: 512 }, (_, i) => {
            const x = (i % 32) * 80;
            return { ...body(i, x, (i >> 5) * 80, i === 173 ? 512 : 1),
                get x() { coordinateReads++; return x; } };
        });
        const crowd = new NavCrowd(bodies);
        const giant = bodies[173]!;
        for (const b of bodies) {
            const found = crowd.neighbours(b.entity, b.x, b.z, b.radius);
            if (b === giant) expect(found).toHaveLength(511);
            else expect(found).toEqual([giant]);
        }
        expect(coordinateReads).toBeLessThan(bodies.length * 16);
    });

    it('includes a different-sized body on a rounded distance boundary', () => {
        const bodies = Array.from({ length: 64 }, (_, i) => body(i, 32 + i * 64, 0, 1));
        const crowd = new NavCrowd(bodies);
        const seeker = 0 as Entity;
        const x = 16 - 8 * Number.EPSILON;
        const radius = 5 / 3;
        expect(32 - x).toBe(6 * (1 + radius));
        for (let i = 0; i < 2; i++) {
            expect(crowd.neighbours(seeker, x, 0, radius)).toEqual([bodies[0]]);
        }
    });

    it('keeps the linear predicate for coordinates outside the integer cell range', () => {
        const bodies = Array.from({ length: 64 }, (_, i) => body(i, i * 32, -i * 32, 1));
        const crowd = new NavCrowd(bodies);
        const self = bodies[0]!.entity;
        for (const x of [0, 0, Number.MAX_VALUE, Infinity, NaN]) {
            expect(crowd.neighbours(self, x, 0, 1) ?? []).toEqual(exhaustive(bodies, self, x, 0, 1));
        }
        bodies.push(body(64, Number.MAX_VALUE, 0, 2));
        const unbounded = new NavCrowd(bodies);
        for (const x of [0, Number.MAX_VALUE]) {
            expect(unbounded.neighbours(self, x, 0, 1) ?? []).toEqual(exhaustive(bodies, self, x, 0, 1));
        }
    });
});
