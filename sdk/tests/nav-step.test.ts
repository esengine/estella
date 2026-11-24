// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { navGridFromTiles, navGridFromTilemapLayer } from '../src/tilemap/navGridFromTilemap';
import { initTilemapAPI, shutdownTilemapAPI } from '../src/tilemap/tilemapAPI';

// The tilemap loaders come with the subsystem now, not with the asset
// registry: a package without tilemaps does not carry a tilemap parser.
import { registerTilemapSupport } from '../src/tilemap/tilemapSupport';
registerTilemapSupport();

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

    /** Give an agent a body, so the follower steers it instead of moving it. */
    giveCharacter(entity: Entity, over: Record<string, unknown> = {}): void {
        this.store.set(`${entity}:CharacterController3D`, {
            velocity: { x: 0, y: 0, z: 0 }, enabled: true, ...over,
        });
    }
    character(entity: Entity): { velocity: { x: number; y: number; z: number }; enabled: boolean } {
        return this.store.get(`${entity}:CharacterController3D`) as never;
    }

    getEntitiesWithComponents(): Entity[] {
        return this.entities;
    }
    has(entity: Entity, component: { _name: string }): boolean {
        return this.store.has(`${entity}:${component._name}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(entity: Entity, component: { _name: string }): any {
        return this.store.get(`${entity}:${component._name}`);
    }
    set(entity: Entity, component: { _name: string }, data: unknown): void {
        this.store.set(`${entity}:${component._name}`, data);
    }

    place(entity: Entity, x: number, y: number): void {
        this.store.set(`${entity}:Transform`, { position: { x, y, z: 0 } });
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
    nav.setSurface(new NavGrid({ width, height, cellSize }));
    return nav;
}

describe('stepNavigation', () => {
    it.each(['cancel','commit'])('holds destinations during a surface update and resumes after %s', finish => {
        const world=new FakeWorld(),nav=openNav(40,9,10),runtimes=new Map<Entity,AgentRuntime>();
        const e=world.spawnAgent(20,40,{speed:60,radius:3,arriveRadius:2,repathInterval:0,
            hasTarget:true,targetX:300,targetY:40});
        stepNavigation(world,nav,1/60,runtimes);
        const before=world.pos(e),update=nav.beginSurfaceUpdate();
        for(let i=0;i<120;i++)stepNavigation(world,nav,1/60,runtimes);
        expect(world.pos(e)).toEqual(before);expect(world.agent(e)).toMatchObject({hasTarget:true,arrived:false});
        expect(nav.planningStats).toEqual({completed:0,pending:1,elapsedMs:0});
        if(finish==='commit')update.commit(new NavGrid({width:40,height:9,cellSize:10}));else update.cancel();
        for(let i=0;i<360;i++)stepNavigation(world,nav,1/60,runtimes);
        expect(world.agent(e).arrived).toBe(true);
    });

    it('clears pending-update character steering while preserving gravity and inactive bodies',()=>{
        const world=new FakeWorld(),nav=openNav(),runtimes=new Map<Entity,AgentRuntime>();
        const e=world.spawnAgent(20,0,{hasTarget:true,targetX:70});
        world.giveCharacter(e,{velocity:{x:100,y:-320,z:50}});
        const idle=world.spawnAgent(30,0,{hasTarget:false});
        world.giveCharacter(idle,{velocity:{x:20,y:-30,z:40}});
        nav.beginSurfaceUpdate();stepNavigation(world,nav,1/60,runtimes);
        expect(world.character(e).velocity).toEqual({x:0,y:-320,z:0});
        expect(world.character(idle).velocity).toEqual({x:20,y:-30,z:40});
    });

    it.each([0, .5, 3, 5])('crowd followers honor a final arrival radius of %s', arriveRadius => {
        const world = new FakeWorld();
        const e = world.spawnAgent(20, 150, {speed:78, radius:8, arriveRadius,
            repathInterval:0, hasTarget:true, targetX:270, targetY:150});
        world.spawnAgent(245, 190, {speed:0, radius:8});
        const nav = openNav(32, 32, 10), runtimes = new Map<Entity, AgentRuntime>();
        for (let frame=0;frame<600 && !world.agent(e).arrived;frame++) {
            stepNavigation(world, nav, 1/60, runtimes);
        }
        expect(world.agent(e).arrived).toBe(true);
        const p=world.pos(e);
        expect(Math.hypot(p.x-270,p.y-150)).toBeLessThanOrEqual(arriveRadius+1e-6);
    });
    it('zero-radius arrival tolerates only native coordinate rounding', () => {
        const world=new FakeWorld(), nav=openNav(32,32,10);
        const target={x:270.123456,y:150.123456,z:0};
        const e=world.spawnAgent(20,150,{speed:78,radius:8,arriveRadius:0,repathInterval:0,
            hasTarget:true,targetX:target.x,targetY:target.y});
        world.spawnAgent(245,190,{speed:0,radius:8});
        vi.spyOn(nav,'queryWorldPath').mockReturnValue({path:[{x:20,y:150,z:0},target],status:'complete',reason:'none'});
        const set=world.set.bind(world);
        world.set=(entity,component,data)=>{
            if(component===Transform){const tf=data as {position:{x:number;y:number;z:number}};
                tf.position.x=Math.fround(tf.position.x);tf.position.y=Math.fround(tf.position.y);}
            set(entity,component,data);
        };
        const runtimes=new Map<Entity,AgentRuntime>();
        for(let frame=0;frame<600&&!world.agent(e).arrived;frame++)stepNavigation(world,nav,1/60,runtimes);
        expect(world.agent(e).arrived).toBe(true);
        expect(world.pos(e)).toEqual({x:Math.fround(target.x),y:Math.fround(target.y)});
    });

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
        nav.setSurface(grid);
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 150, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        let frames = 0;
        while (!world.agent(e).arrived && frames < 200) {
            stepNavigation(world, nav, 0.05, runtimes);
            frames++;
        }
        expect(world.agent(e).arrived).toBe(true);
        // Within the agent's arrive radius of the goal, not standing on it.
        const at = world.pos(e);
        expect(Math.hypot(at.x - 90, at.y - 0)).toBeLessThanOrEqual(6);
    });

    it('stops at arriveRadius, so an agent can be told to keep its distance', () => {
        // The field is the whole point: an agent chasing something must be able
        // to stop short of it rather than walk onto it.
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 20, height: 3, cellSize: 10 }));
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, {
            speed: 150, repathInterval: 0, hasTarget: true, targetX: 150, targetY: 0, arriveRadius: 40,
        });

        let frames = 0;
        while (!world.agent(e).arrived && frames < 200) {
            stepNavigation(world, nav, 0.05, runtimes);
            frames++;
        }
        expect(world.agent(e).arrived).toBe(true);
        const stopped = world.pos(e);
        expect(150 - stopped.x).toBeLessThanOrEqual(40);
        expect(150 - stopped.x).toBeGreaterThan(20);
    });

    // An agent sent somewhere it cannot get to walks to the door rather than
    // standing where it was told, and stops on the near side of the wall.
    it('walks an agent as close to an unreachable target as it can get', () => {
        // Full wall column with no gap.
        const nav = new Navigation();
        const grid = new NavGrid({ width: 10, height: 3, cellSize: 10 });
        for (let y = 0; y < 3; y++) grid.setWalkable(5, y, false);
        nav.setSurface(grid);
        const world = new FakeWorld();
        const runtimes = new Map<Entity, AgentRuntime>();
        const e = world.spawnAgent(0, 0, { speed: 100, repathInterval: 0, hasTarget: true, targetX: 90, targetY: 0 });

        for (let i = 0; i < 20; i++) stepNavigation(world, nav, 0.1, runtimes);
        expect(world.pos(e).x).toBeGreaterThan(30);
        expect(world.pos(e).x).toBeLessThan(50); // the wall stands at x = 50
        expect(world.agent(e)).toMatchObject({ arrived: false, hasTarget: true });
        const writes=vi.spyOn(world,'set');
        stepNavigation(world,nav,0.1,runtimes);
        expect(writes).not.toHaveBeenCalled();
        grid.setWalkable(5, 0, true);
        for (let i = 0; i < 20; i++) stepNavigation(world, nav, 0.1, runtimes);
        expect(world.pos(e).x).toBeGreaterThan(80);
        expect(world.agent(e)).toMatchObject({ arrived: true, hasTarget: false });
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

describe('navGridFromTilemapLayer', () => {
    // A tilemap's row 0 is the map's top and a NavGrid's cell 0 its bottom, so
    // only a map blocked along ONE edge says which way up the conversion is: a
    // mirrored grid passes anything that reads the same upside down.
    const map = [
        [9, 9, 9], // tilemap row 0 — the map's TOP
        [0, 0, 0],
        [0, 0, 0],
    ];

    beforeEach(() => {
        initTilemapAPI({
            tilemap_getTile: (_e: number, x: number, y: number) => map[y][x],
        } as never);
    });
    afterEach(() => shutdownTilemapAPI());

    it('reads the tilemap top-down into a bottom-up grid', () => {
        const grid = navGridFromTilemapLayer(7, { width: 3, height: 3, cellSize: 16 });
        // The blocked tilemap row is the map's top, so it must land on the grid's
        // TOP cell row — the highest gy, not gy 0.
        expect(grid.isWalkable(1, 2)).toBe(false);
        expect(grid.isWalkable(1, 0)).toBe(true);
    });

    it('puts an obstacle where cellToWorld says it is', () => {
        const cellSize = 16;
        // origin = world centre of the BOTTOM-left cell, per the NavGrid contract.
        const grid = navGridFromTilemapLayer(7, {
            width: 3, height: 3, cellSize, origin: { x: -16, y: -16 },
        });
        const blocked = grid.cellToWorld(1, 2);
        // The tilemap draws its row 0 at the top: origin.y + (height-1)*cellSize.
        expect(blocked.y).toBe(-16 + 2 * cellSize);
        expect(grid.isWalkable(1, 2)).toBe(false);
    });
});

// A character has a solver of its own — it collides, steps up and falls. A
// follower that wrote the Transform would undo all three every frame, so what
// it writes instead is where the body should be TRYING to go.
describe('an agent with a body', () => {
    const walker = (): { world: FakeWorld; nav: Navigation; entity: Entity } => {
        const world = new FakeWorld();
        const entity = world.spawnAgent(0, 0, { speed: 100, arriveRadius: 0, hasTarget: true, targetX: 80, targetY: 0 });
        world.giveCharacter(entity);
        return { world, nav: openNav(), entity };
    };

    it('is steered rather than moved', () => {
        const { world, nav, entity } = walker();
        stepNavigation(world, nav, 1 / 60, new Map());
        expect(world.pos(entity)).toEqual({ x: 0, y: 0 });
        expect(world.character(entity).velocity.x).toBeCloseTo(100, 3);
    });

    // The world carries the vertical axis: a zero written there is "walk", and
    // a follower that wrote one would hold the body up in the air.
    it('never writes the axis the world carries', () => {
        const { world, nav, entity } = walker();
        world.character(entity).velocity.y = -320;
        stepNavigation(world, nav, 1 / 60, new Map());
        expect(world.character(entity).velocity.y).toBe(-320);
    });

    it.each([0, 2])('keeps steering a character outside its final radius of %s', arriveRadius => {
        const {world, nav, entity} = walker();
        const agent=world.agent(entity); agent.arriveRadius=arriveRadius;
        world.place(entity,73,0);
        stepNavigation(world,nav,1/60,new Map());
        expect(world.agent(entity).arrived).toBe(false);
        expect(world.character(entity).velocity.x).toBeGreaterThan(0);
    });

    it('stops the body when it arrives', () => {
        const { world, nav, entity } = walker();
        const runtimes = new Map<Entity, AgentRuntime>();
        stepNavigation(world, nav, 1 / 60, runtimes);
        // Put it on the goal; a body is not snapped there, it walks there.
        world.place(entity, 80, 0);
        stepNavigation(world, nav, 1 / 60, runtimes);
        expect(world.agent(entity).arrived).toBe(true);
        expect(world.character(entity).velocity.x).toBe(0);
        expect(world.character(entity).velocity.z).toBe(0);
    });

    it('is moved like anything else when its body is switched off', () => {
        const { world, nav, entity } = walker();
        world.character(entity).enabled = false;
        stepNavigation(world, nav, 1 / 60, new Map());
        expect(world.pos(entity).x).toBeGreaterThan(0);
    });
});

/**
 * A replan is asked from wherever the agent has got to, and that is not always
 * somewhere the navigable world has an answer for — halfway across a link.
 * A replaced surface, however, must not resurrect an invalidated old route.
 */
describe('a replan that finds nothing', () => {
    it('stops instead of reviving a route invalidated by a replacement surface', () => {
        const world = new FakeWorld();
        const entity = world.spawnAgent(0, 0, {
            speed: 100, arriveRadius: 0, repathInterval: 0.1, hasTarget: true, targetX: 80, targetY: 0,
        });
        const nav = openNav();
        const runtimes = new Map<Entity, AgentRuntime>();
        stepNavigation(world, nav, 0.05, runtimes);
        const after = world.pos(entity).x;
        expect(after).toBeGreaterThan(0);

        // Nowhere to plan from any more, and the timer is up.
        nav.setSurface(new NavGrid({ width: 10, height: 3, cellSize: 10, walkable: new Uint8Array(30) }));
        stepNavigation(world, nav, 0.2, runtimes);
        expect(world.pos(entity).x).toBe(after);
        expect(world.agent(entity).arrived).toBe(false);
    });

    it('keeps a route when a transient query fails on the unchanged surface', () => {
        const world = new FakeWorld();
        const entity = world.spawnAgent(0, 0, {
            speed: 100, arriveRadius: 0, repathInterval: 0.1, hasTarget: true, targetX: 80, targetY: 0,
        });
        const nav = openNav(), runtimes = new Map<Entity, AgentRuntime>();
        stepNavigation(world, nav, 0.05, runtimes);
        const after = world.pos(entity).x;
        vi.spyOn(nav, 'queryWorldPath').mockReturnValue({ path: null, status: 'unavailable', reason: 'start-unavailable' });
        stepNavigation(world, nav, 0.2, runtimes);
        expect(world.pos(entity).x).toBeGreaterThan(after);
    });

    it('does not move an agent that never had one', () => {
        const world = new FakeWorld();
        const entity = world.spawnAgent(0, 0, { speed: 100, hasTarget: true, targetX: 80, targetY: 0 });
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 10, height: 3, cellSize: 10, walkable: new Uint8Array(30) }));
        stepNavigation(world, nav, 0.05, new Map());
        expect(world.pos(entity).x).toBe(0);
    });
});

/**
 * A route is planned against a world that does not move. A dozen agents sent to
 * one place all plan the same route and walk it as one body unless each of them
 * gives way, which is what declaring a RADIUS asks for.
 */
describe('agents that are bodies', () => {
    it('gets two overlapping couriers round a corner without replanning in place', () => {
        const grid = new NavGrid({ width: 23, height: 13, cellSize: 32, origin: { x: -352, y: -192 } });
        for (let y = 0; y < 13; y++) if (y < 5 || y > 7) grid.setWalkable(11, y, false);
        const nav = new Navigation();
        nav.setSurface(grid);
        nav.planningBudgetMs = 0;
        const world = new FakeWorld();
        const courier = { speed: 78, radius: 8, arriveRadius: 5, repathInterval: 0, hasTarget: true, targetY: -128 };
        const a = world.spawnAgent(-32.00013, -124.65, { ...courier, targetX: 128 });
        const b = world.spawnAgent(-32.00014, -132.78, { ...courier, targetX: 192 });
        const runtimes = new Map<Entity, AgentRuntime>();
        for (let i = 0; i < 1200 && ![a, b].every(e => world.agent(e).arrived); i++) {
            stepNavigation(world, nav, 1 / 60, runtimes);
            // Transform positions are stored as floats by the runtime registry.
            for (const e of [a, b]) {
                const p = world.pos(e);
                world.place(e, Math.fround(p.x), Math.fround(p.y));
                expect(grid.isNavigable(p, { radius: 8 })).toBe(true);
            }
        }
        expect([world.agent(a).arrived, world.agent(b).arrived]).toEqual([true, true]);
    });

    const room = (): Navigation => {
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 30, height: 30, cellSize: 10 }));
        return nav;
    };

    it('walk past each other rather than through', () => {
        const world = new FakeWorld();
        const a = world.spawnAgent(20, 150, {
            speed: 100, radius: 25, arriveRadius: 20, hasTarget: true, targetX: 270, targetY: 150,
        });
        const b = world.spawnAgent(270, 150, {
            speed: 100, radius: 25, arriveRadius: 20, hasTarget: true, targetX: 20, targetY: 150,
        });
        const nav = room();
        const runtimes = new Map<Entity, AgentRuntime>();
        let closest = Infinity;
        for (let i = 0; i < 200; i++) {
            stepNavigation(world, nav, 1 / 30, runtimes);
            const pa = world.pos(a);
            const pb = world.pos(b);
            closest = Math.min(closest, Math.hypot(pa.x - pb.x, pa.y - pb.y));
        }
        expect(closest).toBeGreaterThan(40); // their radii sum to 50, less the step
        expect(world.pos(a).x).toBeGreaterThan(200);
        expect(world.pos(b).x).toBeLessThan(90);
    });

    // An agent routed as a point declares no body: it neither gives way nor is
    // given way to, and it walks the route it was handed exactly as before.
    it('leave an agent routed as a point walking its route exactly', () => {
        const world = new FakeWorld();
        const point = world.spawnAgent(20, 150, {
            speed: 100, radius: 0, arriveRadius: 0, hasTarget: true, targetX: 270, targetY: 150,
        });
        world.spawnAgent(150, 150, { speed: 0, radius: 25 });
        const nav = room();
        const runtimes = new Map<Entity, AgentRuntime>();
        for (let i = 0; i < 60; i++) stepNavigation(world, nav, 1 / 30, runtimes);
        // Straight down the row it was planned along, through where the body is.
        expect(world.pos(point).y).toBeCloseTo(150, 1);
    });

    // Something standing in the way is still something to get round, and getting
    // round it means keeping moving: an agent that reads a stationary body as
    // "only I can avoid this" finds standing still the safest thing to do.
    it('walk round a body standing in the way', () => {
        const world = new FakeWorld();
        const mover = world.spawnAgent(20, 150, {
            speed: 100, radius: 25, arriveRadius: 20, hasTarget: true, targetX: 270, targetY: 150,
        });
        const still = world.spawnAgent(150, 150, { speed: 0, radius: 25 });
        const nav = room();
        const runtimes = new Map<Entity, AgentRuntime>();
        let closest = Infinity;
        for (let i = 0; i < 200; i++) {
            stepNavigation(world, nav, 1 / 30, runtimes);
            const pa = world.pos(mover);
            const pb = world.pos(still);
            closest = Math.min(closest, Math.hypot(pa.x - pb.x, pa.y - pb.y));
        }
        expect(world.pos(mover).x).toBeGreaterThan(200);
        expect(closest).toBeGreaterThan(40);
    });

    // A point declares no body, so it is nothing to walk round either.
    it('walk straight through an agent routed as a point', () => {
        const world = new FakeWorld();
        const mover = world.spawnAgent(20, 150, {
            speed: 100, radius: 25, arriveRadius: 20, hasTarget: true, targetX: 270, targetY: 150,
        });
        world.spawnAgent(150, 150, { speed: 0, radius: 0 });
        const nav = room();
        const runtimes = new Map<Entity, AgentRuntime>();
        for (let i = 0; i < 60; i++) stepNavigation(world, nav, 1 / 30, runtimes);
        expect(world.pos(mover).y).toBeCloseTo(150, 0);
    });

    // What each of them is already doing is half of what the others are steering
    // around, so the runtime carries it from frame to frame.
    it('remember what they travelled at', () => {
        const world = new FakeWorld();
        const a = world.spawnAgent(20, 150, {
            speed: 100, radius: 25, arriveRadius: 20, hasTarget: true, targetX: 270, targetY: 150,
        });
        // Near enough to be a neighbour, nowhere near its path: the velocity to
        // remember is then the one it wanted, which is what makes it readable.
        world.spawnAgent(150, 280, { speed: 0, radius: 25 });
        const runtimes = new Map<Entity, AgentRuntime>();
        stepNavigation(world, room(), 1 / 30, runtimes);
        const rt = runtimes.get(a)!;
        expect(Math.hypot(rt.velocityA, rt.velocityB)).toBeCloseTo(100, 0);
    });

    // Steering is not a licence to leave the world. A corridor that fits one body
    // does not fit two abreast, so two meeting in one do not get past — and an
    // agent that got past anyway got past through the wall.
    it('will not squeeze past each other through a wall', () => {
        const grid = new NavGrid({ width: 30, height: 9, cellSize: 10 });
        for (let x = 0; x < 30; x++) {
            for (let y = 0; y < 9; y++) if (y < 2 || y > 6) grid.setWalkable(x, y, false);
        }
        const nav = new Navigation();
        nav.setSurface(grid);
        const world = new FakeWorld();
        const a = world.spawnAgent(20, 40, {
            speed: 100, radius: 20, arriveRadius: 15, hasTarget: true, targetX: 270, targetY: 40,
        });
        const b = world.spawnAgent(270, 40, {
            speed: 100, radius: 20, arriveRadius: 15, hasTarget: true, targetX: 20, targetY: 40,
        });
        const runtimes = new Map<Entity, AgentRuntime>();
        for (let i = 0; i < 300; i++) {
            stepNavigation(world, nav, 1 / 30, runtimes);
            for (const e of [a, b]) {
                const p = world.pos(e);
                expect(grid.isNavigable({ x: p.x, y: p.y, z: 0 })).toBe(true);
            }
        }
        expect(world.pos(a).x).toBeLessThan(200);
        expect(world.pos(b).x).toBeGreaterThan(90);
    });

    it('keeps the original ground probe order for a custom surface', () => {
        const nav = new Navigation();
        const probes: number[] = [];
        nav.setSurface({
            up: { x: 0, y: 0, z: 1 },
            findWorldPath: (_from, to) => [{ x: to.x, y: to.y, z: to.z ?? 0 }],
            isNavigable: p => { probes.push(p.x); return true; },
            describe() {},
        });
        const world = new FakeWorld();
        world.spawnAgent(0, 0, { radius: 1, speed: 10, arriveRadius: 0, hasTarget: true, targetX: 100 });
        world.spawnAgent(-5, 0, { radius: 1 });
        stepNavigation(world, nav, 1 / 60, new Map());
        expect(probes).toHaveLength(34 * 4);
        expect(probes.slice(0, 8)).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
    });

    it('honours a project-wide override of the grid standing query', () => {
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 64, height: 64, cellSize: 10 }));
        const world = new FakeWorld();
        world.spawnAgent(100, 100, { radius: 2, speed: 10, arriveRadius: 0, repathInterval: 0,
            hasTarget: true, targetX: 300, targetY: 100 });
        world.spawnAgent(94, 100, { radius: 2 });
        const runtimes = new Map<Entity, AgentRuntime>();
        stepNavigation(world, nav, 1 / 60, runtimes);
        const standing = vi.spyOn(NavGrid.prototype, 'isNavigable').mockReturnValue(true);
        try {
            stepNavigation(world, nav, 1 / 60, runtimes);
            expect(standing.mock.calls.length).toBeGreaterThanOrEqual(34 * 4);
        } finally {
            standing.mockRestore();
        }
    });

    it('are not slowed by an empty room', () => {
        const world = new FakeWorld();
        const alone = world.spawnAgent(20, 150, {
            speed: 100, radius: 25, arriveRadius: 0, hasTarget: true, targetX: 270, targetY: 150,
        });
        const nav = room();
        const runtimes = new Map<Entity, AgentRuntime>();
        for (let i = 0; i < 30; i++) stepNavigation(world, nav, 1 / 30, runtimes);
        expect(world.pos(alone).x).toBeCloseTo(120, 0);
    });
});
