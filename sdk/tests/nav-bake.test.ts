// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Baking a walkable grid out of what the 3D solver can see.
 *
 * The claims are about what makes a cell UNwalkable — a hole, a wall, a ceiling
 * too low — and about the height it reports for the ones that survive, because
 * that height is what the agent then walks along.
 */
import { describe, it, expect, vi } from 'vitest';
import { bakeNavGrid, type GroundHit, type GroundProbe } from '../src/ai/nav/bakeNavGrid';
import { bakeVolumes } from '../src/ai/nav/NavPlugin';
import { NavVolume, type NavVolumeData } from '../src/ai/nav/NavVolume';
import { Navigation } from '../src/ai/nav/Navigation';
import { Transform } from '../src/ecs/component';
import type { Physics3DQueries } from '../src/physics3d/Physics3DQueries';
import type { Vec3 } from '../src/types';

// The engine's own solver satisfies the probe as it stands — the reason the
// interface is this small. A type-level check, so it costs nothing at runtime
// and fails at compile time if the two ever drift apart.
type SolverIsAProbe = Physics3DQueries extends GroundProbe ? true : false;
const _solverIsAProbe: SolverIsAProbe = true;
void _solverIsAProbe;

/** A solver that answers by the world position of the ray, not by its own state. */
function probeOf(
    ground: (x: number, z: number) => GroundHit | null,
    ceiling: (x: number, z: number) => boolean = () => false,
): GroundProbe {
    return {
        raycast(origin: Vec3, direction: Vec3): GroundHit | null {
            // Down is the ground query; up is the headroom one.
            if (direction.y < 0) return ground(origin.x, origin.z);
            return ceiling(origin.x, origin.z) ? { y: origin.y + 1, normalY: -1 } : null;
        },
    };
}

const LEVEL = (y: number): GroundHit => ({ y, normalY: 1 });
const BOX = { min: { x: 0, y: -100, z: 0 }, max: { x: 20, y: 100, z: 20 }, cellSize: 10 };

describe('bakeNavGrid', () => {
    it('covers the box in cells and lies in the ground plane', () => {
        const grid = bakeNavGrid(probeOf(() => LEVEL(0)), BOX);
        expect(grid.width).toBe(3); // 0, 10, 20
        expect(grid.height).toBe(3);
        expect(grid.plane).toBe('xz');
        expect(grid.isWalkable(1, 1)).toBe(true);
        // Cell (2,1) is at x=20, z=10 — the grid's own two axes are x and z.
        expect(grid.cellToWorld(2, 1)).toEqual({ x: 20, y: 0, z: 10 });
    });

    it('reports the height of the ground it found, per cell', () => {
        const grid = bakeNavGrid(probeOf((x) => LEVEL(x === 10 ? 35 : 0)), BOX);
        expect(grid.surfaceAt(0, 0)).toBe(0);
        expect(grid.surfaceAt(1, 0)).toBe(35);
        expect(grid.cellToWorld(1, 0).y).toBe(35);
    });

    // Three ways a cell fails, and each has to fail on its OWN account: a hole is
    // not a wall and neither is a low ceiling.
    it('a cell with no ground under it is a hole', () => {
        const grid = bakeNavGrid(probeOf((x) => (x === 10 ? null : LEVEL(0))), BOX);
        expect(grid.isWalkable(1, 0)).toBe(false);
        expect(grid.isWalkable(0, 0)).toBe(true);
    });

    it('ground steeper than the agent can stand on is a wall', () => {
        // ~60° from level: normalY = cos(60°) = 0.5.
        const steep = { y: 0, normalY: 0.5 };
        const grid = bakeNavGrid(probeOf((x) => (x === 10 ? steep : LEVEL(0))),
            { ...BOX, maxSlopeDegrees: 45 });
        expect(grid.isWalkable(1, 0)).toBe(false);
        // The same ground, an agent that can stand on it.
        const lenient = bakeNavGrid(probeOf((x) => (x === 10 ? steep : LEVEL(0))),
            { ...BOX, maxSlopeDegrees: 70 });
        expect(lenient.isWalkable(1, 0)).toBe(true);
    });

    it('a ceiling lower than the agent is a crawlspace, not a corridor', () => {
        const grid = bakeNavGrid(probeOf(() => LEVEL(0), (x) => x === 10),
            { ...BOX, agentHeight: 180 });
        expect(grid.isWalkable(1, 0)).toBe(false);
        expect(grid.isWalkable(0, 0)).toBe(true);
    });

    it('skips the headroom ray entirely when no agent height was given', () => {
        const raycast = vi.fn((_o: Vec3, d: Vec3) => (d.y < 0 ? LEVEL(0) : null));
        bakeNavGrid({ raycast }, BOX);
        expect(raycast).toHaveBeenCalledTimes(9); // one per cell, none upward
    });

    // A cell that failed still reports the height it found, so a route planned
    // past it (and an agent snapped onto it) is at the height of the floor there.
    it('keeps the height of a cell it refused to make walkable', () => {
        const grid = bakeNavGrid(probeOf((x) => (x === 10 ? { y: 42, normalY: 0.1 } : LEVEL(0))), BOX);
        expect(grid.isWalkable(1, 0)).toBe(false);
        expect(grid.surfaceAt(1, 0)).toBe(42);
    });

    it('carries the step limit onto the grid it builds', () => {
        const grid = bakeNavGrid(probeOf((x) => LEVEL(x === 10 ? 90 : 0)),
            { ...BOX, stepHeight: 30 });
        expect(grid.stepHeight).toBe(30);
        expect(grid.canStep(0, 0, 1, 0)).toBe(false);
    });

    it('casts the ground ray through the whole box, from its top', () => {
        const raycast = vi.fn(() => null);
        bakeNavGrid({ raycast }, BOX);
        expect(raycast).toHaveBeenCalledWith({ x: 0, y: 100, z: 0 }, { x: 0, y: -200, z: 0 }, 0);
    });

    it('casts against the layers it was given', () => {
        const raycast = vi.fn(() => null);
        bakeNavGrid({ raycast }, { ...BOX, layers: 0b101 });
        expect(raycast).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0b101);
    });
});

