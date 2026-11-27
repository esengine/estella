// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
* @file    query.ts
* @brief   Component query system with mutable component support
*/
import type { Entity } from '../types';
import { type AnyComponentDef, type ComponentData, isBuiltinComponent } from './component';
import type { World, QueryFilter } from './world';
import { computeQueryCacheKey, queryDepIds } from './world';

const NO_CHANGE_CANDIDATES: readonly Entity[] = [];

// =============================================================================
// Mutable Component Wrapper
// =============================================================================

/**
 * A query argument asking for write access, as {@link Mut} returns it. Opaque —
 * the query yields the component's data, not this.
 *
 * @public
 */
export interface MutWrapper<T extends AnyComponentDef> {
    /** @internal */
    readonly _type: 'mut';
    /** @internal */
    readonly _component: T;
}

/**
 * Ask a {@link Query} for write access to `component`.
 *
 * An unwrapped engine component is yielded as a copy, so assigning to it changes
 * nothing. Wrapped, the yielded data is written back to the world as iteration
 * leaves the entity, and the component is marked changed for `Changed()`.
 *
 * @public
 */
export function Mut<T extends AnyComponentDef>(component: T): MutWrapper<T> {
    return { _type: 'mut', _component: component };
}

export function isMutWrapper(value: unknown): value is MutWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_type' in value && value._type === 'mut';
}

// =============================================================================
// Change Detection Wrappers
// =============================================================================

/**
 * A query argument matching only entities that gained the component since this
 * system last ran, as {@link Added} returns it. Opaque — the query still yields
 * the component's data.
 *
 * @public
 */
export interface AddedWrapper<T extends AnyComponentDef> {
    /** @internal */
    readonly _filterType: 'added';
    /** @internal */
    readonly _component: T;
}

/**
 * A query argument matching only entities whose component was written since
 * this system last ran, as {@link Changed} returns it. A write is what
 * {@link Mut} records, so an unwrapped read never marks one.
 *
 * @public
 */
export interface ChangedWrapper<T extends AnyComponentDef> {
    /** @internal */
    readonly _filterType: 'changed';
    /** @internal */
    readonly _component: T;
}

export function Added<T extends AnyComponentDef>(component: T): AddedWrapper<T> {
    return { _filterType: 'added', _component: component };
}

export function Changed<T extends AnyComponentDef>(component: T): ChangedWrapper<T> {
    return { _filterType: 'changed', _component: component };
}

export function isAddedWrapper(value: unknown): value is AddedWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_filterType' in value && value._filterType === 'added';
}

export function isChangedWrapper(value: unknown): value is ChangedWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_filterType' in value && value._filterType === 'changed';
}

/**
 * Every value accepted as a positional `Query(...)` argument: a bare component,
 * or a component wrapped for mutation / change detection. Exported so `system.ts`
 * can constrain `SystemParam` against the exact same set — the two must never drift.
 */
/**
 * Anything {@link Query} accepts: a component for read access, or one wrapped in
 * {@link Mut} to write, `Added()` to match only entities that just gained it, or
 * `Changed()` to match only those whose copy was written since the last run.
 *
 * @public
 */
export type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef> | AddedWrapper<AnyComponentDef> | ChangedWrapper<AnyComponentDef>;

// =============================================================================
// Filter Expression Tree
// =============================================================================
// Composable filter predicates. `With`/`Without` remain as flat shortcuts on
// the QueryBuilder for the common case (AND of positive/negative predicates);
// `filter(expr)` accepts arbitrary combinations of And/Or/Not for cases the
// flat API can't express, e.g. `Or(With(A), Without(B))`.

/**
 * A composable match expression for {@link QueryBuilder.filter}, built with
 * `With`/`Without`/`And`/`Or`/`Not`. A readable data shape on purpose: an
 * editor or a tool can inspect one without running the query.
 *
 * @public
 */
export type FilterExpr =
    | { readonly kind: 'with'; readonly component: AnyComponentDef }
    | { readonly kind: 'without'; readonly component: AnyComponentDef }
    | { readonly kind: 'and'; readonly filters: readonly FilterExpr[] }
    | { readonly kind: 'or'; readonly filters: readonly FilterExpr[] }
    | { readonly kind: 'not'; readonly filter: FilterExpr };

