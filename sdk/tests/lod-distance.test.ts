// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A distance a rule names, as the screen size a LODGroup compares — on the sphere the engine measures.
 */
import { describe, it, expect } from 'vitest';
import { LOD_REFERENCE_FOV_DEG, lodCullSizeWithin, lodSizeAtDistance, lodSphereRadius } from '../src/render/lodDistance';

/** The engine's side (lod::screenRelativeSize, on the view's axis): how far a sphere is when it covers `size` of the screen. */
const distanceAtSize = (radius: number, size: number, fovDeg = LOD_REFERENCE_FOV_DEG): number =>
    radius / (size * Math.tan((fovDeg / 2) * Math.PI / 180));

describe('lodSphereRadius', () => {
    it('is the half-diagonal of the box that holds every level', () => {
        const fine = { aabbMin: [0, 0, 0] as const, aabbMax: [6, 0, 8] as const };
        expect(lodSphereRadius([fine])).toBeCloseTo(5);
        // The far cards stand taller than the near mesh: the engine measures the union.
        const far = { aabbMin: [0, 0, 0] as const, aabbMax: [6, 24, 8] as const };
        expect(lodSphereRadius([fine, far])).toBeCloseTo(13);
        expect(lodSphereRadius([fine, null])).toBeCloseTo(5);
        expect(lodSphereRadius([])).toBe(0);
    });
});

describe('a distance as a LODGroup threshold', () => {
    // A 192 m chunk of a generated world with one group of rocks in a corner. Sized by the chunk's own diagonal (136 m)
    // it was culled 60 m away under a rule that said 1200.
    it('culls a chunk where its rule says, however little stands in it', () => {
        for (const radius of [5, 40, 136, 400]) {
            const cull = lodCullSizeWithin(radius, 1200);
            // Drawn while any of the sphere is within the distance: the centre is a radius further.
            expect(distanceAtSize(radius, cull)).toBeCloseTo(1200 + radius, 3);
        }
    });

    it('hands over to the far level at the distance named', () => {
        for (const radius of [5, 136]) {
            expect(distanceAtSize(radius, lodSizeAtDistance(radius, 300))).toBeCloseTo(300, 3);
        }
    });

    it('keeps the far level ahead of the cull, as a group needs its sizes to descend', () => {
        expect(lodSizeAtDistance(20, 300)).toBeGreaterThan(lodCullSizeWithin(20, 1200));
    });

    it('draws further through a narrower view, as a zoom should', () => {
        const cull = lodCullSizeWithin(20, 600);
        expect(distanceAtSize(20, cull, 30)).toBeGreaterThan(distanceAtSize(20, cull, 60));
    });
});
