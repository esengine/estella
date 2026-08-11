// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */

import { Entity } from '../types';
import { AnyComponentDef, ComponentData, isBuiltinComponent } from './component';
import type { World, QueryFilter } from './world';
import { computeQueryCacheKey } from './world';

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

type UnwrapMut<T> = T extends MutWrapper<infer C> ? C : T;

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

type UnwrapQueryArg<T> =
    T extends MutWrapper<infer C> ? C :
    T extends AddedWrapper<infer C> ? C :
    T extends ChangedWrapper<infer C> ? C :
    T;
type ComponentsData<C extends readonly QueryArg[]> = {
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
    private readonly descriptor_: QueryDescriptor<C>;
    private readonly actualComponents_: AnyComponentDef[];
    private readonly allRequired_: AnyComponentDef[];
    private readonly result_: unknown[];
    private readonly mutData_: Array<{ component: AnyComponentDef; data: Record<string, unknown> }>;
    private readonly cacheKey_: string;
    // Static cache-dependency ids (required + with + without + filter deps),
    // precomputed like cacheKey_ so per-call query iteration allocates no array.
    private readonly depIds_: symbol[];
    private lastRunTick_: number;
    private readonly getters_: Array<((entity: Entity) => unknown) | null>;
    private readonly mutSetters_: Array<((entity: Entity, data: unknown) => void) | null>;
    private readonly mutIsBuiltin_: boolean[];
    private readonly compiledFilter_: QueryFilter | null;

    constructor(world: World, descriptor: QueryDescriptor<C>, lastRunTick = -1) {
        this.world_ = world;
        this.descriptor_ = descriptor;
        this.lastRunTick_ = lastRunTick;
        this.actualComponents_ = descriptor._components.map(unwrapComponent);
        this.allRequired_ = this.actualComponents_.concat(descriptor._with);
        this.result_ = new Array(this.actualComponents_.length + 1);
        this.mutData_ = descriptor._mutIndices.map(idx => ({
            component: this.actualComponents_[idx],
            data: null as unknown as Record<string, unknown>
        }));
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
        this.depIds_ = [
            ...this.allRequired_.map(c => c._id),
            ...descriptor._with.map(c => c._id),
            ...descriptor._without.map(c => c._id),
            ...(this.compiledFilter_?.deps.map(c => c._id) ?? []),
        ];
        this.getters_ = this.actualComponents_.map(comp => world.resolveGetter(comp));
        this.mutSetters_ = descriptor._mutIndices.map(idx =>
            world.resolveSetter(this.actualComponents_[idx])
        );
        this.mutIsBuiltin_ = descriptor._mutIndices.map(idx =>
            isBuiltinComponent(this.actualComponents_[idx])
        );
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

    /**
     * The entity set before change filters — what the query cache can answer on
     * its own. Every caller that asks "which entities match" goes through here,
     * so none of them can disagree about the cache key or the dep set.
     */
    private candidates_(): readonly Entity[] {
        return this.world_.getEntitiesWithComponents(
            this.allRequired_,
            this.descriptor_._with,
            this.descriptor_._without,
            this.cacheKey_,
            this.compiledFilter_ ?? undefined,
            this.depIds_,
        );
    }

    private hasChangeFilters_(): boolean {
        return this.descriptor_._addedFilters.length > 0 || this.descriptor_._changedFilters.length > 0;
    }

    private passesChangeFilters_(entity: Entity): boolean {
        const { _addedFilters, _changedFilters } = this.descriptor_;
        if (_addedFilters.length === 0 && _changedFilters.length === 0) return true;
        const tick = this.lastRunTick_;
        for (const f of _addedFilters) {
            if (!this.world_.isAddedSince(entity, f.component, tick)) return false;
        }
        for (const f of _changedFilters) {
            if (!this.world_.isChangedSince(entity, f.component, tick)) return false;
        }
        return true;
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
    private writeMutBack_(entity: Entity): void {
        const world = this.world_;
        if (!world.valid(entity)) return;
        const mutData = this.mutData_;
        const mutSetters = this.mutSetters_;
        const mutIsBuiltin = this.mutIsBuiltin_;
        for (let i = 0; i < mutData.length; i++) {
            const mut = mutData[i];
            if (mutIsBuiltin[i]) {
                const setter = mutSetters[i];
                if (setter) {
                    setter(entity, mut.data);
                    world.markChanged(entity, mut.component);
                } else {
                    world.set(entity, mut.component, mut.data);
                }
            } else {
                world.markChanged(entity, mut.component);
            }
        }
    }

    [Symbol.iterator](): Iterator<QueryResult<C>> {
        const { _mutIndices } = this.descriptor_;
        const actualComponents = this.actualComponents_;
        const entities = this.candidates_();
        const compCount = actualComponents.length;
        const hasMut = _mutIndices.length > 0;
        const hasChangeFilters = this.hasChangeFilters_();
        const result = this.result_;
        const mutData = this.mutData_;
        const mutCount = mutData.length;
        const world = this.world_;
        const getters = this.getters_;
        const self = this;

        let idx = 0;
        let prevEntity: Entity | null = null;
        let started = false;
        let done = false;

        // Takes the pending entity rather than reading it, so a write-back is
        // attempted exactly once. A failing one has still been tried, and finalize
        // must not retry it on the way out under the error it raised.
        const writeMut = () => {
            const entity = prevEntity!;
            prevEntity = null;
            self.writeMutBack_(entity);
        };

        // endIteration first, so the depth balances even if the write-back throws.
        const finalize = (errorInFlight = false) => {
            if (done) return;
            done = true;
            world.endIteration();
            if (prevEntity === null || !hasMut) return;
            if (!errorInFlight) {
                writeMut();
                return;
            }
            try { writeMut(); } catch { /* the original error wins */ }
        };

        const iterResult: IteratorResult<QueryResult<C>> = { value: result as QueryResult<C>, done: false };
        const doneResult: IteratorResult<QueryResult<C>> = { value: undefined as unknown as QueryResult<C>, done: true };

        return {
            next(): IteratorResult<QueryResult<C>> {
                if (!started) {
                    started = true;
                    world.beginIteration();
                }

                // for..of closes the iterator when its BODY throws, but nothing
                // closes it when next() itself does — a getter over broken storage
                // would leave the world iterating for good.
                try {
                    while (idx < entities.length) {
                        const entity = entities[idx++];

                        if (hasChangeFilters && !self.passesChangeFilters_(entity)) {
                            continue;
                        }

                        if (prevEntity !== null && hasMut) {
                            writeMut();
                        }

                        result[0] = entity;
                        for (let i = 0; i < compCount; i++) {
                            const getter = getters[i];
                            result[i + 1] = getter ? getter(entity) : world.get(entity, actualComponents[i]);
                        }

                        if (hasMut) {
                            for (let i = 0; i < mutCount; i++) {
                                mutData[i].data = result[_mutIndices[i] + 1] as Record<string, unknown>;
                            }
                            prevEntity = entity;
                        }

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

    forEach(callback: (entity: Entity, ...components: ComponentsData<C>) => void): void {
        const { _mutIndices } = this.descriptor_;
        const entities = this.candidates_();
        const compCount = this.actualComponents_.length;
        const hasMut = _mutIndices.length > 0;
        const hasChangeFilters = this.hasChangeFilters_();
        const result = this.result_;
        const mutData = this.mutData_;
        const mutCount = mutData.length;
        const world = this.world_;
        const getters = this.getters_;
        const actualComponents = this.actualComponents_;

        world.beginIteration();
        // Non-null means one entity's Mut edits are still owed a write-back and
        // none has been attempted. flushMut takes it, so a failing write-back is
        // not tried a second time by the finally below.
        let prevEntity: Entity | null = null;
        const flushMut = (): void => {
            const entity = prevEntity!;
            prevEntity = null;
            this.writeMutBack_(entity);
        };
        try {
            for (let idx = 0; idx < entities.length; idx++) {
                const entity = entities[idx];
                if (hasChangeFilters && !this.passesChangeFilters_(entity)) continue;

                if (prevEntity !== null && hasMut) flushMut();

                result[0] = entity;
                for (let i = 0; i < compCount; i++) {
                    const getter = getters[i];
                    result[i + 1] = getter ? getter(entity) : world.get(entity, actualComponents[i]);
                }

                if (hasMut) {
                    for (let i = 0; i < mutCount; i++) {
                        mutData[i].data = result[_mutIndices[i] + 1] as Record<string, unknown>;
                    }
                    prevEntity = entity;
                }

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
            }

            if (prevEntity !== null && hasMut) flushMut();
        } finally {
            if (prevEntity !== null && hasMut) {
                // The callback threw partway. Edits it already finished still go
                // back, but a failure writing them must not replace the error on
                // its way out — that error is the one worth reading.
                try { flushMut(); } catch { /* the original error wins */ }
            }
            world.endIteration();
        }
    }

    /**
     * The one result, or null. Copied off the iterator's shared row buffer, which
     * the next iteration overwrites — a caller that holds this would otherwise
     * watch it change under them.
     */
    single(): QueryResult<C> | null {
        for (const result of this) {
            return [...result] as QueryResult<C>;
        }
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
        for (const row of this) {
            arr.push([...row] as QueryResult<C>);
        }
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
    private lastRunTick_: number;

    constructor(world: World, component: T, lastRunTick: number) {
        this.world_ = world;
        this.component_ = component;
        this.lastRunTick_ = lastRunTick;
        world.enableChangeTracking(component);
    }

    /** @internal Update lastRunTick for reuse across system runs */
    resetTick(tick: number): void {
        this.lastRunTick_ = tick;
    }

    *[Symbol.iterator](): Iterator<Entity> {
        yield* this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_);
    }

    isEmpty(): boolean {
        return this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_).length === 0;
    }

    toArray(): Entity[] {
        return this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_);
    }
}