export function With(component: AnyComponentDef): FilterExpr {
    return { kind: 'with', component };
}
export function Without(component: AnyComponentDef): FilterExpr {
    return { kind: 'without', component };
}
export function And(...filters: FilterExpr[]): FilterExpr {
    return { kind: 'and', filters };
}
export function Or(...filters: FilterExpr[]): FilterExpr {
    return { kind: 'or', filters };
}
export function Not(filter: FilterExpr): FilterExpr {
    return { kind: 'not', filter };
}

/** Collect every component referenced by a filter expression (for cache-dep tracking). */
function collectFilterComponents(expr: FilterExpr, out: AnyComponentDef[]): void {
    switch (expr.kind) {
        case 'with':
        case 'without':
            out.push(expr.component);
            return;
        case 'and':
        case 'or':
            for (const f of expr.filters) collectFilterComponents(f, out);
            return;
        case 'not':
            collectFilterComponents(expr.filter, out);
            return;
    }
}

/**
 * Serialize a filter expression deterministically for cache keys. Uses
 * component `_name` (unique within a registry) so no cross-module numeric
 * ID table is required.
 */
function serializeFilter(expr: FilterExpr): string {
    switch (expr.kind) {
        case 'with': return `+${expr.component._name}`;
        case 'without': return `-${expr.component._name}`;
        case 'not': return `!(${serializeFilter(expr.filter)})`;
        case 'and': {
            const parts = expr.filters.map(serializeFilter);
            parts.sort();
            return `&(${parts.join(',')})`;
        }
        case 'or': {
            const parts = expr.filters.map(serializeFilter);
            parts.sort();
            return `|(${parts.join(',')})`;
        }
    }
}

/** Compile a filter expression into a reusable entity-predicate closure. */
function compileFilter(expr: FilterExpr, world: World): (entity: Entity) => boolean {
    switch (expr.kind) {
        case 'with': {
            const comp = expr.component;
            return (e) => world.has(e, comp);
        }
        case 'without': {
            const comp = expr.component;
            return (e) => !world.has(e, comp);
        }
        case 'not': {
            const inner = compileFilter(expr.filter, world);
            return (e) => !inner(e);
        }
        case 'and': {
            const subs = expr.filters.map(f => compileFilter(f, world));
            return (e) => {
                for (const s of subs) if (!s(e)) return false;
                return true;
            };
        }
        case 'or': {
            const subs = expr.filters.map(f => compileFilter(f, world));
            return (e) => {
                for (const s of subs) if (s(e)) return true;
                return false;
            };
        }
    }
}

// =============================================================================
// Query Descriptor
// =============================================================================

/**
 * A settled query request in a system's parameter list. Opaque — the system body
 * receives a `QueryInstance` to iterate.
 *
 * @public
 */
export interface QueryDescriptor<C extends readonly QueryArg[]> {
    /** @internal */
    readonly _type: 'query';
    /** @internal */
    readonly _components: C;
    /** @internal */
    readonly _mutIndices: number[];
    /** @internal */
    readonly _with: AnyComponentDef[];
    /** @internal */
    readonly _without: AnyComponentDef[];
    /** @internal */
    readonly _addedFilters: Array<{ index: number; component: AnyComponentDef }>;
    /** @internal */
    readonly _changedFilters: Array<{ index: number; component: AnyComponentDef }>;
    /** @internal */
    readonly _filter: FilterExpr | null;
}

/**
 * A {@link Query} before it is handed to a system, narrowable by components the
 * match must or must not have. Each call returns a NEW builder, so narrowing a
 * shared query does not disturb it, and any of them is a valid parameter.
 *
 * @public
 */
export interface QueryBuilder<C extends readonly QueryArg[]> extends QueryDescriptor<C> {
    /** Match only entities that also carry all of these; their data is not yielded. */
    with(...components: AnyComponentDef[]): QueryBuilder<C>;
    /** Exclude entities carrying any of these. */
    without(...components: AnyComponentDef[]): QueryBuilder<C>;
    /** Attach a composable filter expression. Replaces any prior call. */
    filter(expr: FilterExpr): QueryBuilder<C>;
}

function unwrapComponent(comp: QueryArg): AnyComponentDef {
    if (isMutWrapper(comp)) return comp._component;
    if (isAddedWrapper(comp)) return comp._component;
    if (isChangedWrapper(comp)) return comp._component;
    return comp;
}

