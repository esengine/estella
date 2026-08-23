// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Ways between places the ground does not join.
 *
 * A mesh baked from what an agent can WALK says two floors are two places, and
 * that is the honest answer. A scene knows things the floor does not — that this
 * ledge can be dropped off, that this ladder is climbable — and a link is where
 * it says them. So the claims are about the ROUTE: that one appears, that it goes
 * through both ends rather than across them, and that a one-way drop is one way.
 */
import { describe, it, expect } from 'vitest';
import { buildNavMesh } from '../src/ai/nav/navmesh/build';
import { NavMesh, type NavLinkSegment } from '../src/ai/nav/NavMesh';
import { Navigation } from '../src/ai/nav/Navigation';
import { updateLinks, type LinkState } from '../src/ai/nav/NavPlugin';
import type { Vec3 } from '../src/types';

/** Two floors with a gap between them: the lower one, and one three metres up. */
function twoFloors(): { verts: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    const indices: number[] = [];
    const quad = (y: number, x0: number, x1: number) => {
        const base = verts.length / 3;
        verts.push(x0, y, -400, x1, y, -400, x1, y, 400, x0, y, 400);
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    quad(0, -600, -100);
    quad(300, 100, 600);
    return { verts: Float32Array.from(verts), indices: Uint32Array.from(indices) };
}

const BOX = {
    min: { x: -700, y: -100, z: -500 },
    max: { x: 700, y: 600, z: 500 },
    cellSize: 25,
    cellHeight: 10,
    agentHeight: 180,
    agentRadius: 30,
    stepHeight: 40,
};

const bake = (links: NavLinkSegment[] = []): NavMesh => {
    const g = twoFloors();
    return buildNavMesh(g.verts, g.indices, { ...BOX, links });
};

const LADDER: NavLinkSegment = {
    start: { x: -200, y: 0, z: 0 },
    end: { x: 200, y: 300, z: 0 },
    bidirectional: true,
    radius: 60,
};

const LOW: Vec3 = { x: -500, y: 0, z: 0 };
const HIGH: Vec3 = { x: 500, y: 300, z: 0 };

describe('a link between two floors', () => {
    it('is what makes the two of them one navigable world', () => {
        expect(bake().findWorldPath(LOW, HIGH)).toBeNull();
        expect(bake([LADDER]).findWorldPath(LOW, HIGH)).not.toBeNull();
    });

    // The route has to go THROUGH the link, not across the gap it spans: a funnel
    // pulled taut over a ladder would plan a walk through the air beside it.
    it('breaks the route at both of its ends', () => {
        const path = bake([LADDER]).findWorldPath(LOW, HIGH)!;
        const near = (p: Vec3, to: Vec3): boolean =>
            Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z) < 80;
        expect(path.some(p => near(p, LADDER.start))).toBe(true);
        expect(path.some(p => near(p, LADDER.end))).toBe(true);
        // And it climbs: the route leaves the floor it started on.
        expect(Math.max(...path.map(p => p.y))).toBeGreaterThan(250);
    });

    it('is one way when the scene says so', () => {
        const drop = bake([{ ...LADDER, bidirectional: false }]);
        expect(drop.findWorldPath(LOW, HIGH)).not.toBeNull();
        expect(drop.findWorldPath(HIGH, LOW)).toBeNull();
    });

    // A link is a claim about ground at both ends. One end over nothing joins
    // nothing, and a route that ended in the air would be worse than no route.
    it('joins nothing when an end reaches no ground', () => {
        const intoTheAir: NavLinkSegment = { ...LADDER, end: { x: 200, y: 1000, z: 0 } };
        expect(bake([intoTheAir]).linkCount).toBe(0);
        expect(bake([intoTheAir]).findWorldPath(LOW, HIGH)).toBeNull();
    });

    it('counts both directions of a two-way one, and one of a one-way', () => {
        expect(bake([LADDER]).linkCount).toBe(2);
        expect(bake([{ ...LADDER, bidirectional: false }]).linkCount).toBe(1);
    });

    it('hands itself to a drawer, since nothing else on screen says it is there', () => {
        const drawn: Array<[Vec3, Vec3]> = [];
        bake([LADDER]).describe({
            face: () => {}, border: () => {},
            link: (a, b) => drawn.push([{ ...a }, { ...b }]),
        });
        expect(drawn).toHaveLength(2);
    });
});

describe('updateLinks', () => {
    const state = (): LinkState => ({ digest: 0, mesh: null });

    it('joins a mesh the moment there is one to join', () => {
        const nav = new Navigation();
        const s = state();
        updateLinks(nav, [LADDER], s); // nothing installed yet
        nav.setSurface(bake());
        updateLinks(nav, [LADDER], s);
        expect((nav.surface as NavMesh).linkCount).toBe(2);
    });

    // Moving a link re-joins polygons that already exist. Charging a bake for that
    // is the reason nobody would ever move one.
    it('re-joins without rebuilding anything', () => {
        const nav = new Navigation();
        const mesh = bake();
        nav.setSurface(mesh);
        const s = state();
        updateLinks(nav, [LADDER], s);
        updateLinks(nav, [], s);
        expect(mesh.linkCount).toBe(0);
        expect(nav.surface).toBe(mesh); // the same mesh throughout
    });

    it('does nothing at all while the links have not changed', () => {
        const nav = new Navigation();
        nav.setSurface(bake([LADDER]));
        const s = state();
        updateLinks(nav, [LADDER], s);
        const before = (nav.surface as NavMesh).linkCount;
        updateLinks(nav, [LADDER], s);
        expect((nav.surface as NavMesh).linkCount).toBe(before);
    });
});
