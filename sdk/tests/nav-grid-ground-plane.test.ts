// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { Transform, type AnyComponentDef, type ComponentData } from '../src/ecs/component';
import type { Entity } from '../src/types';
import { NavAgent } from '../src/ai/nav/NavAgent';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { applyObstaclesToGrid } from '../src/ai/nav/navObstacles';
import { stepNavigation, type AgentRuntime, type NavWorldView } from '../src/ai/nav/NavPlugin';

class World implements NavWorldView {
    readonly entities: Entity[] = [];
    private data = new Map<string, unknown>();
    getEntitiesWithComponents(): readonly Entity[] { return this.entities; }
    has<C extends AnyComponentDef>(e: Entity, c: C): boolean { return this.data.has(`${e}:${c._name}`); }
    get<C extends AnyComponentDef>(e: Entity, c: C): ComponentData<C> { return structuredClone(this.data.get(`${e}:${c._name}`)) as ComponentData<C>; }
    set<C extends AnyComponentDef>(e: Entity, c: C, data: ComponentData<C>): void { this.data.set(`${e}:${c._name}`, data); }
}

const ground = () => new NavGrid({ width: 12, height: 8, cellSize: 10, origin: { x: 0, y: 3, z: 0 }, plane: 'xz' });

describe('a NavGrid laid on the ground', () => {
    it('maps its rows along world z and keeps its height', () => {
        const grid = ground();
        expect(grid.up).toEqual({ x: 0, y: 1, z: 0 });
        expect(grid.cellToWorld(4, 6)).toEqual({ x: 40, y: 3, z: 60 });
        expect(grid.worldToCell({ x: 41, y: 500, z: 58 })).toEqual({ x: 4, y: 6 });
    });

    it('stays in x/y when no plane is named', () => {
        const grid = new NavGrid({ width: 12, height: 8, cellSize: 10 });
        expect(grid.up).toEqual({ x: 0, y: 0, z: 1 });
        expect(grid.cellToWorld(4, 6)).toEqual({ x: 40, y: 60, z: 0 });
        expect(grid.worldToCell({ x: 41, y: 58, z: 500 })).toEqual({ x: 4, y: 6 });
    });

    it('routes round a wall along z, at its own height', () => {
        const grid = ground();
        for (let row = 0; row < 7; row++) grid.setWalkable(6, row, false);
        const result = grid.queryWorldPath({ x: 0, y: 3, z: 0 }, { x: 110, y: 3, z: 0 });
        expect(result.status).toBe('complete');
        expect(result.path!.every((p) => p.y === 3)).toBe(true);
        expect(Math.max(...result.path!.map((p) => p.z))).toBeGreaterThanOrEqual(70);
        expect(result.path!.every((p) => grid.isNavigable(p))).toBe(true);
    });

    it('answers a body near a wall by its distance along z', () => {
        const grid = ground();
        grid.setWalkable(3, 3, false);
        expect(grid.isNavigable({ x: 30, y: 3, z: 43 }, { radius: 2 })).toBe(true);
        expect(grid.isNavigable({ x: 30, y: 3, z: 36 }, { radius: 2 })).toBe(false);
        expect(grid.isNavigable({ x: 30, y: 36, z: 50 }, { radius: 2 })).toBe(true);
    });

    it('marks the cells an obstacle stands on by its x and z', () => {
        const grid = ground();
        applyObstaclesToGrid(grid, [{
            center: { x: 50, y: 3, z: 20 }, halfExtents: { x: 4, y: 20, z: 4 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
        }]);
        expect(grid.isWalkable(5, 2)).toBe(false);
        expect(grid.isWalkable(5, 0)).toBe(true);
        expect(grid.isWalkable(2, 5)).toBe(true);
    });

    it('walks an agent along x and z, and re-plans when a wall goes up in its way', () => {
        const world = new World(), nav = new Navigation(), runtimes = new Map<Entity, AgentRuntime>();
        const grid = ground();
        nav.setSurface(grid);
        const agent = 1 as Entity;
        world.entities.push(agent);
        world.set(agent, NavAgent, NavAgent.create({ hasTarget: true, targetX: 110, targetY: 3, targetZ: 0, speed: 100, arriveRadius: 1, repathInterval: 0 }));
        world.set(agent, Transform, { position: { x: 0, y: 3, z: 0 } } as ComponentData<typeof Transform>);
        const step = (frames: number): void => { for (let i = 0; i < frames; i++) stepNavigation(world, nav, 0.02, runtimes); };

        step(10);
        const early = world.get(agent, Transform).position;
        expect(early.x).toBeGreaterThan(5);
        expect(early.y).toBe(3);
        expect(early.z).toBe(0);

        for (let row = 0; row < 7; row++) grid.setWalkable(6, row, false);
        let furthestZ = 0;
        for (let i = 0; i < 400 && !world.get(agent, NavAgent).arrived; i++) {
            step(1);
            const at = world.get(agent, Transform).position;
            furthestZ = Math.max(furthestZ, at.z);
            expect(grid.isWalkable(Math.round(at.x / 10), Math.round(at.z / 10))).toBe(true);
            expect(at.y).toBe(3);
        }
        expect(world.get(agent, NavAgent).arrived).toBe(true);
        expect(furthestZ).toBeGreaterThanOrEqual(65);
    });
});