function createQueryDescriptor<C extends readonly QueryArg[]>(
    components: C,
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = [],
    filter: FilterExpr | null = null,
): QueryBuilder<C> {
    const mutIndices: number[] = [];
    const addedFilters: Array<{ index: number; component: AnyComponentDef }> = [];
    const changedFilters: Array<{ index: number; component: AnyComponentDef }> = [];

    components.forEach((comp, i) => {
        if (isMutWrapper(comp)) {
            mutIndices.push(i);
        }
        if (isAddedWrapper(comp)) {
            addedFilters.push({ index: i, component: comp._component });
        } else if (isChangedWrapper(comp)) {
            changedFilters.push({ index: i, component: comp._component });
        }
    });

    return {
        _type: 'query',
        _components: components,
        _mutIndices: mutIndices,
        _with: withFilters,
        _without: withoutFilters,
        _addedFilters: addedFilters,
        _changedFilters: changedFilters,
        _filter: filter,
        with(...extraWith: AnyComponentDef[]) {
            return createQueryDescriptor(components, [...withFilters, ...extraWith], withoutFilters, filter);
        },
        without(...extraWithout: AnyComponentDef[]) {
            return createQueryDescriptor(components, withFilters, [...withoutFilters, ...extraWithout], filter);
        },
        filter(expr: FilterExpr) {
            return createQueryDescriptor(components, withFilters, withoutFilters, expr);
        },
    };
}


// =============================================================================
// Query Factory
// =============================================================================

/**
 * Match the entities carrying every one of `components`, yielding the entity
 * followed by each component's data in the order asked for.
 *
 * Read-only unless an argument is wrapped in {@link Mut}; narrow further with
 * the builder's `with`/`without`, or per-component with `Added()`/`Changed()`.
 *
 * @public
 */
export function Query<C extends QueryArg[]>(...components: C): QueryBuilder<C> {
    return createQueryDescriptor(components);
}

// =============================================================================
// Query Result Type
// =============================================================================

/**
 * The component a {@link QueryArg} asks for, with any wrapper taken off — `Mut(X)`,
 * `Added(X)` and `Changed(X)` all read as `X`, because a wrapper says how the
 * component is accessed and not which one it is.
 *
 * @public
 */
export type UnwrapQueryArg<T> =
    T extends MutWrapper<infer C> ? C :
    T extends AddedWrapper<infer C> ? C :
    T extends ChangedWrapper<infer C> ? C :
    T;

/**
 * The data tuple a query's arguments resolve to, in the order they were asked
 * for. Computed, never supplied — but {@link QueryResult} is spelled with it, so
 * it carries a name a reader can look up.
 *
 * @public
 */
export type ComponentsData<C extends readonly QueryArg[]> = {
    [K in keyof C]: ComponentData<UnwrapQueryArg<C[K]>>;
};

/**
 * One step of a {@link QueryInstance}: the entity, then each requested
 * component's data in the order it was asked for. A tuple, so destructuring it
 * in a `for…of` is typed without annotation.
 *
 * @public
 */
export type QueryResult<C extends readonly QueryArg[]> = [
    Entity,
    ...ComponentsData<C>
];

// =============================================================================
// Query Instance (Runtime)
// =============================================================================

/** What a system's queries walked in a frame, and what they then discarded. */
export interface QueryCost {
    /** Times the system asked a query for its entities. */
    calls: number;
    /** Entities those calls walked, summed. */
    scanned: number;
    /** Of those, entities an Added/Changed filter rejected. */
    filtered: number;
}

interface MutableSlot {
    readonly index: number;
    readonly component: AnyComponentDef;
    readonly builtin: boolean;
    readonly setter: ((entity: Entity, data: unknown) => void) | null;
}

/**
 * A live query, as a system body receives it. Iterate it — each step yields the
 * entity followed by its components — or use `forEach`, `single`, `toArray`,
 * `count` and `isEmpty`. Any {@link Mut} argument is written back and marked
 * changed as iteration leaves each entity, so leaving the loop early is safe.
 *
 * @public
 */
