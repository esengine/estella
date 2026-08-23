// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavPlugin.ts
 * @brief   Bakes NavVolumes and drives NavAgents: plan-on-demand + kinematic
 *          path following.
 *
 * One system, gated to play mode. Per-entity runtime path lives in a closure
 * Map (the `defineBehavior` pattern) so the NavAgent component stays purely
 * authorable/serializable. The per-frame logic is `stepNavigation`, extracted
 * so it unit-tests against a fake world. MVP integrates the Transform directly
 * (kinematic); physics `moveCharacter` avoidance is a later stage
 * (REARCH_GAMEPLAY_AI.md AI4) — the planned route already clears static blockers.
 */

import type { App, Plugin } from '../../app/app';
import type { Entity, Vec3 } from '../../types';
import { defineSystem, Schedule, GetWorld } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import {
    Transform,
    type AnyComponentDef,
    type ComponentData,
} from '../../ecs/component';
import { playModeOnly } from '../../ecs/env';
import { CharacterController3D } from '../../physics3d/Physics3DComponents';
import { log } from '../../util/logger';
import { Navigation, Nav } from './Navigation';
import { NavAgent } from './NavAgent';
import { NavVolume } from './NavVolume';
import { NavObstacle } from './NavObstacle';
import { buildNavMesh } from './navmesh/build';
import { collectNavGeometry, navGeometryReady, type NavGeometry } from './navGeometry';
import {
    applyObstaclesToGrid, collectNavObstacles, navObstacleDigest,
    collectNavLinks, navLinkDigest, type NavObstacleBox,
} from './navObstacles';
import { NavGrid } from './NavGrid';
import { NavMesh, type NavLinkSegment } from './NavMesh';
import { NavLink } from './NavLink';
import { setupNavDebugDraw } from './NavDebugDraw';
import { advanceAlongPath } from './follow';
import { avoidVelocity, type AvoidanceNeighbour } from './avoidance';

/** Per-entity runtime path state, owned by the driving system (not serialized). */
export interface AgentRuntime {
    waypoints: Vec3[];
    index: number;
    plannedX: number;
    plannedY: number;
    plannedZ: number;
    repathTimer: number;
    reachable: boolean;
    /** What it travelled at last frame, on the two axes it steers on. Everyone
     *  avoiding everyone needs to know what everyone is already doing. */
    velocityA: number;
    velocityB: number;
}

/** Where the bake gets its triangles. Null until the world can answer — a mesh
 *  collider has none until its asset has loaded, and a volume is baked once. */
export type NavGeometryProvider = (min: Vec3, max: Vec3, layers: number) => NavGeometry;

/**
 * Bake the scene's NavVolume and install the mesh. A scene has ONE navigable
 * world, so the first volume is baked and the rest are named in the log: a box
 * decides where to LOOK, walkability comes from the geometry in it, and one box
 * big enough for the level costs voxels rather than correctness.
 */
export function bakeVolumes(
    world: NavWorldView,
    nav: Navigation,
    geometry: NavGeometryProvider | null,
    baked: Set<Entity>,
    obstacles: readonly NavObstacleBox[] = [],
    links: readonly NavLinkSegment[] = [],
): void {
    if (!geometry) return;
    const volumes = world.getEntitiesWithComponents([NavVolume, Transform]);
    for (const entity of volumes) {
        if (baked.has(entity)) continue;
        const volume = world.get(entity, NavVolume);
        // The volume is placed in the same space the geometry is collected in.
        const at = world.get(entity, Transform).position;
        const h = volume.halfExtents;
        const min = { x: at.x - h.x, y: at.y - h.y, z: at.z - h.z };
        const max = { x: at.x + h.x, y: at.y + h.y, z: at.z + h.z };

        const geo = geometry(min, max, volume.layers);
        baked.add(entity);

        const mesh = buildNavMesh(geo.verts, geo.indices, {
            min, max,
            cellSize: volume.cellSize,
            cellHeight: volume.cellHeight,
            maxSlopeDegrees: volume.maxSlopeDegrees,
            agentHeight: volume.agentHeight,
            agentRadius: volume.agentRadius,
            stepHeight: volume.stepHeight,
            obstacles,
            links,
        });
        nav.setSurface(mesh);

        // Baked once, so a volume that found nothing stays empty: say so rather
        // than leave a scene with agents that never move and no reason given.
        if (mesh.polyCount === 0) {
            log.warn('nav', `NavVolume on entity ${entity} baked no walkable ground from `
                + `${geo.bodyCount} static bodies — check that it covers the floor, that the`
                + ' floor is a STATIC RigidBody3D, and that `layers` includes it');
        }
        if (volumes.length > 1) {
            for (const other of volumes) baked.add(other);
            log.warn('nav', `${volumes.length} NavVolumes in this scene — only the first is`
                + ' baked, since a scene has one navigable world; make one box big enough'
                + ' to hold the level instead');
        }
        return;
    }
}

