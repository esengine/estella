// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ecs/entityOrder.ts
 * @brief   Permute the JS-side entity containers to a caller-supplied order.
 *
 * @details Iteration order is painter order: the engine walks its component pools
 *          and the SDK walks these Maps/Sets, and within a sorting layer whichever
 *          entity is visited last lands on top. Both sides are insertion-ordered,
 *          so "apply this order" means re-inserting in rank order — which is what
 *          {@link World.applyEntityOrder} does through these two helpers.
 *
 *          Ranking is stable: an entity the caller did not rank keeps its position
 *          relative to the other unranked ones, after every ranked one.
 */

import type { Entity } from '../types';

/** Rank for an entity the caller did not order — sorts last, stably. */
export const UNRANKED = Number.MAX_SAFE_INTEGER;

/** `entity -> rank` for {@link reorderMapByRank}/{@link reorderSetByRank}. */
export type RankOf = (entity: Entity) => number;

/** Build a stable rank function from an ordered entity list (first = rank 0). */
export function rankByOrder(order: readonly Entity[]): RankOf {
    const ranks = new Map<Entity, number>();
    for (const entity of order) {
        if (!ranks.has(entity)) ranks.set(entity, ranks.size);  // duplicate: first wins
    }
    return (entity: Entity) => ranks.get(entity) ?? UNRANKED;
}

/** Re-insert `map`'s entries in rank order (values untouched). */
export function reorderMapByRank<V>(map: Map<Entity, V>, rankOf: RankOf): void {
    if (map.size <= 1) return;
    const entries = Array.from(map);
    // Array.prototype.sort is stable (ES2019+), which is what keeps unranked
    // entities in their existing relative order.
    entries.sort((a, b) => rankOf(a[0]) - rankOf(b[0]));
    map.clear();
    for (const [entity, value] of entries) map.set(entity, value);
}

/** Re-insert `set`'s entities in rank order. */
export function reorderSetByRank(set: Set<Entity>, rankOf: RankOf): void {
    if (set.size <= 1) return;
    const entities = Array.from(set);
    entities.sort((a, b) => rankOf(a) - rankOf(b));
    set.clear();
    for (const entity of entities) set.add(entity);
}