export class QueryInstance<C extends readonly QueryArg[]> implements Iterable<QueryResult<C>> {
    private readonly world_: World;
    private readonly lifetime_: symbol;
    private readonly descriptor_: QueryDescriptor<C>;
    private readonly actualComponents_: AnyComponentDef[];
    private readonly allRequired_: AnyComponentDef[];
    private readonly result_: unknown[];
    private lending_ = false;
    private iterationEpoch_ = 0;
    private openIterations_ = 0;
    private readonly mutations_: MutableSlot[];
    /**
     * Mut rows the iterator handed out and the caller may still be holding:
     * the very row it was given, in write-back order. Written once more when
     * the system returns — see {@link settleKeptRows}.
     */
    private readonly kept_: unknown[][] = [];
    private readonly cacheKey_: string;
    // Static cache-dependency ids (required + with + without + filter deps),
    // precomputed like cacheKey_ so per-call query iteration allocates no array.
    private readonly depIds_: symbol[];
    private lastRunTick_: number;
    private lastChangeSequence_: number | null = null;
    private sequenceMatchers_: Array<(entity: Entity, after: number) => boolean> | null = null;
    private calls_ = 0;
    private scanned_ = 0;
    private filtered_ = 0;
    private readonly getters_: Array<((entity: Entity) => unknown) | null>;
    private readonly gettersRetained_: Array<((entity: Entity) => unknown) | null>;
    private readonly compiledFilter_: QueryFilter | null;

    constructor(world: World, descriptor: QueryDescriptor<C>, lastRunTick = -1) {
        this.world_ = world;
        this.lifetime_ = world.entityLifetime;
        this.descriptor_ = descriptor;
        this.lastRunTick_ = lastRunTick;
        this.actualComponents_ = descriptor._components.map(unwrapComponent);
        this.allRequired_ = this.actualComponents_.concat(descriptor._with);
        this.result_ = new Array(this.actualComponents_.length + 1);
        if (descriptor._filter) {
            const deps: AnyComponentDef[] = [];
            collectFilterComponents(descriptor._filter, deps);
            this.compiledFilter_ = { match: compileFilter(descriptor._filter, world), deps };
        } else {
            this.compiledFilter_ = null;
        }
        this.cacheKey_ = computeQueryCacheKey(
            this.allRequired_,
            descriptor._with,
            descriptor._without,
            descriptor._filter ? serializeFilter(descriptor._filter) : undefined,
        );
        // Same set the cache validity check reads; order is irrelevant (it maps
        // each id to its version). Must match what getEntitiesWithComponents would
        // otherwise build per call.
        this.depIds_ = queryDepIds(
            this.allRequired_, descriptor._with, descriptor._without,
            this.compiledFilter_?.deps ?? [], 'membership',
        );
        this.getters_ = this.actualComponents_.map((comp, i) => world.resolveGetter(comp, 'borrowed', descriptor._mutIndices.includes(i)));
        this.gettersRetained_ = this.actualComponents_.map((comp, i) => world.resolveGetter(comp, 'retained', descriptor._mutIndices.includes(i)));
        this.mutations_ = descriptor._mutIndices.map(index => {
            const component = this.actualComponents_[index];
            const builtin = isBuiltinComponent(component);
            return { index: index + 1, component, builtin, setter: builtin ? world.resolveSetter(component) : null };
        });
        for (const f of descriptor._addedFilters) {
            world.enableChangeTracking(f.component);
        }
        for (const f of descriptor._changedFilters) {
            world.enableChangeTracking(f.component);
        }
    }

    /** @internal Update lastRunTick for reuse across system runs */
    resetTick(tick: number): void {
        this.lastRunTick_ = tick;
    }

    /** @internal System-owned queries use completed runs, not coarse frame ticks. */
    resetChangeSequence(sequence: number): void {
        if (!this.hasChangeFilters_()) return;
        if (this.lastChangeSequence_ === null) {
            this.sequenceMatchers_ = [];
            for (const f of this.descriptor_._addedFilters) {
                this.sequenceMatchers_.push(this.world_.resolveChangeSequenceMatcher(f.component, true));
            }
            for (const f of this.descriptor_._changedFilters) {
                this.sequenceMatchers_.push(this.world_.resolveChangeSequenceMatcher(f.component, false));
            }
        }
        this.lastChangeSequence_ = sequence;
    }