/**
 * Take the obstacles as they are now, and say whether the surface had to be
 * rebuilt for them. Blocking is a bake input, not a query filter — one marked
 * after the erosion would leave routes scraping its face — so a door opening is a
 * bake, throttled to one per NAV_REBAKE_MS. `state` is carried across frames.
 */
export function updateObstacles(
    nav: Navigation, obstacles: readonly NavObstacleBox[], state: ObstacleState, now: number,
): boolean {
    const digest = navObstacleDigest(obstacles);
    const grid = nav.surface instanceof NavGrid ? nav.surface : null;
    const changed = digest !== state.digest;
    // A grid the game only just installed has never had the obstacles put on it,
    // however long they have stood still.
    const unmarked = grid !== null && grid !== state.grid;
    if (!changed && !unmarked) return false;
    if (changed && now - state.at < NAV_REBAKE_MS) {
        // Something is still moving. Say so ONCE: an obstacle that never settles
        // rebuilds the world several times a second, which is a scene to fix
        // rather than a cost to absorb.
        if (++state.deferred === REBAKE_COMPLAINT) {
            log.warn('nav', 'a NavObstacle keeps moving, so the navigable world keeps being'
                + ' rebuilt — an obstacle is for something that blocks and then stops,'
                + ' not for something that travels');
        }
        return false;
    }
    state.digest = digest;
    state.at = now;
    state.deferred = 0;
    // A grid blocks by the cell and can be re-marked in place; a mesh has to be
    // baked again, which is what the caller does with a `true`.
    if (grid) {
        applyObstaclesToGrid(grid, obstacles);
        state.grid = grid;
    }
    return changed;
}

/**
 * Re-join a mesh's links when the scene's have changed. Separate from the
 * obstacles because it is a different KIND of change: a link joins polygons that
 * already exist, so moving one costs a lookup rather than a bake, and paying a
 * bake for it would be the reason nobody moves one.
 */
export function updateLinks(
    nav: Navigation, links: readonly NavLinkSegment[], state: LinkState,
): void {
    const digest = navLinkDigest(links);
    const mesh = nav.surface instanceof NavMesh ? nav.surface : null;
    if (digest === state.digest && mesh === state.mesh) return;
    state.digest = digest;
    state.mesh = mesh;
    if (mesh) mesh.connect(links);
}

/** What the obstacles were when the world was last built for them. */
export interface ObstacleState {
    digest: number;
    at: number;
    deferred: number;
    grid: NavGrid | null;
}

/** What the links were when the mesh was last joined for them. */
export interface LinkState {
    digest: number;
    mesh: NavMesh | null;
}

/** The shortest gap between two rebuilds. A door should shut at once; something
 *  that keeps moving must not take the frame rate with it. */
const NAV_REBAKE_MS = 200;
/** How many deferred rebuilds in a row are worth a word about the scene. */
const REBAKE_COMPLAINT = 8;

/** The slice of `World` the nav step needs — lets tests inject a fake. */
export interface NavWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): readonly Entity[];
    has<C extends AnyComponentDef>(entity: Entity, component: C): boolean;
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
}

/**
 * Advance every NavAgent one frame: (re)plan when the target moved or the
 * repath timer elapsed, then follow the path kinematically. `runtimes` carries
 * per-entity path state across frames.
 */
