// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Four ways to get one sample's wire debt to the connections that want it.
 *
 * All four consume the SAME canonical truth — this sample's dirty rows, its
 * component removals, and each connection's visibility — and must produce the
 * same plan. What differs is only which side of the cross product they walk.
 *
 * Debt is merged per ENTITY first. An entity with two dirty components and a
 * removal is one reverse lookup, not three, and one `affected` lookup on the
 * pull side too — the wire still carries removals before the delta.
 */

/** This sample's debt, keyed by entity, in first-appearance order. */
export function mergeByEntity(dirty, removals) {
    const affected = new Map();
    const of = (e) => {
        let d = affected.get(e);
        if (!d) { d = { dirty: [], removals: [] }; affected.set(e, d); }
        return d;
    };
    for (let i = 0; i < removals.length; i++) of(removals[i].entity).removals.push(i);
    for (let i = 0; i < dirty.length; i++) of(dirty[i].entity).dirty.push(i);
    return affected;
}

const empty = () => ({ removals: [], delta: [] });
/** Row INDICES, so two plans compare exactly — including the order they went in. */
const order = (plan) => {
    plan.removals.sort((a, b) => a - b);
    plan.delta.sort((a, b) => a - b);
    return plan;
};

/**
 * A — what ships: every connection walks the whole removal list and the whole
 * dirty list, whatever fraction of the world it can see.
 */
export function routeCurrent(conns, dirty, removals, entered) {
    let visits = 0;
    const out = new Map();
    for (const c of conns) {
        const ent = entered.get(c.id);
        const plan = empty();
        for (let i = 0; i < removals.length; i++) {
            visits++;
            const r = removals[i];
            if (c.visible.has(r.entity) && !ent.has(r.entity)) plan.removals.push(i);
        }
        for (let i = 0; i < dirty.length; i++) {
            visits++;
            const d = dirty[i];
            if (!c.visible.has(d.entity) || ent.has(d.entity)) continue;
            plan.delta.push(i);
        }
        out.set(c.id, plan);
    }
    return { out, visits };
}

/**
 * The lookup both the chooser and the push router need: one reverse-index probe
 * per affected entity. Done once and handed on, as production would.
 */
export function fanout(affected, viewers) {
    const rows = [];
    let units = affected.size;
    for (const [e, debt] of affected) {
        const seen = viewers.get(e);
        rows.push([e, debt, seen]);
        units += seen ? seen.size : 0;
    }
    return { rows, units };
}

/**
 * P — push: each affected entity is handed to the connections that can see it.
 * The reverse lookup is paid even for an entity nobody watches, which is why the
 * unit count is `U + F` and not `F`.
 */
export function routePush(conns, dirty, removals, entered, rows) {
    let visits = 0;
    const out = new Map();
    for (const c of conns) out.set(c.id, empty());
    for (const [e, debt, seen] of rows) {
        visits++;
        if (!seen) continue;
        for (const id of seen) {
            visits++;
            if (entered.get(id).has(e)) continue;
            const plan = out.get(id);
            if (!plan) continue;
            for (const i of debt.removals) plan.removals.push(i);
            for (const i of debt.dirty) plan.delta.push(i);
        }
    }
    for (const plan of out.values()) order(plan);
    return { out, visits };
}

/**
 * L — pull: each connection asks its own view whether anything happened to it.
 * Bounded by total interest membership whatever the dirty rate is.
 */
export function routePull(conns, dirty, removals, entered, affected) {
    let visits = 0;
    const out = new Map();
    for (const c of conns) {
        const ent = entered.get(c.id);
        const plan = empty();
        for (const e of c.visible) {
            visits++;
            const debt = affected.get(e);
            if (!debt || ent.has(e)) continue;
            for (const i of debt.removals) plan.removals.push(i);
            for (const i of debt.dirty) plan.delta.push(i);
        }
        out.set(c.id, order(plan));
    }
    return { out, visits };
}

/**
 * H — whichever is smaller, decided from facts this sample already holds: the
 * unique affected entities plus their exact viewer fanout, against the total
 * interest membership. No rate, no average, no threshold.
 */
export function routeAdaptive(conns, dirty, removals, entered, affected, viewers, membership) {
    // Exact and free: `U + F >= U`, so more affected entities than interest
    // memberships means push cannot win whatever the fanout is. Measuring F to
    // learn that costs U reverse lookups, which is push's own dominant term.
    const U = affected.size;
    if (U >= membership) {
        const r = routePull(conns, dirty, removals, entered, affected);
        return { ...r, chose: 'pull', pushUnits: U, pullUnits: membership, exact: false };
    }
    const { rows, units } = fanout(affected, viewers);
    if (units < membership) {
        const r = routePush(conns, dirty, removals, entered, rows);
        return { ...r, chose: 'push', pushUnits: units, pullUnits: membership, exact: true };
    }
    const r = routePull(conns, dirty, removals, entered, affected);
    // The fanout probe is spent either way: it is what the choice is made on,
    // and it is bounded by U, which this branch already knows is under S.
    return { ...r, visits: r.visits + U, chose: 'pull', pushUnits: units, pullUnits: membership, exact: true };
}