    /**
     * Every result reader uses this candidate set. A closed change window is
     * empty in O(1); otherwise the structural query cache supplies the entities
     * before their individual change filters are applied.
     */
    private candidates_(): readonly Entity[] {
        if (!this.current_()) return NO_CHANGE_CANDIDATES;
        if (this.lastChangeSequence_ !== null) {
            const after = this.lastChangeSequence_;
            let unchanged = false;
            for (const f of this.descriptor_._addedFilters) {
                if (!this.world_.anyAddedAfterSequence(f.component, after)) { unchanged = true; break; }
            }
            if (!unchanged) for (const f of this.descriptor_._changedFilters) {
                if (!this.world_.anyChangedAfterSequence(f.component, after)) { unchanged = true; break; }
            }
            if (unchanged) {
                if (this.world_.queryCostEnabled) this.calls_++;
                return NO_CHANGE_CANDIDATES;
            }
        }
        const entities = this.world_.queryEntities(
            this.allRequired_,
            this.descriptor_._with,
            this.descriptor_._without,
            this.cacheKey_,
            this.compiledFilter_ ?? undefined,
            this.depIds_,
        );
        if (this.world_.queryCostEnabled) {
            this.calls_++;
            this.scanned_ += entities.length;
        }
        return entities;
    }

    /**
     * @internal What this query cost since the last read: how many times it was
     * asked, how many entities that walked, and how many of those a change filter
     * then threw away. Reset by the read, so a frame's figure is that frame's.
     */
    takeCost(): QueryCost {
        const cost = { calls: this.calls_, scanned: this.scanned_, filtered: this.filtered_ };
        this.calls_ = 0;
        this.scanned_ = 0;
        this.filtered_ = 0;
        return cost;
    }

    private hasChangeFilters_(): boolean {
        return this.descriptor_._addedFilters.length > 0 || this.descriptor_._changedFilters.length > 0;
    }

    private passesChangeFilters_(entity: Entity): boolean {
        const { _addedFilters, _changedFilters } = this.descriptor_;
        if (_addedFilters.length === 0 && _changedFilters.length === 0) return true;
        const tick = this.lastRunTick_;
        const sequence = this.lastChangeSequence_;
        if (sequence !== null) {
            for (const matches of this.sequenceMatchers_!) {
                if (!matches(entity, sequence)) return this.rejected_();
            }
            return true;
        }
        for (const f of _addedFilters) {
            const added = this.world_.isAddedSince(entity, f.component, tick);
            if (!added) return this.rejected_();
        }
        for (const f of _changedFilters) {
            const changed = this.world_.isChangedSince(entity, f.component, tick);
            if (!changed) return this.rejected_();
        }
        return true;
    }

    private rejected_(): false {
        if (this.world_.queryCostEnabled) this.filtered_++;
        return false;
    }

    /**
     * Write buffered Mut() data back to storage for one entity and record a
     * Changed tick for each mutated component. This is the single write-back path
     * shared by the iterator and forEach — keeping the three former copies from
     * drifting apart.
     *
     * Builtin (wasm-backed) components write through a direct ptr / embind setter
     * that pokes component storage without going through world.set(), so the
     * change must be recorded here explicitly to keep Changed()/Added() detection
     * consistent with script components and with world.set(). recordChanged()
     * self-gates on whether any query is actually tracking the component, so on
     * the hot path with nothing listening this is a Set.has() + return.
     */
    private writeMutBack_(entity: Entity, row: readonly unknown[]): void {
        const world = this.world_;
        if (!world.valid(entity)) return;
        for (let i = 0; i < this.mutations_.length; i++) {
            if (i > 0 && !this.current_()) return;
            const slot = this.mutations_[i];
            if (slot.builtin) {
                const data = row[slot.index];
                if (!slot.setter) {
                    world.set(entity, slot.component, data as Record<string, unknown>);
                    continue;
                }
                slot.setter(entity, data);
                if (!this.current_()) return;
            }
            world.markChanged(entity, slot.component);
        }
    }

    private current_(): boolean { return this.lifetime_ === this.world_.entityLifetime; }

    private beginIteration_(): number {
        this.world_.beginIteration();
        this.openIterations_++;
        return this.iterationEpoch_;
    }

    private endIteration_(epoch: number): void {
        if (epoch !== this.iterationEpoch_ || !this.current_()) return;
        this.openIterations_--;
        this.world_.endIteration();
    }

    /** @internal Detach this invocation's outstanding walks when it parks or finishes. */
    takeIterationDepth(): number {
        const depth = this.openIterations_;
        if (depth) {
            this.iterationEpoch_++;
            this.openIterations_ = 0;
        }
        return depth;
    }

    private readRow_(entity: Entity, row: unknown[], getters: typeof this.getters_): boolean {
        row[0] = entity;
        for (let i = 0; i < getters.length; i++) {
            const getter = getters[i];
            row[i + 1] = getter ? getter(entity) : this.world_.get(entity, this.actualComponents_[i]);
            if (!this.current_()) return false;
        }
        return true;
    }

