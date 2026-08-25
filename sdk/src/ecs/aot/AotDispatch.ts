// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotDispatch.ts
 * @brief   One call of the contract, in place of the closure.
 *
 * @details `REARCH_AOT_ABI.md` §2.1 gives the host four jobs around a compiled
 *          system: pack the rows, resolve the resources, ready the command
 *          buffer, apply what came back. This is that host on web, and what it
 *          costs is not a detail — `bench/aot-frame` measured the packing at
 *          ~110 ns per entity per frame, the same for a three-multiply body and
 *          for one with four unrolled integration steps. A compiled system's
 *          cost today IS this file.
 *
 *          So everything a call does twice is done once. A PLAN per system holds
 *          what cannot change between frames: the resolved components, one
 *          address resolver each, and the query cache's key and dependency ids —
 *          the same two the interpreted `QueryInstance` precomputes, through the
 *          same door, so the two paths cannot disagree about what a query means.
 *
 *          Rows are written straight into a flat scratch and handed over as one
 *          block. The nested `[entity, addr, addr]` arrays this replaced were two
 *          allocations per entity per frame and then a word-by-word copy of the
 *          same numbers.
 *
 *          And then they are KEPT. A row table is a function of two things: which
 *          entities match, and where their components are. Each has an authority
 *          that already answers cheaply — the query cache hands back the very same
 *          array while its answer stands, and `World.layoutEpoch` is one number
 *          over every pool's own version. When neither moved, last frame's rows
 *          are this frame's rows, and packing is the cost that disappears
 *          (bench/aot-frame: 27.5 ns per entity per frame to under 2).
 *
 *          A world that cannot answer the second question — an engine artifact
 *          with no epoch binding — repacks every frame. Trusting an address
 *          because nobody could tell us it moved is how a compiled system reads
 *          somebody else's bytes.
 */

import type { AnyComponentDef } from '../component';
import { computeQueryCacheKey, type World } from '../world';
import type { Entity } from '../../types';
import { CMD_DESPAWN } from './AotContext';
import type { AotRuntime } from './AotRuntime';
import type { AotTwin } from './AotSystems';

/** No `With`/`Without` on a compiled query; the subset has no syntax for one. */
const NO_FILTERS: AnyComponentDef[] = [];
/** What a query that named an unknown component matches. */
const EMPTY_ENTITIES: readonly Entity[] = [];

/** What one declared Query needs, resolved once. */
interface QueryPlan {
    /** The components it names, in the order the rows must carry them. */
    readonly comps: AnyComponentDef[];
    /** One address resolver per component, hoisted out of the row loop. */
    readonly resolvers: ((entity: Entity) => number | undefined)[];
    /** The components it may write AND something is watching — the only ones
     *  worth a `Changed` tick, since `recordChanged` would drop the rest. */
    readonly mutated: AnyComponentDef[];
    readonly key: string;
    readonly depIds: symbol[];
    /** `1 + comps.length`: the entity, then one address each (§2.2). */
    readonly width: number;
    /** False when a name in the manifest is not a component of this world; such
     *  a query matches nothing rather than reading address zero. */
    readonly resolved: boolean;
}

interface Plan {
    readonly queries: QueryPlan[];
    readonly resources: readonly string[];
    /** Rows for every query, back to back, in query order. */
    scratch: Uint32Array;
    /** Rows written per query this call. */
    readonly counts: Uint32Array;
    /** Where each query's rows begin in `scratch`, in words. */
    readonly offsets: Uint32Array;
    /** How much of `scratch` this call filled. */
    rowWords: number;
    /** The entity array each query was packed from, by identity: the query cache
     *  returns the same one while its answer stands, and a different one the
     *  moment the set or the order changed. */
    readonly packedFrom: (readonly Entity[] | null)[];
    /** `World.layoutEpoch` when they were packed; null when it cannot be had. */
    packedAt: number | null;
}

/**
 * The compiled half of the scheduler: given a twin, run it against this world.
 *
 * One per installed runtime, holding one plan per twin — a system's shape is
 * fixed by the build that produced it, so nothing here is recomputed per frame.
 */
export class AotDispatch {
    private readonly plans = new Map<AotTwin, Plan>();

    constructor(private readonly world: World, private readonly runtime: AotRuntime) {}

