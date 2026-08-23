// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Baking a navigation mesh out of triangles, and routing over it.
 */
import { describe, it, expect } from 'vitest';
import { buildNavMesh } from '../src/ai/nav/navmesh/build';
import type { Vec3 } from '../src/types';

/** A solid box as world-space triangles, appended to a growing soup. */
function addBox(
    soup: { verts: number[]; indices: number[] },
    center: Vec3, half: Vec3,
): void {
    const base = soup.verts.length / 3;
    for (const sy of [-1, 1]) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            soup.verts.push(center.x + sx * half.x, center.y + sy * half.y, center.z + sz * half.z);
        }
    }
    const faces = [
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3,
        3, 7, 4, 3, 4, 0,
    ];
    for (const i of faces) soup.indices.push(base + i);
}

function soup(): { verts: number[]; indices: number[] } {
    return { verts: [], indices: [] };
}

const BOX = {
    min: { x: -500, y: -100, z: -500 },
    max: { x: 500, y: 400, z: 500 },
    cellSize: 25,
    cellHeight: 10,
    agentHeight: 180,
    agentRadius: 30,
    stepHeight: 40,
};

function bake(s: { verts: number[]; indices: number[] }, over: Partial<typeof BOX> = {}) {
    return buildNavMesh(Float32Array.from(s.verts), Uint32Array.from(s.indices), { ...BOX, ...over });
}

