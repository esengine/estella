// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The interest path, reproduced segment by segment.
 *
 * `sampleWithInterest_` costs C × E and the question is which of its passes
 * spends that. So each one is timed and COUNTED separately rather than wrapped
 * in one timer: a visited count says what the mechanism does, where a wall time
 * says what this machine did today.
 *
 * Position lives in a script component rather than the builtin `Transform` the
 * shipped default reads. That understates arm A — a builtin read crosses the
 * wasm boundary — so every ratio here is conservative about how much the full
 * scans cost.
 */
import { pathToFileURL } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export { sdkIdentity } from '../replication-dirty/workload.mjs';

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

export function defineComponents(sdk) {
    return {
        Pos: sdk.defineComponent('IPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] }),
        Owned: sdk.defineComponent('IOwned', { owner: -1 }, { replicatedFields: ['owner'] }),
    };
}

/** Every segment's clock and its visit count, in one place so nothing is untimed. */
export function newStats() {
    return {
        ns: {
            materialize: 0n, anchor: 0n, radius: 0n, owner: 0n,
            enter: 0n, leave: 0n, removeFilter: 0n, dirtyFilter: 0n,
        },
        visited: {
            candidates: 0, anchor: 0, radius: 0, distanceTests: 0, owner: 0,
            enter: 0, leave: 0, removals: 0, dirty: 0,
        },
        visibleTotal: 0,
    };
}

/**
 * A square world of `population` entities on a uniform grid, and `connections`
 * each owning `anchorsPerConn` of them. Owners are spread across the grid so a
 * connection's view is a real neighbourhood rather than a corner.
 */
export function buildWorld(sdk, world, { population, connections, anchorsPerConn }) {
    const { Pos, Owned } = defineComponents(sdk);
    const side = Math.ceil(Math.sqrt(population));
    const entities = new Array(population);
    for (let i = 0; i < population; i++) {
        const e = world.spawn();
        world.insert(e, Pos, { x: i % side, y: Math.floor(i / side), z: 0 });
        world.insert(e, Owned, { owner: -1 });
        entities[i] = e;
    }
    const owned = new Map();
    const stride = Math.max(1, Math.floor(population / (connections * anchorsPerConn)));
    let at = 0;
    for (let c = 0; c < connections; c++) {
        const mine = [];
        for (let k = 0; k < anchorsPerConn; k++) {
            const e = entities[(at * stride) % population];
            at++;
            world.set(e, Owned, { owner: c });
            mine.push(e);
        }
        owned.set(c, mine);
    }
    return { entities, owned, side, Pos, Owned };
}

/** Move `count` entities one step. Deterministic in `tick`, as every probe here is. */
export function applyMovement(world, ctx, tick, count) {
    const { entities, Pos } = ctx;
    const n = entities.length;
    if (count <= 0) return 0;
    let moved = 0;
    let idx = (tick * 7919) % n;
    for (let k = 0; k < Math.min(count, n); k++) {
        const e = entities[idx];
        const p = world.get(e, Pos);
        world.update(e, Pos, (d) => { d.x = p.x + ((tick + k) % 3) - 1; });
        moved++;
        idx = (idx + 7919) % n;
    }
    return moved;
}

const positionOf = (world, Pos, e) => world.tryGet(e, Pos);

/**
 * Arm A: exactly what ships. Anchors are found by scanning the whole candidate
 * list, the radius test walks it again, and the server walks it a THIRD time to
 * put back entities the connection owns.
 */
export function visibleForA(world, ctx, connId, candidates, r2, stats) {
    const { Pos, Owned } = ctx;
    let t = process.hrtime.bigint();
    const anchors = [];
    for (const e of candidates) {
        stats.visited.anchor++;
        const own = world.tryGet(e, Owned);
        if (own?.owner !== connId) continue;
        const p = positionOf(world, Pos, e);
        if (p) anchors.push(p);
    }
    stats.ns.anchor += process.hrtime.bigint() - t;

    if (anchors.length === 0) return new Set(candidates);

    t = process.hrtime.bigint();
    const visible = radiusScan(world, ctx, candidates, anchors, r2, stats);
    stats.ns.radius += process.hrtime.bigint() - t;

    t = process.hrtime.bigint();
    for (const e of candidates) {
        stats.visited.owner++;
        if (visible.has(e)) continue;
        const own = world.tryGet(e, Owned);
        if (own?.owner === connId) visible.add(e);
    }
    stats.ns.owner += process.hrtime.bigint() - t;
    return visible;
}

/**
 * Arm B: the same radius scan, with an ownership index. Only the two passes
 * that exist to answer "what does this connection own" change — so B/A prices
 * exactly those, and nothing else.
 */
export function visibleForB(world, ctx, connId, candidates, r2, stats, ownedIndex) {
    const { Pos } = ctx;
    let t = process.hrtime.bigint();
    const anchors = [];
    for (const e of ownedIndex.get(connId) ?? []) {
        stats.visited.anchor++;
        const p = positionOf(world, Pos, e);
        if (p) anchors.push(p);
    }
    stats.ns.anchor += process.hrtime.bigint() - t;

    if (anchors.length === 0) return new Set(candidates);

    t = process.hrtime.bigint();
    const visible = radiusScan(world, ctx, candidates, anchors, r2, stats);
    stats.ns.radius += process.hrtime.bigint() - t;

    t = process.hrtime.bigint();
    for (const e of ownedIndex.get(connId) ?? []) {
        stats.visited.owner++;
        visible.add(e);
    }
    stats.ns.owner += process.hrtime.bigint() - t;
    return visible;
}

/** The radius pass both arms share: every candidate against every anchor. */
function radiusScan(world, ctx, candidates, anchors, r2, stats) {
    const { Pos } = ctx;
    const visible = new Set();
    for (const e of candidates) {
        stats.visited.radius++;
        const p = positionOf(world, Pos, e);
        if (!p) { visible.add(e); continue; }
        for (const a of anchors) {
            stats.visited.distanceTests++;
            const dx = p.x - a.x;
            const dy = p.y - a.y;
            const dz = (p.z ?? 0) - (a.z ?? 0);
            if (dx * dx + dy * dy + dz * dz <= r2) { visible.add(e); break; }
        }
    }
    return visible;
}

/** The per-connection work that follows the visibility set, timed separately. */
export function diffAndFilter(visible, previous, dirty, removals, stats) {
    let t = process.hrtime.bigint();
    const enters = [];
    for (const e of visible) {
        stats.visited.enter++;
        if (!previous.has(e)) enters.push(e);
    }
    stats.ns.enter += process.hrtime.bigint() - t;

    t = process.hrtime.bigint();
    const leaves = [];
    for (const e of previous) {
        stats.visited.leave++;
        if (!visible.has(e)) leaves.push(e);
    }
    stats.ns.leave += process.hrtime.bigint() - t;

    t = process.hrtime.bigint();
    let mineRemovals = 0;
    for (const r of removals) {
        stats.visited.removals++;
        if (visible.has(r)) mineRemovals++;
    }
    stats.ns.removeFilter += process.hrtime.bigint() - t;

    t = process.hrtime.bigint();
    let mineDirty = 0;
    for (const d of dirty) {
        stats.visited.dirty++;
        if (visible.has(d)) mineDirty++;
    }
    stats.ns.dirtyFilter += process.hrtime.bigint() - t;

    stats.visibleTotal += visible.size;
    return { enters, leaves, mineRemovals, mineDirty };
}