    run(twin: AotTwin): void {
        const plan = this.planFor_(twin);
        this.packRows_(plan, this.world.layoutEpoch());

        const resources = plan.resources.map((name) => this.runtime.addresses.resourceAt(name) ?? 0);
        this.runtime.ctx.build(plan.scratch, plan.rowWords, plan.offsets, plan.counts, resources);
        twin.call(this.runtime.ctx.address);
        this.runtime.systems.noteCall();

        for (const cmd of this.runtime.ctx.commands()) {
            // Only despawn is in the v1 record set.
            if (cmd.kind === CMD_DESPAWN) this.world.despawn(cmd.a as unknown as Entity);
        }
        this.markChanged_(plan);
    }

    /** Drop the plans; the next call rebuilds them. */
    reset(): void {
        this.plans.clear();
    }

    /**
     * Every row of every query, written into one block.
     *
     * A row whose components cannot all answer is not written: an address of zero
     * is a real address, and the compiled code would read somebody else's bytes.
     */
    private packRows_(plan: Plan, epoch: number | null): void {
        // The whole table or none of it: one query's rows moving says nothing
        // about another's, but a repack is a walk of both and this way there is
        // one condition to reason about rather than one per query.
        let reuse = epoch !== null && epoch === plan.packedAt;
        const lists: (readonly Entity[])[] = [];
        for (let k = 0; k < plan.queries.length; k++) {
            const q = plan.queries[k];
            const entities = q.resolved
                ? this.world.queryEntities(q.comps, NO_FILTERS, NO_FILTERS, q.key, undefined, q.depIds)
                : EMPTY_ENTITIES;
            lists.push(entities);
            if (entities !== plan.packedFrom[k]) reuse = false;
        }
        if (reuse) return;

        let at = 0;
        for (let k = 0; k < plan.queries.length; k++) {
            const q = plan.queries[k];
            plan.offsets[k] = at;
            plan.packedFrom[k] = lists[k]!;
            if (!q.resolved) {
                plan.counts[k] = 0;
                continue;
            }
            const entities = lists[k]!;
            plan.scratch = grow(plan.scratch, at + entities.length * q.width);
            const rows = plan.scratch;
            const width = q.width;
            const resolvers = q.resolvers;
            let n = 0;
            for (let i = 0; i < entities.length; i++) {
                const entity = entities[i];
                const write = at + n * width;
                let whole = true;
                for (let c = 0; c < resolvers.length; c++) {
                    const address = resolvers[c](entity);
                    if (address === undefined) { whole = false; break; }
                    rows[write + 1 + c] = address;
                }
                if (!whole) continue;
                rows[write] = entity as unknown as number;
                n++;
            }
            plan.counts[k] = n;
            at += n * width;
        }
        plan.rowWords = at;
        plan.packedAt = epoch;
    }

    /**
     * The `Changed` ticks the compiled code could not record — it never calls
     * back. Asked once per component rather than per row: `recordChanged`
     * self-gates on the same answer, and on a hot path with nothing listening
     * that is a per-row cost spent for nothing.
     */
    private markChanged_(plan: Plan): void {
        for (let k = 0; k < plan.queries.length; k++) {
            const q = plan.queries[k];
            const n = plan.counts[k];
            if (q.mutated.length === 0 || n === 0) continue;
            for (const def of q.mutated) {
                if (!this.world.isChangeTracked(def)) continue;
                const base = plan.offsets[k];
                for (let i = 0; i < n; i++) {
                    this.world.markChanged(plan.scratch[base + i * q.width] as unknown as Entity, def);
                }
            }
        }
    }

    private planFor_(twin: AotTwin): Plan {
        let plan = this.plans.get(twin);
        if (plan) return plan;
        const queries = twin.decl.queries.map((args, k): QueryPlan => {
            const comps: AnyComponentDef[] = [];
            for (const a of args) {
                const def = this.runtime.addresses.componentNamed(a.comp);
                if (def) comps.push(def);
            }
            const resolved = comps.length === args.length;
            return {
                comps,
                resolvers: comps.map((c) => this.world.addressResolver(c)),
                mutated: [...(twin.mutated[k] ?? [])],
                key: computeQueryCacheKey(comps),
                depIds: comps.map((c) => c._id as symbol),
                width: 1 + comps.length,
                resolved,
            };
        });
        plan = {
            queries,
            resources: twin.decl.resources,
            scratch: new Uint32Array(0),
            counts: new Uint32Array(queries.length),
            offsets: new Uint32Array(queries.length),
            rowWords: 0,
            packedFrom: queries.map(() => null),
            packedAt: null,
        };
        this.plans.set(twin, plan);
        return plan;
    }
}

/** At least `words` long, keeping what is already written. */
function grow(rows: Uint32Array, words: number): Uint32Array {
    if (rows.length >= words) return rows;
    const bigger = new Uint32Array(Math.max(words, rows.length * 2, 64));
    bigger.set(rows);
    return bigger;
}
