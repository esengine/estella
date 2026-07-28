// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { Entity } from '../src/types';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { NavAgent } from '../src/ai/nav/NavAgent';
import {
    stepNavigation,
    type AgentRuntime,
    type NavWorldView,
} from '../src/ai/nav/NavPlugin';
import { navGridFromTiles } from '../src/ai/nav/navGridFromTilemap';

/** Minimal in-memory world satisfying what stepNavigation calls. */
class FakeWorld implements NavWorldView {
    private store = new Map<string, unknown>();
    private next = 1;
    readonly entities: Entity[] = [];

    spawnAgent(x: number, y: number, agent: Partial<import('../src/ai/nav/NavAgent').NavAgentData>): Entity {
        const e = this.next++ as Entity;
        this.store.set(`${e}:NavAgent`, NavAgent.create(agent));
        // Only position is read/written; a partial Transform is enough here.
        this.store.set(`${e}:Transform`, { position: { x, y, z: 0 } });
        this.entities.push(e);
        return e;
    }

    getEntitiesWithComponents(): Entity[] {
        return this.entities;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(entity: Entity, component: { _name: string }): any {
        return this.store.get(`${entity}:${component._name}`);
    }
    set(entity: Entity, component: { _name: string }, data: unknown): void {
        this.store.set(`${entity}:${component._name}`, data);
    }

    pos(entity: Entity): { x: number; y: number } {
        const tf = this.store.get(`${entity}:Transform`) as { position: { x: number; y: number } };
        return { x: tf.position.x, y: tf.position.y };
    }
    agent(entity: Entity): import('../src/ai/nav/NavAgent').NavAgentData {
        return this.store.get(`${entity}:NavAgent`) as import('../src/ai/nav/NavAgent').NavAgentData;
    }
}

function openNav(width = 10, height = 3, cellSize = 10): Navigation {
    const nav = new Navigation();
    nav.setGrid(new NavGrid({ width, height, cellSize }));
    return nav;
}

describe('stepNavigation', () => {
    it('walks an agent to its target on an open grid and marks arrival', () => {
        const nav = openNav();
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 100, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        let frames = 0;
        while (!world.agent(e).arrived && frames < 100) {
            stepNavigation(world, nav, 0.1, runtimes);
            frames++;
        }

        expect(world.agent(e).arrived).toBe(true);
        expect(world.agent(e).hasTarget).toBe(false);
        const p = world.pos(e);
        expect(p.x).toBeCloseTo(90, 1);
        expect(p.y).toBeCloseTo(0, 1);
        // 90px at 100px/s ≈ 9 frames; guard against a runaway loop.
        expect(frames).toBeLessThan(20);
    });

    it('routes an agent around a wall with one gap', () => {
        // Column x=5 blocked on rows 0..1, open on row 2 → detour through the gap.
        const nav = new Navigation();
        const grid = new NavGrid({ width: 10, height: 3, cellSize: 10 });
        grid.setWalkable(5, 0, false);
        grid.setWalkable(5, 1, false);
        nav.setGrid(grid);
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 150, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        let frames = 0;
        while (!world.agent(e).arrived && frames < 200) {
            stepNavigation(world, nav, 0.05, runtimes);
            frames++;
        }
        expect(world.agent(e).arrived).toBe(true);
        expect(world.pos(e).x).toBeCloseTo(90, 1);
    });

    it('does not move an agent toward an unreachable target', () => {
        // Full wall column with no gap.
        const nav = new Navigation();
        const grid = new NavGrid({ width: 10, height: 3, cellSize: 10 });
        for (let y = 0; y < 3; y++) grid.setWalkable(5, y, false);
        nav.setGrid(grid);
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 100, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        stepNavigation(world, nav, 0.1, runtimes);
        expect(world.pos(e)).toEqual({ x: 0, y: 0 });
        expect(world.agent(e).arrived).toBe(false);
        expect(runtimes.get(e)?.reachable).toBe(false);
    });

    it('replans when the target moves', () => {
        const nav = openNav();
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 100, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        stepNavigation(world, nav, 0.05, runtimes);
        expect(runtimes.get(e)!.plannedX).toBe(90);

        // Retarget mid-flight.
        const a = world.agent(e);
        a.targetX = 0;
        a.targetY = 20;
        world.set(e, NavAgent, a);
        stepNavigation(world, nav, 0.05, runtimes);
        expect(runtimes.get(e)!.plannedX).toBe(0);
        expect(runtimes.get(e)!.plannedY).toBe(20);
    });

    it('is a no-op for agents without a target', () => {
        const nav = openNav();
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(30, 0, { speed: 100, hasTarget: false });
        stepNavigation(world, nav, 0.1, runtimes);
        expect(world.pos(e)).toEqual({ x: 30, y: 0 });
    });
});

describe('navGridFromTiles', () => {
    const rows = [
        [0, 0, 3],
        [0, 5, 0],
    ];
    const getTile = (x: number, y: number) => rows[y][x];

    it('treats any non-empty tile as blocked by default', () => {
        const grid = navGridFromTiles(getTile, { width: 3, height: 2, cellSize: 16 });
        expect(grid.isWalkable(0, 0)).toBe(true);
        expect(grid.isWalkable(2, 0)).toBe(false); // tile 3
        expect(grid.isWalkable(1, 1)).toBe(false); // tile 5
    });

    it('blocks only the listed tile ids', () => {
        const grid = navGridFromTiles(getTile, { width: 3, height: 2, cellSize: 16, blockedTileIds: [5] });
        expect(grid.isWalkable(2, 0)).toBe(true); // tile 3 no longer blocks
        expect(grid.isWalkable(1, 1)).toBe(false); // tile 5 blocks
    });

    it('honors a custom predicate', () => {
        const grid = navGridFromTiles(getTile, {
            width: 3, height: 2, cellSize: 16,
            isBlocked: id => id === 3,
        });
        expect(grid.isWalkable(2, 0)).toBe(false);
        expect(grid.isWalkable(1, 1)).toBe(true);
    });

    it('ignores flip bits above the tile-id mask', () => {
        // 3 with a flip flag set in the high bits still reads as tile id 3.
        const grid = navGridFromTiles(() => 3 | 0x8000, { width: 1, height: 1, cellSize: 16 });
        expect(grid.isWalkable(0, 0)).toBe(false);
    });
});