    /**
     * @internal Write the Mut rows this query's iterator handed out once more,
     * now that the system has returned. Called by the runner, before the
     * system's Commands flush.
     *
     * The iterator's rows are the ones a caller may KEEP, and keeping them is
     * how a system edits after the loop: collect, sort, then change the nearest.
     * A script component's row is its stored object, so that edit already landed;
     * an engine-backed one (Transform, Sprite) is a copy written back as the loop
     * advanced, and an edit made after that was silently dropped. Until the
     * system returns a kept row stays live. The lent rows of {@link forEach} are
     * not tracked and cost nothing here.
     */
    settleKeptRows(): void {
        const kept = this.kept_;
        if (kept.length === 0) return;
        try {
            for (const row of kept) {
                if (!this.current_()) break;
                this.writeMutBack_(row[0] as Entity, row);
            }
        } finally {
            kept.length = 0;
        }
    }

    /**
     * Rows the caller may keep: a fresh array per entity, and for an
     * engine-backed component a fresh value rather than the shared fill target.
     * {@link forEach} lends its row instead and is cheaper for a body that only
     * reads it once.
     */
    [Symbol.iterator](): Iterator<QueryResult<C>> {
        const entities = this.candidates_();
        const compCount = this.actualComponents_.length;
        const mutations = this.mutations_;
        const hasMut = mutations.length > 0;
        const hasChangeFilters = this.hasChangeFilters_();
        const getters = this.gettersRetained_;
        const self = this;
        const kept = this.kept_;

        let idx = 0;
        let previous: unknown[] | null = null;
        let iteration: number | undefined;
        let done = false;

        // Takes the pending entity rather than reading it, so a write-back is
        // attempted exactly once. A failing one has still been tried, and finalize
        // must not retry it on the way out under the error it raised.
        const writeMut = () => {
            const row = previous!;
            previous = null;
            // An inner iterator can finish before the outer row it visited. Replay in that same order.
            if (kept[kept.length - 1] !== row) {
                const index = kept.indexOf(row);
                if (index >= 0) { kept.splice(index, 1); kept.push(row); }
            }
            self.writeMutBack_(row[0] as Entity, row);
        };

        // endIteration first, so the depth balances even if the write-back throws.
        const finalize = (errorInFlight = false) => {
            if (done) return;
            done = true;
            if (iteration === undefined || !self.current_()) return;
            self.endIteration_(iteration);
            if (!previous) return;
            if (!errorInFlight) {
                writeMut();
                return;
            }
            try { writeMut(); } catch { /* the original error wins */ }
        };

        const iterResult: IteratorResult<QueryResult<C>> = { value: undefined as unknown as QueryResult<C>, done: false };
        const doneResult: IteratorResult<QueryResult<C>> = { value: undefined as unknown as QueryResult<C>, done: true };

        return {
            next(): IteratorResult<QueryResult<C>> {
                if (done || !self.current_()) { finalize(); return doneResult; }
                if (iteration === undefined) iteration = self.beginIteration_();

                // for..of closes the iterator when its BODY throws, but nothing
                // closes it when next() itself does — a getter over broken storage
                // would leave the world iterating for good.
                try {
                    while (idx < entities.length) {
                        const entity = entities[idx++];

                        if (hasChangeFilters && !self.passesChangeFilters_(entity)) {
                            continue;
                        }

                        if (previous) {
                            writeMut();
                            if (!self.current_()) break;
                        }

                        const row: unknown[] = new Array(compCount + 1);
                        if (!self.readRow_(entity, row, getters)) break;

                        if (hasMut) {
                            kept.push(row);
                            previous = row;
                        }

                        iterResult.value = row as QueryResult<C>;
                        return iterResult;
                    }
                } catch (e) {
                    finalize(true);
                    throw e;
                }

                finalize();
                return doneResult;
            },
            return(): IteratorResult<QueryResult<C>> {
                finalize();
                return doneResult;
            },
        };
    }

