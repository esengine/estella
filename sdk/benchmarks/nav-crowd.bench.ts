// SPDX-License-Identifier: Apache-2.0
import { bench, describe } from 'vitest';
import { NavCrowd, type CrowdBody } from '../src/ai/nav/navCrowd';
import type { Entity } from '../src/types';

// Rebuild the crowd each frame like stepNavigation. Permute spawn order so
// spatially adjacent agents need not be consecutive in the world's query.
for (const spacing of [6, 64]) {
    for (const count of [16, 128, 512]) {
        const bodies: CrowdBody[] = Array.from({ length: count }, (_, i) => {
            const slot = (i * 73) % count;
            return { entity: (i + 1) as Entity, order: i, x: (slot % 32) * spacing,
                z: (slot >> 5) * spacing, radius: 1 + (slot % 3) / 4, vx: 8, vz: 0 };
        });
        function allPairs(): number {
            let total = 0;
            for (const b of bodies) {
                const matches = [];
                for (const other of bodies) {
                    const reach = 6 * (other.radius + b.radius);
                    if (other !== b && Math.hypot(other.x - b.x, other.z - b.z) <= reach) matches.push(other);
                }
                total += matches.length;
            }
            return total;
        }
        const expected = allPairs();
        describe(`navigation neighbours for ${count} bodies, spacing ${spacing}`, () => {
            bench('all pairs', () => {
                if (allPairs() !== expected) throw Error('neighbour count changed');
            });
            bench('frame snapshot', () => {
                const crowd = new NavCrowd(bodies);
                let total = 0;
                for (const b of bodies) total += crowd.neighbours(b.entity, b.x, b.z, b.radius)?.length ?? 0;
                if (total !== expected) throw Error('neighbour count changed');
            });
        });
    }
}
