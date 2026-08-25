// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptStorage.ts
 * @brief   TypeScript-side component storage for user-defined (non-builtin) components
 */

import { Entity } from '../types';
import { ComponentDef } from './component';
import { validateComponentData, formatValidationErrors, assetFieldNames } from '../util/validation';
import { log } from '../util/logger';
import { reorderMapByRank, type RankOf } from './entityOrder';
import { ScriptPool, poolShape, HEAP_MEMORY, type PoolMemory } from './ScriptPool';

export interface InsertResult<T> {
    value: T;
    isNew: boolean;
}

export class ScriptStorage {
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();
    private entityComponents_ = new Map<Entity, Set<symbol>>();
    /**
     * Components held as rows rather than objects, by id. A component qualifies
     * when its defaults are all scalars, which is exactly the set a compiled
     * system can reach — a compiled system addresses a component, and a JS
     * object has no address.
     */
    private pools_ = new Map<symbol, ScriptPool>();
    private poolMemory_: PoolMemory = HEAP_MEMORY;

    /**
     * @internal Where pools allocate from. A wasm runtime installs one backed by
     * linear memory before any component is added, because compiled code cannot
     * reach a JS-heap array; a native one leaves the default.
     */
    /**
     * Bumped whenever a pooled row is claimed, released, or moved by a growth —
     * i.e. whenever an address this storage handed out may have stopped meaning
     * what it meant. The engine's own pools answer the same question through
     * `Registry::layoutEpoch`; a caller that holds addresses reads both.
     */
    get layoutEpoch(): number {
        return this.layoutEpoch_;
    }

    private layoutEpoch_ = 0;

    usePoolMemory(memory: PoolMemory): void {
        if (this.pools_.size > 0) {
            throw new Error('ScriptPool memory must be chosen before the first pooled component');
        }
        this.poolMemory_ = memory;
    }

    /** @internal The rows behind `component`, or undefined if it has none. */
    poolFor(id: symbol): ScriptPool | undefined {
        return this.pools_.get(id);
    }

    /**
     * @internal Re-view every pool. A wasm heap grows for one pool and detaches
     * the views of all of them, so this is a set operation and not a per-pool
     * one. Idempotent: a caller that is unsure may call it.
     */
    refreshPools(): void {
        for (const pool of this.pools_.values()) pool.refresh();
    }

    /**
     * The pool `component` uses, creating it on first sight. `null` once for a
     * shape that cannot be flat, and remembered as null so the check is not
     * repeated per insert.
     */
    private pool_(component: ComponentDef<any>): ScriptPool | null {
        const held = this.pools_.get(component._id);
        if (held) return held;
        if (this.notPooled_.has(component._id)) return null;
        const fields = poolShape(component._default);
        if (!fields) { this.notPooled_.add(component._id); return null; }
        const pool = new ScriptPool(fields, 64, this.poolMemory_);
        this.pools_.set(component._id, pool);
        // Creating one may have grown the heap every OTHER pool also lives in.
        this.refreshPools();
        return pool;
    }

    private notPooled_ = new Set<symbol>();