    /**
     * Run `callback` per matching entity, LENDING it the row: the values are
     * refilled for the next entity, so anything kept past the callback must be
     * copied. The fast path — iterating instead costs an allocation per row
     * (1.2x for script components, 1.7x for engine-backed ones).
     */
    forEach(callback: (entity: Entity, ...components: ComponentsData<C>) => void): void {
        const entities = this.candidates_();
        if (entities.length === 0) return;
        const compCount = this.actualComponents_.length;
        const hasMut = this.mutations_.length > 0;
        const hasChangeFilters = this.hasChangeFilters_();
        // A nested walk cannot refill the values its caller is still borrowing.
        const nested = this.lending_;
        const result = nested ? new Array(compCount + 1) : this.result_;
        const getters = nested ? this.gettersRetained_ : this.getters_;

        const iteration = this.beginIteration_();
        this.lending_ = true;
        // Non-null means one entity's Mut edits are still owed a write-back and
        // none has been attempted. flushMut takes it, so a failing write-back is
        // not tried a second time by the finally below.
        let prevEntity: Entity | null = null;
        const flushMut = (): void => {
            const entity = prevEntity!;
            prevEntity = null;
            this.writeMutBack_(entity, result);
        };
        try {
            for (let idx = 0; idx < entities.length; idx++) {
                const entity = entities[idx];
                if (hasChangeFilters && !this.passesChangeFilters_(entity)) continue;

                if (prevEntity !== null && hasMut) {
                    flushMut();
                    if (!this.current_()) return;
                }
                if (!this.readRow_(entity, result, getters)) return;
                if (hasMut) prevEntity = entity;

                // Fast path for 1–6 components (covers the vast majority of queries); 7+ falls back to .apply.
                switch (compCount) {
                    case 1: (callback as any)(entity, result[1]); break;
                    case 2: (callback as any)(entity, result[1], result[2]); break;
                    case 3: (callback as any)(entity, result[1], result[2], result[3]); break;
                    case 4: (callback as any)(entity, result[1], result[2], result[3], result[4]); break;
                    case 5: (callback as any)(entity, result[1], result[2], result[3], result[4], result[5]); break;
                    case 6: (callback as any)(entity, result[1], result[2], result[3], result[4], result[5], result[6]); break;
                    default: (callback as Function).apply(null, result); break;
                }
                if (!this.current_()) return;
            }

            if (prevEntity !== null && hasMut) flushMut();
        } finally {
            this.lending_ = nested;
            if (prevEntity !== null && hasMut && this.current_()) {
                // The callback threw partway. Edits it already finished still go
                // back, but a failure writing them must not replace the error on
                // its way out — that error is the one worth reading.
                try { flushMut(); } catch { /* the original error wins */ }
            }
            this.endIteration_(iteration);
        }
    }

    /**
     * The one result, or null. Copied off the iterator's shared row buffer, which
     * the next iteration overwrites — a caller that holds this would otherwise
     * watch it change under them.
     */
    /** The one row, or null. The iterator's rows are already the caller's to keep. */
    single(): QueryResult<C> | null {
        for (const result of this) return result;
        return null;
    }

    /**
     * Whether iterating would yield nothing. Asks the entity set rather than
     * running the iterator: taking one step of a Mut() query writes that entity
     * back and records a Changed tick for it, and asking whether a query is empty
     * must not mark anything as having changed.
     */
    isEmpty(): boolean {
        const entities = this.candidates_();
        if (!this.hasChangeFilters_()) return entities.length === 0;
        for (const entity of entities) {
            if (this.passesChangeFilters_(entity)) return false;
        }
        return true;
    }

    /**
     * How many results iterating would yield. Added()/Changed() are per-entity
     * tick checks rather than part of the entity set the cache returns, so
     * counting has to apply them too — the same pass the iterator makes.
     */
    count(): number {
        const entities = this.candidates_();
        if (!this.hasChangeFilters_()) return entities.length;

        let n = 0;
        for (const entity of entities) {
            if (this.passesChangeFilters_(entity)) n++;
        }
        return n;
    }

    toArray(): QueryResult<C>[] {
        const arr: QueryResult<C>[] = [];
        for (const row of this) arr.push(row);
        return arr;
    }
}

// =============================================================================
// Removed Query
// =============================================================================

/**
 * A request to iterate the entities that LOST a component since this system
 * last ran, as {@link Removed} returns it. Opaque — the body receives an
 * instance yielding entities, since the component itself is already gone.
 *
 * @public
 */
export interface RemovedQueryDescriptor<T extends AnyComponentDef> {
    /** @internal */
    readonly _type: 'removed';
    /** @internal */
    readonly _component: T;
}

