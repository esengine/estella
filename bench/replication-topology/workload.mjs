// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The one workload every arm runs, and the two ways of finding which
 *        entities entered or left replication.
 *
 * The question is registry lifecycle, not field values: nothing here writes a
 * replicated field. Membership churn is a pure function of the tick, so two
 * processes cannot drift apart.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export { sdkIdentity } from '../replication-dirty/workload.mjs';

/** The newest hand-written .ts under `dir`, in epoch ms. */
function newestSource(dir) {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        newest = Math.max(newest, entry.isDirectory() ? newestSource(full)
            : entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts')
                ? statSync(full).mtimeMs : 0);
    }
    return newest;
}

export async function loadSdk(root) {
    const entry = path.join(root, 'sdk', 'dist', 'index.node.js');
    if (newestSource(path.join(root, 'sdk', 'src')) > statSync(entry).mtimeMs) {
        throw new Error('sdk/dist is older than sdk/src — this run would measure the previous'
            + ' commit. Build it with `pnpm --filter ./sdk build`.');
    }
    return import(pathToFileURL(entry).href);
}

/**
 * For each component, the entities whose MEMBERSHIP moved, and from which tick
 * each reader still needs them. Deliberately not "added" and "removed" as
 * separate records: the registry re-reads the world rather than acting on what
 * history says, so "worth re-checking" is the whole requirement.
 */
export class TopologyJournal {
    #rows = [];
    #retainFrom = 0;

    /** One membership event. This is the write tax the B arm isolates. */
    record(entity, tick) {
        this.#rows.push({ entity, tick });
    }

    /** Entities worth re-checking since `floor` (strict `>`, as the tracker is). */
    since(floor) {
        const out = new Set();
        for (const row of this.#rows) if (row.tick > floor) out.add(row.entity);
        return out;
    }

    /** Give up everything through `lastTick`, as a reader-owned claim does. */
    advance(lastTick) {
        this.#retainFrom = lastTick + 1;
        let w = 0;
        for (let i = 0; i < this.#rows.length; i++) {
            if (this.#rows[i].tick >= this.#retainFrom) this.#rows[w++] = this.#rows[i];
        }
        this.#rows.length = w;
    }

    get size() { return this.#rows.length; }
}

/** The server's view: which entities the clients have been told exist. */
export class Registry {
    known = new Set();
    knownNetIds = new Map();
    #nextNetId = 1;

    register(e) {
        this.known.add(e);
        this.knownNetIds.set(e, this.#nextNetId++);
    }

    unregister(e) {
        const netId = this.knownNetIds.get(e);
        this.known.delete(e);
        this.knownNetIds.delete(e);
        return netId;
    }
}

/**
 * `count` entities carrying Replicated, and a dormant pool the churn moves them
 * into and out of. Dormant entities still EXIST — losing the component and being
 * despawned are different events, and the reducer has to answer for both.
 */
export function buildPopulation(sdk, world, count) {
    const live = [];
    const dormant = [];
    for (let i = 0; i < count; i++) {
        const e = world.spawn();
        world.insert(e, sdk.Replicated, { owner: 0 });
        live.push(e);
    }
    return { live, dormant };
}

/**
 * One tick's membership churn, deterministic in `tick`. Four shapes in rotation
 * so every cell of the reducer is exercised: leaving, returning, dying, and
 * being born already replicated.
 */
export function applyChurn(sdk, world, pop, tick, count, journal) {
    for (let k = 0; k < count; k++) {
        const shape = (tick + k) % 4;
        if (shape === 0 && pop.live.length > 1) {
            const e = pop.live.pop();
            world.remove(e, sdk.Replicated);
            pop.dormant.push(e);
            journal?.record(e, world.getWorldTick());
        } else if (shape === 1 && pop.dormant.length > 0) {
            const e = pop.dormant.pop();
            world.insert(e, sdk.Replicated, { owner: 0 });
            pop.live.push(e);
            journal?.record(e, world.getWorldTick());
        } else if (shape === 2 && pop.live.length > 1) {
            const e = pop.live.pop();
            world.despawn(e);
            journal?.record(e, world.getWorldTick());
        } else {
            const e = world.spawn();
            world.insert(e, sdk.Replicated, { owner: 0 });
            pop.live.push(e);
            journal?.record(e, world.getWorldTick());
        }
    }
}

/**
 * Today's reconcile: read every replicated entity, then walk the registry.
 * O(population) whether anything moved or not.
 */
export function reconcileFull(sdk, world, registry) {
    const current = world.getEntitiesWithComponents([sdk.Replicated]);
    const currentSet = new Set(current);
    const spawned = [];
    const despawned = [];
    for (const e of current) {
        if (!registry.known.has(e)) { registry.register(e); spawned.push(e); }
    }
    for (const e of [...registry.known]) {
        if (!currentSet.has(e) || !world.valid(e)) {
            const netId = registry.unregister(e);
            if (netId !== undefined) despawned.push({ entity: e, netId });
        }
    }
    return { spawned, despawned, visited: current.length + registry.known.size };
}

/**
 * The candidate reducer: the journal says who to re-check, and `known × current
 * world` says what is true. A membership that left and came back before the
 * sample is one candidate that is known and live — so, nothing.
 */
export function reconcileIncremental(sdk, world, registry, journal, floor) {
    const candidates = journal.since(floor);
    const spawned = [];
    const despawned = [];
    for (const e of candidates) {
        const isKnown = registry.known.has(e);
        // `valid` is belt to `has`'s braces — an entity id carries its generation,
        // so a stale handle misses the storage map anyway. Sabotaging it alone
        // does NOT redden this probe; see the README.
        const isLive = world.valid(e) && world.has(e, sdk.Replicated);
        if (!isKnown && isLive) { registry.register(e); spawned.push(e); }
        else if (isKnown && !isLive) {
            const netId = registry.unregister(e);
            if (netId !== undefined) despawned.push({ entity: e, netId });
        }
    }
    return { spawned, despawned, visited: candidates.size };
}