export function stepNavigation(
    world: NavWorldView,
    nav: Navigation,
    dt: number,
    runtimes: Map<Entity, AgentRuntime>,
): void {
    if (dt <= 0) return;

    // Which two axes an agent steers on: the ones the surface's own up leaves out.
    // A flat scene is walked in x/y; ground with height in it, in x/z.
    const flat = Math.abs(nav.surface?.up.z ?? 0) > Math.abs(nav.surface?.up.y ?? 1);
    const entities = world.getEntitiesWithComponents([NavAgent, Transform]);
    const crowd = gatherCrowd(world, entities, runtimes, flat);

    for (const entity of entities) {
        const agent = world.get(entity, NavAgent);
        if (!agent.hasTarget) {
            runtimes.delete(entity);
            continue;
        }

        const tf = world.get(entity, Transform);
        let rt = runtimes.get(entity);

        const targetMoved = !rt || rt.plannedX !== agent.targetX || rt.plannedY !== agent.targetY
            || rt.plannedZ !== agent.targetZ;
        const timerElapsed = rt ? (rt.repathTimer -= dt) <= 0 : false;
        if (!rt || targetMoved || (agent.repathInterval > 0 && timerElapsed)) {
            const path = nav.findWorldPath(
                tf.position,
                { x: agent.targetX, y: agent.targetY, z: agent.targetZ },
                { radius: agent.radius },
            );
            // A plan that cannot be replaced beats no plan: an agent crossing a
            // link is not standing on the navigable world, so the replan it asks
            // for there has no answer and dropping the route strands it mid-air.
            const keep = path === null && rt !== undefined && rt.reachable
                && rt.index < rt.waypoints.length;
            if (keep && rt) {
                rt.plannedX = agent.targetX;
                rt.plannedY = agent.targetY;
                rt.plannedZ = agent.targetZ;
                rt.repathTimer = agent.repathInterval;
            } else {
                rt = {
                    waypoints: path ?? [],
                    // Skip the start point to avoid stepping back toward it.
                    index: path && path.length > 1 ? 1 : 0,
                    plannedX: agent.targetX,
                    plannedY: agent.targetY,
                    plannedZ: agent.targetZ,
                    repathTimer: agent.repathInterval,
                    reachable: path !== null,
                    velocityA: rt?.velocityA ?? 0,
                    velocityB: rt?.velocityB ?? 0,
                };
            }
            runtimes.set(entity, rt);
        }

        // Keep an unreachable agent's runtime for throttled retry (next target
        // change or repath timer) rather than churning it every frame.
        if (!rt.reachable) continue;

        // A body walks; anything else is moved, and which one an entity is, is
        // what it CARRIES. A character has a solver that collides, steps up and
        // falls; a follower writing the Transform would fight all three.
        const character = world.has(entity, CharacterController3D)
            ? world.get(entity, CharacterController3D) : null;
        const steering = agent.radius > 0
            ? neighboursOf(crowd, entity, tf.position, flat, agent.radius)
            : null;
        const done = character && character.enabled !== false
            ? steerCharacter(world, entity, agent, rt, character, dt, flat, steering, nav)
            : walkTransform(world, entity, agent, rt, tf, dt, flat, steering, nav);

        if (done) {
            agent.arrived = true;
            agent.hasTarget = false;
            world.set(entity, NavAgent, agent);
            runtimes.delete(entity);
        }
    }
}

/**
 * Everyone on the surface who is a BODY, in the two axes they steer on. An agent
 * routed as a point declares no body and neither gives way nor is given way to.
 */
function gatherCrowd(
    world: NavWorldView, entities: readonly Entity[],
    runtimes: Map<Entity, AgentRuntime>, flat: boolean,
): Array<AvoidanceNeighbour & { entity: Entity }> {
    const out: Array<AvoidanceNeighbour & { entity: Entity }> = [];
    for (const entity of entities) {
        const agent = world.get(entity, NavAgent);
        if (agent.radius <= 0) continue;
        const at = world.get(entity, Transform).position;
        const rt = runtimes.get(entity);
        out.push({
            entity,
            x: at.x,
            z: flat ? at.y : at.z,
            vx: rt?.velocityA ?? 0,
            vz: rt?.velocityB ?? 0,
            radius: agent.radius,
        });
    }
    return out;
}

/** How far away another body is worth steering round, as a multiple of the two
 *  radii — past this the two cannot meet inside the horizon anyway. */
const NEIGHBOUR_REACH = 6;

function neighboursOf(
    crowd: ReadonlyArray<AvoidanceNeighbour & { entity: Entity }>,
    self: Entity, at: Vec3, flat: boolean, radius: number,
): AvoidanceNeighbour[] | null {
    const x = at.x;
    const z = flat ? at.y : at.z;
    const out: AvoidanceNeighbour[] = [];
    for (const other of crowd) {
        if (other.entity === self) continue;
        const reach = (radius + other.radius) * NEIGHBOUR_REACH;
        if (Math.hypot(other.x - x, other.z - z) > reach) continue;
        out.push(other);
    }
    return out.length > 0 ? out : null;
}

/**
 * The velocity to travel at this frame: straight at the next waypoint, bent round
 * whoever else is walking there. Only a body steers — an agent routed as a point
 * has nothing to be in the way of, and nothing to be in its way.
 */
