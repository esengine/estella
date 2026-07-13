// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    interest.ts
 * @brief   Interest management — per-connection relevance filtering.
 *
 * A policy decides which replicated entities a connection receives. The server
 * evaluates it once per ready connection per sample tick; entities entering a
 * connection's interest are spawned to it (full current state), entities
 * leaving are despawned (the client drops the ghost), and delta frames carry
 * only entities inside it. Two invariants live in the server, not here: a
 * connection always sees the entities it owns, and with no policy installed
 * every connection sees everything (the pre-interest broadcast behavior).
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import type { World } from '../../world';
import type { Entity } from '../../types';
import { getComponent } from '../../component';
import { Replicated, type ReplicatedData } from './components';

/** What a policy sees when the server asks it for one connection's interest. */
export interface InterestView {
    /** The connection being evaluated. */
    connectionId: number;
    world: World;
    /** Every currently replicated entity — the set to filter. */
    candidates: readonly Entity[];
}

/**
 * Returns the entities relevant to the connection, or `'all'` for no
 * filtering. Runs on the server once per ready connection per sample tick, so
 * keep it cheap — return a subset of `candidates`, don't run queries of your
 * own.
 */
export type InterestPolicy = (view: InterestView) => ReadonlySet<Entity> | 'all';

export interface RadiusInterestOptions {
    /**
     * How to read an entity's 2D position. Defaults to the `Transform`
     * component's world-space `position`. Return null for "this entity has no
     * place" — such entities are always relevant (they can't be culled by
     * distance).
     */
    position?: (world: World, entity: Entity) => { x: number; y: number } | null;
}

/**
 * The built-in spatial policy: a connection sees the entities within `radius`
 * of any entity it owns (its pawn/s). Placeless entities (no position) are
 * always relevant. Fail-open: while a connection owns no positioned entity
 * (e.g. before gameplay provisions its pawn) it sees everything.
 */
export function radiusInterest(radius: number, options: RadiusInterestOptions = {}): InterestPolicy {
    const r2 = radius * radius;
    const positionOf = options.position ?? defaultPosition;
    return ({ connectionId, world, candidates }) => {
        const anchors: { x: number; y: number }[] = [];
        for (const e of candidates) {
            const repl = world.tryGet(e, Replicated) as ReplicatedData | null;
            if (repl?.owner !== connectionId) continue;
            const p = positionOf(world, e);
            if (p) anchors.push(p);
        }
        if (anchors.length === 0) return 'all';

        const visible = new Set<Entity>();
        for (const e of candidates) {
            const p = positionOf(world, e);
            if (!p) {
                visible.add(e);
                continue;
            }
            for (const a of anchors) {
                const dx = p.x - a.x;
                const dy = p.y - a.y;
                if (dx * dx + dy * dy <= r2) {
                    visible.add(e);
                    break;
                }
            }
        }
        return visible;
    };
}

function defaultPosition(world: World, entity: Entity): { x: number; y: number } | null {
    const Transform = getComponent('Transform');
    if (!Transform || !world.has(entity, Transform)) return null;
    const t = world.tryGet(entity, Transform) as { position?: { x: number; y: number } } | null;
    return t?.position ? { x: t.position.x, y: t.position.y } : null;
}
