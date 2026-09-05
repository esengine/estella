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
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { getComponent } from '../../ecs/component';
import { Replicated, type ReplicatedData } from './components';

/** What a policy sees when the server asks it for one connection's interest. */
export interface InterestView {
    /** The connection being evaluated. */
    connectionId: number;
    world: World;
    /** Every currently replicated entity — the set to filter. */
    candidates: readonly Entity[];
    /** The entities this connection owns, when the host keeps an index of them.
     *  A policy that needs its own anchors should prefer this over reading
     *  `Replicated.owner` off every candidate; absent, fall back to that. */
    owned?: readonly Entity[];
}

/**
 * Returns the entities relevant to the connection, or `'all'` for no
 * filtering. Runs on the server once per ready connection per sample tick, so
 * keep it cheap — return a subset of `candidates`, don't run queries of your
 * own.
 */
export type InterestPolicy = (view: InterestView) => ReadonlySet<Entity> | 'all';

/**
 * What a provider is given to build one snapshot from.
 *
 * `entities` is an iterable, not an array: a provider that scans the population
 * may, but installing one must not itself cost an O(population) materialization.
 *
 * @experimental
 */
export interface InterestProviderPrepareView {
    readonly world: World;
    readonly entities: Iterable<Entity>;
    readonly entityCount: number;
    /**
     * Which entities entered replication since the last prepare, and which left.
     * A provider that keeps state between samples maintains it from these rather
     * than walking `entities`; absent (an older host, or a first prepare it was
     * not given), it has to seed from `entities` instead.
     *
     * @experimental
     */
    readonly entered?: readonly Entity[];
    readonly left?: readonly Entity[];
    /**
     * Entities whose replicated components changed SHAPE this sample. A provider
     * caching a per-entity fact re-reads these: an entity that lost the component
     * the fact came from is not something that component's value feed reports.
     *
     * @experimental
     */
    readonly rechecked?: readonly Entity[];
}

/** What a prepared snapshot is asked about one connection. @experimental */
export interface InterestProviderQueryView {
    readonly connectionId: number;
    /** The entities this connection owns. The SERVER still forces them visible;
     *  this is here so a provider can place its view. */
    readonly owned: readonly Entity[];
}

/** One snapshot, queried by every connection evaluated against it. @experimental */
export interface PreparedInterest {
    query(view: InterestProviderQueryView): ReadonlySet<Entity> | 'all';
}

/**
 * Relevance as prepare-once, query-many. A {@link InterestPolicy} is handed the
 * population per connection, so what it reads it reads C times; a provider
 * prepares one snapshot and answers every connection from it.
 *
 * @experimental
 */
export interface InterestProvider {
    prepare(view: InterestProviderPrepareView): PreparedInterest;
    /** Release anything held across samples. A provider that rebuilds owns
     *  nothing; one that maintains an index between samples does. */
    dispose?(): void;
}

/** Where an entity is, for the distance a policy measures. `z` is optional so a
 *  flat game's reader can keep answering in two. */
export interface InterestPoint {
    x: number;
    y: number;
    z?: number;
}

export interface RadiusInterestOptions {
    /**
     * How to read an entity's position. Defaults to the `Transform` component's
     * world-space `position`. Return null for "this entity has no place" — such
     * entities are always relevant (they can't be culled by distance).
     */
    position?: (world: World, entity: Entity) => InterestPoint | null;
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
    return ({ connectionId, world, candidates, owned }) => {
        const anchors: InterestPoint[] = [];
        // The host's own index when it offers one: finding this connection's
        // entities by reading `owner` off every candidate is O(population) per
        // connection, and the answer is already known.
        for (const e of owned ?? candidates) {
            if (!owned) {
                const repl = world.tryGet(e, Replicated) as ReplicatedData | null;
                if (repl?.owner !== connectionId) continue;
            }
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
                // A sphere, not a column: two floors of a building are one place to
                // a radius that drops z, and every connection then streams both.
                const dx = p.x - a.x;
                const dy = p.y - a.y;
                const dz = (p.z ?? 0) - (a.z ?? 0);
                if (dx * dx + dy * dy + dz * dz <= r2) {
                    visible.add(e);
                    break;
                }
            }
        }
        return visible;
    };
}

/**
 * WORLD space, as the option documents: `position` is authoring input relative
 * to the parent, so two children of different parents sharing an offset would
 * otherwise occupy the same point. The server composes before it samples.
 */
function defaultPosition(world: World, entity: Entity): InterestPoint | null {
    const Transform = getComponent('Transform');
    if (!Transform || !world.has(entity, Transform)) return null;
    const t = world.tryGet(entity, Transform) as
        { worldPosition?: { x: number; y: number; z?: number } } | null;
    const p = t?.worldPosition;
    return p ? { x: p.x, y: p.y, z: p.z ?? 0 } : null;
}

/**
 * {@link radiusInterest} as a provider. With the canonical `Transform` reader the
 * grid is KEPT: membership from the server's enter/leave, movement from what the
 * composition says changed. A custom `position` rebuilds every sample, because
 * nothing can know when an arbitrary function would answer differently.
 *
 * @experimental
 * @see radiusInterest
 */