export function Removed<T extends AnyComponentDef>(component: T): RemovedQueryDescriptor<T> {
    return { _type: 'removed', _component: component };
}

/**
 * The entities that lost a component since this system last ran, as
 * {@link Removed} asked for. Yields entities only — the component is gone, so
 * there is nothing left to read from it.
 *
 * @public
 */
export class RemovedQueryInstance<T extends AnyComponentDef> implements Iterable<Entity> {
    private readonly world_: World;
    private readonly component_: T;
    private readonly lifetime_: symbol;
    private lastRunTick_: number;
    private readerId_: number | null = null;
    private readThrough_ = 0;
    private after_ = 0;
    private acknowledged_ = 0;
    private running_ = false;
    private owner_?: RemovedQueryInstance<T>;
    private overlaps_?: Set<RemovedQueryInstance<T>>;
    private disconnect_?: () => void;

    /** Constructing one has NO side effect on the world: a runner that builds
     *  several params and throws on a later one would otherwise leave a claim
     *  on removal history that nothing can ever release. */
    constructor(world: World, component: T, lastRunTick: number) {
        this.world_ = world;
        this.component_ = component;
        this.lifetime_ = world.entityLifetime;
        this.lastRunTick_ = lastRunTick;
    }

    /** @internal Claim the history, once the whole parameter set is committed. */
    activateRetention(): void {
        if (this.readerId_ !== null || this.lifetime_ !== this.world_.entityLifetime) return;
        this.world_.enableChangeTracking(this.component_);
        this.readerId_ = this.world_.registerRemovedCursorReader(this.component_);
        this.after_ = this.acknowledged_ = this.readThrough_ = this.world_.getRemovalSequence();
        this.disconnect_ = this.world_.onCoreDisconnect(() => this.dispose());
    }

    /** @internal Each run reads from the last completed window and owns its own acknowledgement. */
    forRun(tick: number): RemovedQueryInstance<T> {
        let run: RemovedQueryInstance<T> = this;
        if (this.running_) {
            run = new RemovedQueryInstance(this.world_, this.component_, tick);
            run.owner_ = this;
            (this.overlaps_ ??= new Set()).add(run);
        }
        run.resetTick(tick);
        run.after_ = this.acknowledged_;
        run.running_ = true;
        return run;
    }

    /**
     * @internal This run is over, so release the sequence it observed. A later
     * removal in the same frame is still owed. NOT `resetTick`: a system may
     * await mid-body, and an early release would let another reader's prune
     * take rows this one is still owed.
     */
    releaseThrough(_lastRunTick: number): void {
        const owner = this.owner_ ?? this;
        if (owner.readerId_ === null) return;
        this.running_ = false;
        owner.overlaps_?.delete(this);
        this.after_ = owner.acknowledged_ = Math.max(owner.acknowledged_, this.readThrough_);
        let through = owner.running_ ? owner.after_ : owner.acknowledged_;
        if (owner.overlaps_) for (const run of owner.overlaps_) through = Math.min(through, run.after_);
        this.world_.advanceRemovedCursorReader(this.component_, owner.readerId_, through);
    }

    /** @internal Give up the claim — the runner evicted or reset this system. */
    dispose(): void {
        if (this.readerId_ === null) return;
        this.disconnect_?.();
        this.disconnect_ = undefined;
        this.overlaps_?.clear();
        this.world_.disposeRemovedReader(this.component_, this.readerId_);
        this.readerId_ = null;
    }

    /** @internal Update lastRunTick for reuse across system runs */
    resetTick(tick: number): void {
        this.lastRunTick_ = tick;
        this.readThrough_ = this.world_.getRemovalSequence();
    }

    private read_(): Entity[] {
        if (this.lifetime_ !== this.world_.entityLifetime) return [];
        const reader = this.owner_ ?? this;
        if (reader.readerId_ === null) return this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_);
        this.readThrough_ = this.world_.getRemovalSequence();
        return this.world_.getRemovedEntitiesForReader(this.component_, reader.readerId_, this.after_);
    }

    *[Symbol.iterator](): Iterator<Entity> {
        for (const entity of this.read_()) {
            if (this.lifetime_ !== this.world_.entityLifetime) return;
            yield entity;
        }
    }

    isEmpty(): boolean {
        return this.read_().length === 0;
    }

    toArray(): Entity[] {
        return this.read_();
    }
}