function steerTo(
    target: Vec3, at: Vec3, agent: ComponentData<typeof NavAgent>, rt: AgentRuntime,
    flat: boolean, neighbours: AvoidanceNeighbour[] | null, nav: Navigation,
): { a: number; b: number } {
    const a = at.x;
    const b = flat ? at.y : at.z;
    const da = target.x - a;
    const db = (flat ? target.y : target.z) - b;
    const length = Math.hypot(da, db);
    const want = {
        x: length > 0 ? (da / length) * agent.speed : 0,
        z: length > 0 ? (db / length) * agent.speed : 0,
    };
    if (!neighbours) return { a: want.x, b: want.z };

    const surface = nav.surface;
    const height = at.y;
    const v = avoidVelocity(
        { x: a, z: b, vx: rt.velocityA, vz: rt.velocityB, radius: agent.radius },
        want, neighbours,
        {
            horizon: AVOID_HORIZON,
            maxSpeed: agent.speed,
            canStand: surface
                ? (px, pz) => surface.isNavigable(
                    flat ? { x: px, y: pz, z: height } : { x: px, y: height, z: pz })
                : undefined,
        },
    );
    return { a: v.x, b: v.z };
}

/** How far ahead a collision with another body is worth steering round. */
const AVOID_HORIZON = 1.6;

/** Move the Transform along the path directly. Returns whether the goal is reached. */
function walkTransform(
    world: NavWorldView, entity: Entity, agent: ComponentData<typeof NavAgent>,
    rt: AgentRuntime, tf: ComponentData<typeof Transform>, dt: number,
    flat: boolean, neighbours: AvoidanceNeighbour[] | null, nav: Navigation,
): boolean {
    if (neighbours) return walkAmongBodies(world, entity, agent, rt, tf, dt, flat, neighbours, nav);
    const pos = { x: tf.position.x, y: tf.position.y, z: tf.position.z };
    rt.index = advanceAlongPath(pos, rt.waypoints, rt.index, agent.speed * dt);
    rt.velocityA = 0;
    rt.velocityB = 0;
    tf.position.x = pos.x;
    tf.position.y = pos.y;
    tf.position.z = pos.z;
    world.set(entity, Transform, tf);

    // Arrival is a DISTANCE, not the end of the list: an agent that has to stop
    // short of what it is chasing never reaches the last waypoint, and one that
    // walks the path exactly stands on top of its target.
    const goal = rt.waypoints[rt.waypoints.length - 1];
    const withinGoal = goal !== undefined && agent.arriveRadius > 0
        && Math.hypot(goal.x - pos.x, goal.y - pos.y, goal.z - pos.z) <= agent.arriveRadius;
    return rt.index >= rt.waypoints.length || withinGoal;
}

/**
 * A body walking among other bodies: it is steered rather than marched, because a
 * route walked exactly is a route that goes through whoever is standing on it. The
 * waypoint moves on by proximity, since a body cannot be snapped onto a point.
 */
function walkAmongBodies(
    world: NavWorldView, entity: Entity, agent: ComponentData<typeof NavAgent>,
    rt: AgentRuntime, tf: ComponentData<typeof Transform>, dt: number,
    flat: boolean, neighbours: AvoidanceNeighbour[], nav: Navigation,
): boolean {
    const pos = tf.position;
    const reach = Math.max(agent.speed * dt * 1.5, WAYPOINT_REACH);
    while (rt.index < rt.waypoints.length) {
        const wp = rt.waypoints[rt.index]!;
        if (planeDistance(wp, pos, flat) > reach) break;
        rt.index++;
    }

    const goal = rt.waypoints[rt.waypoints.length - 1];
    const withinGoal = goal !== undefined && agent.arriveRadius > 0
        && planeDistance(goal, pos, flat) <= agent.arriveRadius;
    const target = rt.waypoints[rt.index];
    if (rt.index >= rt.waypoints.length || withinGoal || target === undefined) {
        rt.velocityA = 0;
        rt.velocityB = 0;
        return true;
    }

    const v = steerTo(target, pos, agent, rt, flat, neighbours, nav);
    rt.velocityA = v.a;
    rt.velocityB = v.b;
    pos.x += v.a * dt;
    if (flat) pos.y += v.b * dt;
    else pos.z += v.b * dt;
    // The axis the route carries is the ground's, followed rather than steered on.
    const height = flat ? target.z : target.y;
    const own = flat ? pos.z : pos.y;
    const lifted = own + (height - own) * Math.min(1, dt * HEIGHT_FOLLOW);
    if (flat) pos.z = lifted; else pos.y = lifted;
    world.set(entity, Transform, tf);
    return false;
}

