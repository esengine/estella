// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    archetype.ts
 * @brief   What a ghost is built from — the construction half of a spawn.
 *
 *          A spawn answers three questions under three contracts: who this
 *          entity is on the wire, what the client is DECLARED to know about it,
 *          and what it takes for a proxy of it to exist at all. This is the
 *          third. The server sends a key, the client runs the builder
 *          registered under it, and what the authority happens to have on the
 *          entity — an AI blackboard, an unrevealed objective — is not part of
 *          the answer.
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { log } from '../../util/logger';

/**
 * Builds the client-side shape of one replicated entity. Runs BEFORE the
 * replication baseline is applied, so anything the authority declares wins over
 * what this sets: a re-spawn after leaving and re-entering interest arrives at
 * the current state, not at a fresh default.
 *
 * @experimental
 */
export type ReplicationArchetype = (world: World, entity: Entity) => void;

const archetypes = new Map<string, ReplicationArchetype>();

/**
 * Declare how a ghost of `key` is built. The server names one per replicated
 * entity through `Replicated.archetype`, and a client that cannot resolve the
 * key refuses the spawn rather than building half of it. Synchronous in this
 * first form: a key resolving to a preloaded prefab is a later question.
 *
 * @experimental
 */
export function registerReplicationArchetype(key: string, build: ReplicationArchetype): void {
    if (key === '') throw new Error('[repl] a replication archetype needs a non-empty key');
    if (archetypes.has(key) && archetypes.get(key) !== build) {
        log.warn('repl', `replication archetype "${key}" re-registered; the later one wins`);
    }
    archetypes.set(key, build);
}

/** @internal What the client runs for a spawn naming `key`. */
export function getReplicationArchetype(key: string): ReplicationArchetype | undefined {
    return archetypes.get(key);
}

/** @internal Drop every registration — a project reload, or one test's keys
 *  leaking into the next. */
export function clearReplicationArchetypes(): void {
    archetypes.clear();
}