export function radiusInterestProvider(
    radius: number,
    options: RadiusInterestOptions = {},
): InterestProvider {
    const r2 = radius * radius;
    const custom = options.position;
    const positionOf = custom ?? defaultPosition;
    const cell = Math.max(radius, Number.EPSILON);
    const key = (x: number, y: number, z: number): string =>
        `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;

    /** The index, whether it is rebuilt every sample or carried between them. */
    const at = new Map<Entity, InterestPoint>();
    const placeless = new Set<Entity>();
    const cells = new Map<string, Entity[]>();
    /** Which bucket holds an entity, so it can be taken out of it in O(1). */
    const where = new Map<Entity, { key: string; idx: number }>();
    let seeded = false;
    /** Whether this core can report what a composition changed. Null until asked. */
    let reports: boolean | null = null;
    let heldWorld: World | null = null;

    function place(world: World, e: Entity): void {
        const p = positionOf(world, e);
        if (!p) { placeless.add(e); return; }
        at.set(e, p);
        const k = key(p.x, p.y, p.z ?? 0);
        let bucket = cells.get(k);
        if (!bucket) { bucket = []; cells.set(k, bucket); }
        where.set(e, { key: k, idx: bucket.length });
        bucket.push(e);
    }

    /** Swap with the last and pop, fixing the moved entity's index. */
    function displace(e: Entity): void {
        const slot = where.get(e);
        at.delete(e);
        if (!slot) { placeless.delete(e); return; }
        const bucket = cells.get(slot.key)!;
        const last = bucket[bucket.length - 1]!;
        bucket[slot.idx] = last;
        where.get(last)!.idx = slot.idx;
        bucket.pop();
        if (bucket.length === 0) cells.delete(slot.key);
        where.delete(e);
    }

    /** Read an entity's place again, and move it if the cell changed. */
    function refresh(world: World, e: Entity): void {
        const p = positionOf(world, e);
        const slot = where.get(e);
        if (!p) {
            if (slot || at.has(e)) displace(e);
            placeless.add(e);
            return;
        }
        placeless.delete(e);
        const k = key(p.x, p.y, p.z ?? 0);
        if (slot && slot.key === k) { at.set(e, p); return; }
        displace(e);
        at.set(e, p);
        let bucket = cells.get(k);
        if (!bucket) { bucket = []; cells.set(k, bucket); }
        where.set(e, { key: k, idx: bucket.length });
        bucket.push(e);
    }

    function clear(): void {
        at.clear();
        placeless.clear();
        cells.clear();
        where.clear();
    }

    function seed(world: World, entities: Iterable<Entity>): void {
        clear();
        for (const e of entities) place(world, e);
        seeded = true;
    }

    /**
     * Everything the index knows, brought up to date from the two deltas. Answers
     * false when it could not — the caller seeds instead.
     */
    function update(view: InterestProviderPrepareView): boolean {
        const { world, entered, left, rechecked } = view;
        if (!seeded || !entered || !left) return false;
        const delta = world.compositionChanges();
        if (!delta || delta.overflowed) return false;

        for (const e of left) displace(e);
        for (const e of entered) { placeless.delete(e); displace(e); place(world, e); }
        // Duplicates cost a second read and nothing else; ids for entities this
        // index has never heard of are other people's transforms.
        for (let i = 0; i < delta.changed.length; i++) {
            const e = delta.changed[i] as Entity;
            if (at.has(e) || placeless.has(e)) refresh(world, e);
        }
        for (const e of rechecked ?? []) {
            if (at.has(e) || placeless.has(e)) refresh(world, e);
        }
        world.takeCompositionChanges();
        return true;
    }

    const prepared: PreparedInterest = {
        query({ owned }) {
            const anchors: InterestPoint[] = [];
            for (const e of owned) {
                const p = at.get(e);
                if (p) anchors.push(p);
            }
            // No place to look from: the same fail-open the policy has.
            if (anchors.length === 0) return 'all';

            const visible = new Set<Entity>(placeless);
            for (const a of anchors) {
                const cx = Math.floor(a.x / cell);
                const cy = Math.floor(a.y / cell);
                const cz = Math.floor((a.z ?? 0) / cell);
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
                            if (!bucket) continue;
                            for (const e of bucket) {
                                if (visible.has(e)) continue;
                                const p = at.get(e)!;
                                // A cell is a box and the rule is a sphere: being
                                // in the neighbourhood is not being in range.
                                const ddx = p.x - a.x;
                                const ddy = p.y - a.y;
                                const ddz = (p.z ?? 0) - (a.z ?? 0);
                                if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) visible.add(e);
                            }
                        }
                    }
                }
            }
            return visible;
        },
    };

    return {
        prepare(view): PreparedInterest {
            const { world, entities } = view;
            // An arbitrary reader has no invalidation the server can know about,
            // so it is rebuilt every sample and nothing is carried.
            if (custom) { seed(world, entities); return prepared; }

            if (world !== heldWorld) { heldWorld = world; seeded = false; reports = null; }
            if (reports === null) reports = world.setTransformChangeTracking(true);
            if (!reports) { seed(world, entities); return prepared; }

            if (!update(view)) {
                seed(world, entities);
                // Acknowledged whatever was pending: it has just been read the
                // long way, and leaving it would be applied again on top.
                world.takeCompositionChanges();
            }
            return prepared;
        },
        dispose() {
            clear();
            seeded = false;
            if (reports && heldWorld) heldWorld.setTransformChangeTracking(false);
            reports = null;
            heldWorld = null;
        },
    };
}
