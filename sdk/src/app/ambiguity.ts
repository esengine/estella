// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Systems whose order nobody decided.
 *
 *        A schedule runs its systems in topological order, and for two systems
 *        with no edge between them that order falls out of registration and a
 *        depth-first walk. That is fine while they touch different data. When
 *        one writes what the other reads, the result depends on which happened
 *        to come first — so adding a third system, or moving a plugin in the
 *        build list, can change what the game does with nothing to point at.
 *
 *        Naming those pairs is also the prerequisite for ever running them at
 *        the same time: a pair that must not be reordered cannot be a batch.
 */
import type { SystemDef } from '../ecs/system';
import { accessOf, conflicts, conflictBetween, type SystemAccess } from './access';

/** A system with the ordering it declared, as a schedule holds it. */
export interface OrderedSystem {
    system: SystemDef;
    runBefore?: readonly string[];
    runAfter?: readonly string[];
}

/** Resolves an ordering name to the indices it refers to (a system, or a set). */
export type ResolveTargets = (name: string) => readonly number[];

/**
 * `edges[i]` lists the indices that must run BEFORE `i`. `runBefore` is folded
 * in symmetrically, so both spellings of one relationship produce one edge.
 */
export function dependencyEdges(
    systems: readonly OrderedSystem[],
    resolveTargets: ResolveTargets,
): number[][] {
    const edges: number[][] = systems.map(() => []);
    const addEdge = (from: number, to: number): void => {
        if (from === to) return;
        const list = edges[to];
        if (!list.includes(from)) list.push(from);
    };
    for (let i = 0; i < systems.length; i++) {
        for (const name of systems[i].runAfter ?? []) {
            for (const j of resolveTargets(name)) addEdge(j, i);
        }
        for (const name of systems[i].runBefore ?? []) {
            for (const j of resolveTargets(name)) addEdge(i, j);
        }
    }
    return edges;
}

/** Two systems that touch the same data with nothing saying which goes first. */
export interface Ambiguity {
    /** The two system names, in registration order. */
    a: string;
    b: string;
    /** The components and resources they disagree over. */
    over: string[];
}

/** Everything that must run before each index, transitively. */
function ancestors(edges: readonly number[][]): Set<number>[] {
    const out: Set<number>[] = edges.map(() => new Set<number>());
    const done = new Uint8Array(edges.length);
    const visit = (i: number, stack: Set<number>): void => {
        if (done[i] || stack.has(i)) return;
        stack.add(i);
        for (const dep of edges[i]) {
            visit(dep, stack);
            out[i].add(dep);
            for (const t of out[dep]) out[i].add(t);
        }
        stack.delete(i);
        done[i] = 1;
    };
    for (let i = 0; i < edges.length; i++) visit(i, new Set<number>());
    return out;
}

/**
 * Every pair of systems in one schedule that conflicts and is unordered.
 *
 * Reported in registration order and deduplicated, so a schedule's ambiguities
 * are a stable list something can be held to.
 */
export function detectAmbiguities(
    systems: readonly OrderedSystem[],
    resolveTargets: ResolveTargets,
): Ambiguity[] {
    if (systems.length < 2) return [];
    const edges = dependencyEdges(systems, resolveTargets);
    const before = ancestors(edges);
    const access: SystemAccess[] = systems.map((s) => accessOf(s.system));

    const found: Ambiguity[] = [];
    for (let i = 0; i < systems.length; i++) {
        for (let j = i + 1; j < systems.length; j++) {
            if (before[i].has(j) || before[j].has(i)) continue;
            if (!conflicts(access[i], access[j])) continue;
            found.push({
                a: systems[i].system._name,
                b: systems[j].system._name,
                over: conflictBetween(access[i], access[j]),
            });
        }
    }
    return found;
}

/**
 * Systems grouped into batches that could run at the same time: a batch is free
 * of conflicts within itself and its dependencies are met by the batches before
 * it. The schedule still runs them one after another — this measures how much of
 * one is inherently sequential.
 */
export function parallelBatches(
    systems: readonly OrderedSystem[],
    resolveTargets: ResolveTargets,
): string[][] {
    const edges = dependencyEdges(systems, resolveTargets);
    const access: SystemAccess[] = systems.map((s) => accessOf(s.system));
    const placed = new Int32Array(systems.length).fill(-1);
    const batches: number[][] = [];

    let remaining = systems.length;
    while (remaining > 0) {
        const batch: number[] = [];
        for (let i = 0; i < systems.length; i++) {
            if (placed[i] >= 0) continue;
            if (edges[i].some((dep) => placed[dep] < 0)) continue;
            if (batch.some((k) => conflicts(access[i], access[k]))) continue;
            batch.push(i);
        }
        // A cycle in the edges would leave nothing runnable; the sort reports
        // that with the path, so here it only has to stop.
        if (batch.length === 0) break;
        for (const i of batch) placed[i] = batches.length;
        batches.push(batch);
        remaining -= batch.length;
    }
    return batches.map((b) => b.map((i) => systems[i].system._name));
}