/** How fast a steered agent settles onto the height of the ground it is over. */
const HEIGHT_FOLLOW = 8;

/** Distance in the two axes an agent steers on. */
function planeDistance(a: Vec3, b: Vec3, flat: boolean): number {
    return Math.hypot(a.x - b.x, (flat ? a.y : a.z) - (flat ? b.y : b.z));
}

/**
 * Point a character controller at the next waypoint and let its own solver move
 * it. Only the horizontal axes are written — the vertical one is the world's, and
 * that is what makes a route down a step a fall. Distances are in the ground plane
 * for the same reason: a capsule stands with its CENTRE above the floor.
 */
function steerCharacter(
    world: NavWorldView, entity: Entity, agent: ComponentData<typeof NavAgent>,
    rt: AgentRuntime, character: ComponentData<typeof CharacterController3D>, dt: number,
    flat: boolean, neighbours: AvoidanceNeighbour[] | null, nav: Navigation,
): boolean {
    const tf = world.get(entity, Transform);
    const pos = tf.position;
    // A body cannot be snapped onto a waypoint, so one counts as reached when it
    // is closer than the step this frame would have taken — otherwise an agent
    // orbits the waypoint it can never land exactly on.
    const reach = Math.max(agent.speed * dt * 1.5, WAYPOINT_REACH);
    while (rt.index < rt.waypoints.length) {
        const wp = rt.waypoints[rt.index]!;
        if (Math.hypot(wp.x - pos.x, wp.z - pos.z) > reach) break;
        rt.index++;
    }

    const goal = rt.waypoints[rt.waypoints.length - 1];
    const withinGoal = goal !== undefined && agent.arriveRadius > 0
        && Math.hypot(goal.x - pos.x, goal.z - pos.z) <= agent.arriveRadius;
    const target = rt.waypoints[rt.index];
    const done = rt.index >= rt.waypoints.length || withinGoal || target === undefined;

    if (done) {
        character.velocity.x = 0;
        character.velocity.z = 0;
        rt.velocityA = 0;
        rt.velocityB = 0;
    } else {
        const v = steerTo(target, pos, agent, rt, flat, neighbours, nav);
        character.velocity.x = v.a;
        character.velocity.z = v.b;
        rt.velocityA = v.a;
        rt.velocityB = v.b;
    }
    world.set(entity, CharacterController3D, character);
    return done;
}

/** How close a body has to get to a waypoint before the route moves on, in world
 *  pixels, for an agent too slow for its own step to be the answer. */
const WAYPOINT_REACH = 8;

export class NavPlugin implements Plugin {
    name = 'nav';

    build(app: App): void {
        app.insertResource(Nav, new Navigation());
        // Installed with the surface, drawn only once a game turns the resource
        // on — the same bargain the 3D physics overlay makes.
        setupNavDebugDraw(app);

        const runtimes = new Map<Entity, AgentRuntime>();
        const baked = new Set<Entity>();
        const obstacleState: ObstacleState = { digest: 0, at: 0, deferred: 0, grid: null };
        const linkState: LinkState = { digest: 0, mesh: null };
        app.world.onDespawn((entity: Entity) => {
            runtimes.delete(entity);
            baked.delete(entity);
        });

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Nav), Res(Time), GetWorld()],
                (nav: Navigation, time: TimeData, world) => {
                    // A NavVolume is baked from the colliders a scene authors, so
                    // there is no solver to wait for — only the mesh assets some
                    // of those colliders read, which arrive when they arrive.
                    const provider = navGeometryReady(app.world)
                        ? (min: Vec3, max: Vec3, layers: number) =>
                            collectNavGeometry(app.world, { min, max, layers })
                        : null;
                    const obstacles = collectNavObstacles(app.world);
                    const links = collectNavLinks(app.world);
                    if (updateObstacles(nav, obstacles, obstacleState, Date.now())) baked.clear();
                    bakeVolumes(world as NavWorldView, nav, provider, baked, obstacles, links);
                    updateLinks(nav, links, linkState);
                    stepNavigation(world as NavWorldView, nav, time.delta, runtimes);
                },
                {
                    name: 'NavAgentSystem',
                    touches: {
                        reads: [NavVolume._name, NavObstacle._name, NavLink._name],
                        writes: [NavAgent._name, Transform._name, CharacterController3D._name],
                    },
                    // Both move an entity; for one carrying both, the path is the
                    // intent and the drift is not, so the follow lands last. The
                    // order registration already produced — declared, not changed.
                    runAfter: ['VelocitySystem'],
                },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const navPlugin = new NavPlugin();
