// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The one workload every arm runs, and the four ways of finding what
 *        changed. Shared so the arms differ in EXACTLY the mechanism under
 *        test: the same entities, the same components, the same fields, the
 *        same values, on the same ticks.
 *
 * The mutation schedule is a pure function of (tick, entityCount, dirtyRate) —
 * no RNG state, so two processes cannot drift apart. Selection strides by a
 * prime rather than taking a contiguous run, so a scan cannot be flattered by
 * locality the real thing would not have.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const STRIDE = 7919; // coprime with every entity count used here

/** Load the SDK's headless build from a repo checkout. */
export async function loadSdk(root) {
    const entry = path.join(root, 'sdk', 'dist', 'index.node.js');
    return import(pathToFileURL(entry).href);
}

/**
 * Four replicated components per entity, of which THREE are mutated and one is
 * static — a scan pays for every replicated component whether it moves or not,
 * and a world where everything moves is not the world being modelled.
 */
export function defineWorkloadComponents(sdk) {
    const { defineComponent } = sdk;
    return [
        { def: defineComponent('WlPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] }), fields: ['x', 'y', 'z'], mutated: true },
        { def: defineComponent('WlVitals', { hp: 100, mp: 50 }, { replicatedFields: ['hp', 'mp'] }), fields: ['hp', 'mp'], mutated: true },
        { def: defineComponent('WlMotion', { vx: 0, vy: 0 }, { replicatedFields: ['vx', 'vy'] }), fields: ['vx', 'vy'], mutated: true },
        { def: defineComponent('WlIdent', { team: 0, tag: '' }, { replicatedFields: ['team', 'tag'] }), fields: ['team', 'tag'], mutated: false },
    ];
}

/** Populate a world with `count` entities carrying every workload component. */
export function buildWorld(world, table, count) {
    const entities = new Array(count);
    for (let i = 0; i < count; i++) {
        const e = world.spawn();
        world.insert(e, table[0].def, { x: i, y: 0, z: 0 });
        world.insert(e, table[1].def, { hp: 100, mp: 50 });
        world.insert(e, table[2].def, { vx: 0, vy: 0 });
        world.insert(e, table[3].def, { team: i & 3, tag: 'unit' });
        entities[i] = e;
    }
    return entities;
}

/**
 * Apply one simulation tick's writes. Deterministic in `tick`: the same
 * entities take the same values in every arm, which is what makes the arms
 * comparable at all.
 */
export function applyTick(world, table, entities, tick, dirtyCount) {
    const n = entities.length;
    if (dirtyCount <= 0) return;
    if (dirtyCount >= n) {
        for (let i = 0; i < n; i++) writeOne(world, table, entities, i, tick);
        return;
    }
    // Modulo every step, not one subtraction: STRIDE outruns the smallest entity
    // count here, and an index that walks off the array writes nothing while
    // still reporting the dirty rate it never applied.
    let idx = (tick * STRIDE) % n;
    for (let k = 0; k < dirtyCount; k++) {
        writeOne(world, table, entities, idx, tick);
        idx = (idx + STRIDE) % n;
    }
}

/** One entity's write: one of the three mutable components, values from tick. */
function writeOne(world, table, entities, i, tick) {
    const e = entities[i];
    switch ((tick + i) % 3) {
        case 0: world.set(e, table[0].def, { x: i + tick, y: tick, z: 0 }); break;
        case 1: world.set(e, table[1].def, { hp: 100 - (tick % 97), mp: 50 + (i % 13) }); break;
        default: world.set(e, table[2].def, { vx: (tick % 31) - 15, vy: (i % 17) - 8 }); break;
    }
}

// ---------------------------------------------------------------------------
// Shadow
// ---------------------------------------------------------------------------

/**
 * entity → componentIndex → { field: lastBroadcastValue }, SEEDED as production
 * seeds it at `registerEntity_`: first state ships in the spawn payload, so the
 * first sample owes nothing. An empty shadow instead emits the whole world once
 * and reads as a catastrophic tracker miss that is really the baseline.
 */
export function newShadow(world, entities, table) {
    const shadow = new Map();
    for (const e of entities) {
        const perComp = new Map();
        for (let ci = 0; ci < table.length; ci++) {
            const entry = table[ci];
            if (!world.has(e, entry.def)) continue;
            const data = world.tryGet(e, entry.def);
            const snap = {};
            for (const f of entry.fields) snap[f] = data[f];
            perComp.set(ci, snap);
        }
        shadow.set(e, perComp);
    }
    return shadow;
}

/**
 * Compare one entity's one component against its shadow, updating it. Returns
 * the changed-field mask (0 = nothing moved). This is the production
 * `collectDirty_` inner loop, reproduced so all four arms share it.
 */
function verify(world, entry, ci, e, perComp, out) {
    if (!world.has(e, entry.def)) return 0;
    const data = world.tryGet(e, entry.def);
    let snap = perComp.get(ci);
    if (!snap) { snap = {}; perComp.set(ci, snap); }
    let mask = 0;
    for (let f = 0; f < entry.fields.length; f++) {
        const key = entry.fields[f];
        const value = data[key];
        if (!(key in snap) || snap[key] !== value) {
            mask |= 1 << f;
            snap[key] = value;
        }
    }
    if (mask !== 0) out.push(e, ci, mask);
    return mask;
}

// ---------------------------------------------------------------------------
// The four arms
// ---------------------------------------------------------------------------

/** A/B — every known entity, every replicated component, every field. */
export function sampleFullShadow(world, table, entities, shadow, out) {
    let compares = 0;
    let visited = 0;
    for (let ci = 0; ci < table.length; ci++) {
        const entry = table[ci];
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            visited++;
            compares += entry.fields.length;
            verify(world, entry, ci, e, shadow.get(e), out);
        }
    }
    return { visited, compares };
}

/**
 * C — the tracker names candidates, the shadow still decides. Against the
 * ChangeTracker as it EXISTS: `anyChangedSince` gates a whole component in O(1),
 * but nothing indexes which entities changed, so the per-entity question is
 * still asked once per entity. Inventing that index would measure absent code.
 */
export function sampleTrackedCandidates(world, table, entities, shadow, since, out, recall) {
    let compares = 0;
    let visited = 0;
    let candidates = 0;
    for (let ci = 0; ci < table.length; ci++) {
        const entry = table[ci];
        if (!world.anyChangedSince(entry.def, since)) {
            if (recall) recall.skippedComponents++;
            continue;
        }
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            visited++;
            if (!world.isChangedSince(e, entry.def, since)) continue;
            candidates++;
            compares += entry.fields.length;
            verify(world, entry, ci, e, shadow.get(e), out);
        }
    }
    return { visited, compares, candidates };
}

