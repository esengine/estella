// SPDX-License-Identifier: Apache-2.0
import type { Entity } from '../../types';
import { Transform } from '../../ecs/component';
import { NavAgent } from './NavAgent';
import { NavGrid } from './NavGrid';
import type { Navigation } from './Navigation';
import type { NavSurface } from './NavSurface';
import type { AgentRuntime, NavWorldView } from './NavPlugin';

interface PlanningState {
    surface: NavSurface | null;
    revision: number;
    gridRevision: number;
    pending: Set<Entity>;
    invalidated: Set<Entity>;
    blocked: Set<Entity>;
}
const states = new WeakMap<Map<Entity, AgentRuntime>, PlanningState>();
const now = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

/** FIFO requests name entities, not captured targets: queued target edits coalesce
 * and the eventual query reads the current position, target and body radius. */
export function planNavigation(
    world: NavWorldView, nav: Navigation, dt: number,
    runtimes: Map<Entity, AgentRuntime>, entities: readonly Entity[],
): ReadonlySet<Entity> {
    const began = now();
    let state = states.get(runtimes);
    if (!state) {
        state = { surface: null, revision: -1, gridRevision: -1, pending: new Set(), invalidated: new Set(), blocked: new Set() };
        states.set(runtimes, state);
    }
    const gridRevision = nav.surface instanceof NavGrid ? nav.surface.topologyRevision : -1;
    const changed = state.surface !== nav.surface || state.revision !== nav.pathRevision || state.gridRevision !== gridRevision;
    state.surface = nav.surface; state.revision = nav.pathRevision; state.gridRevision = gridRevision;
    const live = new Set(entities);
    state.blocked.clear();
    for (const entity of state.pending) if (!live.has(entity)) { state.pending.delete(entity); state.invalidated.delete(entity); }
    for (const entity of state.invalidated) if (!live.has(entity)) state.invalidated.delete(entity);
    for (const entity of runtimes.keys()) if (!live.has(entity)) runtimes.delete(entity);
    for (const entity of entities) {
        const agent = world.get(entity, NavAgent), rt = runtimes.get(entity);
        if (!agent.hasTarget) {
            if (rt || state.pending.has(entity)) state.blocked.add(entity);
            runtimes.delete(entity); state.pending.delete(entity); state.invalidated.delete(entity);
            continue;
        }
        if (rt) rt.repathTimer -= dt;
        const radiusChanged = rt !== undefined && (rt.plannedRadius ?? 0) !== agent.radius;
        const targetMoved = rt !== undefined && (rt.plannedX !== agent.targetX || rt.plannedY !== agent.targetY || rt.plannedZ !== agent.targetZ);
        if (changed || radiusChanged || rt?.needsReplan) state.invalidated.add(entity);
        if (!rt || changed || targetMoved || radiusChanged || rt.needsReplan
            || (agent.repathInterval > 0 && rt.repathTimer <= 0)) state.pending.add(entity);
        // A periodic refresh may keep following its still-valid route. New or
        // invalidated intent must wait instead of moving toward an old target.
        if (state.pending.has(entity) && (!rt?.reachable || targetMoved || state.invalidated.has(entity))) state.blocked.add(entity);
    }
    let completed = 0;
    const limit = nav.maxPlansPerFrame > 0 ? Math.max(1, Math.floor(nav.maxPlansPerFrame)) : Infinity;
    const budget = nav.planningBudgetMs > 0 ? nav.planningBudgetMs : Infinity;
    try {
        for (const entity of state.pending) {
            if (completed >= limit || (completed > 0 && now() - began >= budget)) break;
            // Remove before querying: a custom query that throws must not pin the
            // queue's head forever. Its due request is re-added next tick.
            state.pending.delete(entity);
            const agent = world.get(entity, NavAgent), tf = world.get(entity, Transform);
            let rt = runtimes.get(entity);
            const result = nav.queryWorldPath(tf.position,
                { x: agent.targetX, y: agent.targetY, z: agent.targetZ }, { radius: agent.radius });
            const path = result.path;
            // Preserve a valid route while crossing an off-mesh link, but never
            // resurrect one invalidated by a changed surface or obstacle layout.
            const keep = path === null && !state.invalidated.has(entity) && rt?.reachable
                && rt.index < rt.waypoints.length;
            if (keep && rt) {
                rt.plannedX = agent.targetX; rt.plannedY = agent.targetY; rt.plannedZ = agent.targetZ;
                rt.plannedRadius = agent.radius; rt.repathTimer = agent.repathInterval;
            } else {
                const recoveringStart = !!rt?.needsReplan && agent.radius > 0;
                rt = { waypoints: path ?? [], index: recoveringStart ? 0 : path && path.length > 1 ? 1 : 0,
                    plannedX: agent.targetX, plannedY: agent.targetY, plannedZ: agent.targetZ,
                    plannedRadius: agent.radius, repathTimer: agent.repathInterval,
                    partial: result.status === 'partial',
                    recoveringStart,
                    reachable: path !== null, velocityA: rt?.velocityA ?? 0, velocityB: rt?.velocityB ?? 0 };
            }
            runtimes.set(entity, rt);
            state.invalidated.delete(entity);
            state.blocked.delete(entity);
            completed++;
        }
    } finally {
        nav.planningStats.completed = completed;
        nav.planningStats.pending = state.pending.size;
        nav.planningStats.elapsedMs = now() - began;
    }
    return state.blocked;
}