    insert<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): InsertResult<T> {
        let filtered: Partial<T> | undefined;
        if (data !== null && data !== undefined && typeof data === 'object') {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined) {
                    clean[k] = v;
                }
            }
            const errors = validateComponentData(
                component._name,
                component._default as Record<string, unknown>,
                clean,
                assetFieldNames(component)
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
            filtered = clean as Partial<T>;
        }

        const storage = this.getStorage(component);
        const pool = this.pool_(component);
        if (pool) {
            // Defaults then the caller's fields, into the row. `create` would
            // give the same object for an all-scalar shape, one allocation and
            // one address short of what a compiled system needs.
            const { view, isNew } = pool.put(
                entity, component._default as Record<string, unknown>,
                filtered as Record<string, unknown> | undefined);
            // Only a NEW row moves anything: it claims a slot, and claiming may
            // have grown the pool. Overwriting one leaves every address alone.
            if (isNew) this.layoutEpoch_++;
            storage.set(entity, view);
            this.note_(entity, component);
            return { value: view as T, isNew };
        }
        const value = component.create(filtered);
        const isNew = !storage.has(entity);
        storage.set(entity, value);
        this.note_(entity, component);
        return { value, isNew };
    }

    /**
     * Record that `entity` carries `component`. The index and the per-component
     * maps are one membership fact, so every write that adds a component has to
     * come through here or `getEntityComponentIds` starts answering a subset.
     */
    private note_(entity: Entity, component: ComponentDef<any>): void {
        let ids = this.entityComponents_.get(entity);
        if (!ids) {
            ids = new Set();
            this.entityComponents_.set(entity, ids);
        }
        ids.add(component._id);
    }

    get<T>(entity: Entity, component: ComponentDef<T>): T {
        const storage = this.tsStorage_.get(component._id);
        if (!storage) {
            throw new Error(`Component not found: ${component._name}`);
        }
        return storage.get(entity) as T;
    }

    has<T>(entity: Entity, component: ComponentDef<T>): boolean {
        const storage = this.tsStorage_.get(component._id);
        return storage?.has(entity) ?? false;
    }

    remove<T>(entity: Entity, component: ComponentDef<T>): void {
        const storage = this.tsStorage_.get(component._id);
        storage?.delete(entity);
        if (this.pools_.get(component._id)?.delete(entity)) this.layoutEpoch_++;
        const ids = this.entityComponents_.get(entity);
        if (ids) {
            ids.delete(component._id);
        }
    }

    /**
     * Store a whole value, answering whether the entity lacked the component —
     * the caller owns the structural bookkeeping an addition needs. Invalid data
     * warns rather than throwing as `insert` does: a scene load and the reconciler
     * write through here, where one bad field must not take a frame down.
     */
    set(entity: Entity, component: ComponentDef<any>, data: unknown): { isNew: boolean } {
        if (data !== null && data !== undefined && typeof data === 'object') {
            const errors = validateComponentData(
                component._name,
                component._default as Record<string, unknown>,
                data as Record<string, unknown>,
                assetFieldNames(component)
            );
            if (errors.length > 0) {
                log.warn('ecs', formatValidationErrors(component._name, errors));
            }
        }
        const storage = this.getStorage(component);
        const pool = this.pool_(component);
        if (pool) {
            const { view, isNew } = pool.put(
                entity, component._default as Record<string, unknown>,
                (data ?? undefined) as Record<string, unknown> | undefined);
            if (isNew) this.layoutEpoch_++;
            storage.set(entity, view);
            this.note_(entity, component);
            return { isNew };
        }
        const isNew = !storage.has(entity);
        storage.set(entity, data);
        this.note_(entity, component);
        return { isNew };
    }

    getStorage(component: ComponentDef<any>): Map<Entity, unknown> {
        let storage = this.tsStorage_.get(component._id);
        if (!storage) {
            storage = new Map();
            this.tsStorage_.set(component._id, storage);
        }
        return storage;
    }

    getStorageById(id: symbol): Map<Entity, unknown> | undefined {
        return this.tsStorage_.get(id);
    }

    getEntityComponentIds(entity: Entity): Set<symbol> | undefined {
        return this.entityComponents_.get(entity);
    }

    /** Re-order every component's storage so queries iterate in rank order — the
     *  script half of {@link World.applyEntityOrder}. */
    reorderStorages(rankOf: RankOf): void {
        for (const storage of this.tsStorage_.values()) reorderMapByRank(storage, rankOf);
    }

    removeEntity(entity: Entity): symbol[] {
        const ids = this.entityComponents_.get(entity);
        if (!ids) return [];
        const removed: symbol[] = [];
        for (const id of ids) {
            this.tsStorage_.get(id)?.delete(entity);
            if (this.pools_.get(id)?.delete(entity)) this.layoutEpoch_++;
            removed.push(id);
        }
        this.entityComponents_.delete(entity);
        return removed;
    }

    /**
     * @internal Live map sizes for the resource census.
     *
     * `storages` counts component types ever stored and never shrinks by design
     * (an emptied storage is kept for reuse), so the census tracks it as bounded
     * while `rows` and `entities` are the conserved pair.
     */
    sizes(): { storages: number; rows: number; entities: number } {
        let rows = 0;
        for (const storage of this.tsStorage_.values()) rows += storage.size;
        return { storages: this.tsStorage_.size, rows, entities: this.entityComponents_.size };
    }
}