/** D — candidates trusted outright. COUNTERFACTUAL: it assumes the very thing
 *  this probe is investigating. It bounds the ceiling, it justifies nothing. */
export function sampleTrackerOnly(world, table, entities, shadow, since, out) {
    let visited = 0;
    let candidates = 0;
    for (let ci = 0; ci < table.length; ci++) {
        const entry = table[ci];
        if (!world.anyChangedSince(entry.def, since)) continue;
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i];
            visited++;
            if (!world.isChangedSince(e, entry.def, since)) continue;
            candidates++;
            const data = world.tryGet(e, entry.def);
            if (data) out.push(e, ci, (1 << entry.fields.length) - 1);
        }
    }
    return { visited, compares: 0, candidates };
}

// ---------------------------------------------------------------------------
// Output identity
// ---------------------------------------------------------------------------

/**
 * An order-sensitive digest of everything a sample emitted. Arms that claim to
 * produce the same replication output must produce the same number here, and it
 * crosses process boundaries, which in-process comparison cannot.
 */
export class Digest {
    constructor() { this.h = 0x811c9dc5; this.entries = 0; }
    push(entity, ci, mask) {
        this.entries++;
        this.mix(entity); this.mix(ci); this.mix(mask);
    }
    mix(v) {
        let h = this.h ^ (v >>> 0);
        h = Math.imul(h, 0x01000193);
        this.h = h >>> 0;
    }
    get value() { return this.h >>> 0; }
}