/** The narrow world view `bakeVolumes` walks, with just enough store to answer. */
class VolumeWorld {
    private store = new Map<string, unknown>();
    private ids: number[] = [];
    spawn(comps: Array<[{ _name: string }, unknown]>): number {
        const e = this.ids.length + 1;
        for (const [def, data] of comps) this.store.set(`${e}:${def._name}`, data);
        this.ids.push(e);
        return e;
    }
    getEntitiesWithComponents(defs: readonly { _name: string }[]): number[] {
        return this.ids.filter(e => defs.every(d => this.store.has(`${e}:${d._name}`)));
    }
    get(e: number, def: { _name: string }): never {
        return this.store.get(`${e}:${def._name}`) as never;
    }
    set(): void { /* the bake writes nothing back */ }
}

describe('bakeVolumes', () => {
    const spawnVolume = (w: VolumeWorld, over: Partial<NavVolumeData> = {}) => w.spawn([
        [NavVolume, NavVolume.create({ halfExtents: { x: 20, y: 100, z: 20 }, cellSize: 10, ...over })],
        [Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }],
    ]);

    it('bakes an authored volume into the active grid, centred on its Transform', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const nav = new Navigation();
        bakeVolumes(w as never, nav, probeOf(() => LEVEL(7)), new Set());
        expect(nav.grid).not.toBeNull();
        expect(nav.grid!.plane).toBe('xz');
        expect(nav.grid!.width).toBe(5); // 40 across at 10 a cell, inclusive
        expect(nav.grid!.surfaceAt(0, 0)).toBe(7);
    });

    // Bodies are created by the physics system on its first step; a bake that ran
    // before it would sample an empty world and produce a grid of holes.
    it('does nothing at all without a solver to ask', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const nav = new Navigation();
        bakeVolumes(w as never, nav, null, new Set());
        expect(nav.grid).toBeNull();
    });

    it('bakes each volume once, however many frames run', () => {
        const w = new VolumeWorld();
        spawnVolume(w);
        const raycast = vi.fn((_o: Vec3, d: Vec3) => (d.y < 0 ? LEVEL(0) : null));
        const baked = new Set<number>();
        const nav = new Navigation();
        bakeVolumes(w as never, nav, { raycast }, baked as never);
        const afterFirst = raycast.mock.calls.length;
        bakeVolumes(w as never, nav, { raycast }, baked as never);
        expect(raycast.mock.calls.length).toBe(afterFirst);
    });

    it('carries the volume own settings into the grid', () => {
        const w = new VolumeWorld();
        spawnVolume(w, { stepHeight: 25 });
        const nav = new Navigation();
        bakeVolumes(w as never, nav, probeOf(() => LEVEL(0)), new Set());
        expect(nav.grid!.stepHeight).toBe(25);
    });
});