describe('buildNavMesh', () => {
    it('covers a flat floor, at the height of its top face', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const mesh = bake(s);

        expect(mesh.polyCount).toBeGreaterThan(0);
        // Every vertex sits on top of the slab. A surface is rounded UP to the
        // voxel it falls in, so the mesh floats by up to one `cellHeight` — the
        // knob for how closely it hugs the floor, not an error to correct here.
        for (let i = 0; i < mesh.verts.length; i += 3) {
            expect(mesh.verts[i + 1]).toBeGreaterThanOrEqual(0);
            expect(mesh.verts[i + 1]).toBeLessThanOrEqual(BOX.cellHeight);
        }
        const at: Vec3 = { x: 0, y: 0, z: 0 };
        expect(mesh.findPoly({ x: 0, y: 0, z: 0 }, at)).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(BOX.cellHeight);
    });

    it('pulls the mesh back from the walls by the agent radius', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const wide = bake(s, { agentRadius: 100 });
        let maxX = -Infinity;
        for (let i = 0; i < wide.verts.length; i += 3) maxX = Math.max(maxX, wide.verts[i]!);
        // The floor ends at x = 400; a body 100 wide may not stand closer than that.
        expect(maxX).toBeLessThanOrEqual(400 - 100 + BOX.cellSize);
        expect(maxX).toBeGreaterThan(200);
    });

    it('routes round a wall rather than through it', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        // A wall from z = -400 to z = 200, leaving a gap at the far end.
        addBox(s, { x: 0, y: 80, z: -100 }, { x: 20, y: 100, z: 300 });
        const mesh = bake(s);

        const path = mesh.findWorldPath({ x: -300, y: 0, z: -300 }, { x: 300, y: 0, z: -300 });
        expect(path).not.toBeNull();
        const maxZ = Math.max(...path!.map(p => p.z));
        expect(maxZ).toBeGreaterThan(200);
    });

    it('keeps a bridge and the ground under it apart', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        // A deck three metres up, spanning x, with nothing holding it up in the
        // middle — so the ground below it keeps its headroom.
        addBox(s, { x: 0, y: 300, z: 0 }, { x: 400, y: 20, z: 200 });
        const mesh = bake(s);

        const below: Vec3 = { x: 0, y: 0, z: 0 };
        const above: Vec3 = { x: 0, y: 0, z: 0 };
        const groundPoly = mesh.findPoly({ x: 0, y: 0, z: 0 }, below);
        const deckPoly = mesh.findPoly({ x: 0, y: 320, z: 0 }, above);
        expect(groundPoly).toBeGreaterThanOrEqual(0);
        expect(deckPoly).toBeGreaterThanOrEqual(0);
        expect(deckPoly).not.toBe(groundPoly);
        expect(below.y).toBeLessThanOrEqual(BOX.cellHeight);
        expect(above.y).toBeGreaterThan(310);
    });

    it('will not stand an agent on ground steeper than it can climb', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const flat = bake(s).polyCount;
        expect(flat).toBeGreaterThan(0);
        // The same floor, an agent that can stand on nothing at all.
        expect(bake(s, { maxSlopeDegrees: 0 } as never).polyCount).toBe(0);
    });

    it('leaves out ground with no headroom over it', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        // A ceiling 100 up over half the floor — under an agent 180 tall.
        addBox(s, { x: 200, y: 120, z: 0 }, { x: 200, y: 20, z: 400 });
        const mesh = bake(s);
        const open: Vec3 = { x: 0, y: 0, z: 0 };
        const under: Vec3 = { x: 0, y: 0, z: 0 };
        expect(mesh.findPoly({ x: -200, y: 0, z: 0 }, open)).toBeGreaterThanOrEqual(0);
        expect(open.y).toBeLessThanOrEqual(BOX.cellHeight);
        // Under the ceiling there is no floor at all: the only walkable ground
        // over that half of the world is the TOP of the slab, which is why the
        // answer has to be read as a height rather than as a yes or no.
        mesh.findPoly({ x: 200, y: 0, z: 0 }, under);
        expect(under.y).toBeGreaterThan(100);
    });

    // What a mesh buys over a grid: the route is the straight line, not the
    // staircase a grid of cells would have to walk to draw one.
    it('crosses an open floor in a single straight line', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const mesh = bake(s);

        const from = { x: -300, y: 0, z: -300 };
        const to = { x: 300, y: 0, z: 300 };
        const path = mesh.findWorldPath(from, to)!;
        expect(path).not.toBeNull();
        expect(path).toHaveLength(2);
        expect(pathLength(path)).toBeCloseTo(Math.hypot(600, 600), 0);
    });

    // The corner is not a point — erosion by the agent's own width rounds it off —
    // so the taut path wraps it in a couple of steps, where a route over cells of
    // this size would turn a couple of dozen times over the same ground.
    it('turns only at the corner it has to go round', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        // A wall along -x half of the floor, splitting it into an L.
        addBox(s, { x: -100, y: 80, z: 0 }, { x: 300, y: 100, z: 20 });
        const mesh = bake(s);

        const path = mesh.findWorldPath({ x: -300, y: 0, z: -200 }, { x: -300, y: 0, z: 200 })!;
        expect(path).not.toBeNull();
        expect(path.length).toBeGreaterThan(2);
        expect(path.length).toBeLessThanOrEqual(6);
        // Every turn is round the open end of the wall, not back down it.
        for (const p of path.slice(1, -1)) expect(p.x).toBeGreaterThan(150);
    });

    it('walks up a step it can climb and round one it cannot', () => {
        const stepped = (height: number) => {
            const s = soup();
            addBox(s, { x: -250, y: -20, z: 0 }, { x: 250, y: 20, z: 400 });
            addBox(s, { x: 250, y: height / 2 - 20, z: 0 }, { x: 250, y: height / 2 + 20, z: 400 });
            return s;
        };
        const low = bake(stepped(30));
        expect(reaches(low.findWorldPath({ x: -300, y: 0, z: 0 }, { x: 300, y: 30, z: 0 }),
            { x: 300, y: 30, z: 0 })).toBe(true);

        const high = bake(stepped(200));
        expect(reaches(high.findWorldPath({ x: -300, y: 0, z: 0 }, { x: 300, y: 200, z: 0 }),
            { x: 300, y: 200, z: 0 })).toBe(false);
    });

    // Two floors with the SAME outline, one over the other: their corners land on
    // one spot in the ground plane, so anything identifying a vertex by where it
    // is from above welds the upper storey onto the lower one.
    it('keeps two floors of the same shape at their own heights', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        addBox(s, { x: 0, y: 280, z: 0 }, { x: 400, y: 20, z: 400 });
        const mesh = bake(s);

        const lower: Vec3 = { x: 0, y: 0, z: 0 };
        const upper: Vec3 = { x: 0, y: 0, z: 0 };
        expect(mesh.findPoly({ x: 0, y: 0, z: 0 }, lower)).toBeGreaterThanOrEqual(0);
        expect(mesh.findPoly({ x: 0, y: 300, z: 0 }, upper)).toBeGreaterThanOrEqual(0);
        expect(lower.y).toBeLessThanOrEqual(BOX.cellHeight);
        expect(upper.y).toBeGreaterThan(290);
    });

    // Two levels with no way between them: the mesh has both, and the route to the
    // deck gets no further than the ground under it.
    it('gets no further than the ground when nothing reaches the deck', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        addBox(s, { x: 0, y: 300, z: 0 }, { x: 400, y: 20, z: 200 });
        const mesh = bake(s);
        const goal = { x: 0, y: 320, z: 0 };
        const path = mesh.findWorldPath({ x: 0, y: 0, z: -350 }, goal)!;
        expect(reaches(path, goal)).toBe(false);
        expect(path[path.length - 1]!.y).toBeLessThan(50);
    });

    // A volume covering a city at a centimetre a cell is not a slow bake, it is
    // one that never finishes — and an editor that stops with no reason given is
    // worse than a scene with no mesh in it.
    it('refuses a volume too big to voxelise rather than trying', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const huge = bake(s, {
            min: { x: -1e5, y: -100, z: -1e5 }, max: { x: 1e5, y: 400, z: 1e5 },
        });
        expect(huge.polyCount).toBe(0);
    });

    // A goal that is not on the mesh at all is still a direction to walk in, and
    // the walk still has to be a walk: round the wall, not through it.
    it('walks round the wall toward a goal off the mesh entirely', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 500, y: 20, z: 500 });
        // A wall across all but the east end of the floor.
        addBox(s, { x: -150, y: 80, z: 0 }, { x: 350, y: 100, z: 20 });
        const mesh = bake(s);

        const goal = { x: -300, y: 0, z: 900 }; // beyond the floor, past the wall
        const path = mesh.findWorldPath({ x: -300, y: 0, z: -300 }, goal)!;
        expect(path).not.toBeNull();
        expect(Math.hypot(path[path.length - 1]!.x - goal.x,
            path[path.length - 1]!.z - goal.z)).toBeGreaterThan(200);
        // Every step of it is somewhere an agent may stand — a route that gave up
        // and pointed at the nearest place would cut straight through the wall.
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]!;
            const b = path[i]!;
            const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 20));
            for (let t = 0; t <= steps; t++) {
                const at = {
                    x: a.x + (b.x - a.x) * (t / steps),
                    y: a.y + (b.y - a.y) * (t / steps),
                    z: a.z + (b.z - a.z) * (t / steps),
                };
                expect(mesh.findPoly(at)).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('hands its shape to a drawer as faces and the edges they stop at', () => {
        const s = soup();
        addBox(s, { x: 0, y: -20, z: 0 }, { x: 400, y: 20, z: 400 });
        const mesh = bake(s);
        let faces = 0;
        let borders = 0;
        mesh.describe({
            face: (corners) => { expect(corners.length).toBeGreaterThanOrEqual(3); faces++; },
            border: () => { borders++; },
            link: () => {},
        });
        expect(faces).toBe(mesh.polyCount);
        // A single floor is one island: every edge of its outline is a border.
        expect(borders).toBeGreaterThanOrEqual(4);
    });
});

function pathLength(path: Vec3[]): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += Math.hypot(path[i]!.x - path[i - 1]!.x,
            path[i]!.y - path[i - 1]!.y, path[i]!.z - path[i - 1]!.z);
    }
    return total;
}

/** Whether a route actually got where it was sent — a route that could not is
 *  answered with the way to the nearest place it could, not with nothing. */
function reaches(path: Vec3[] | null, to: Vec3, slack = 120): boolean {
    if (!path || path.length === 0) return false;
    const end = path[path.length - 1]!;
    return Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) < slack;
}
