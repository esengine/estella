/**
 * @file    ScriptStorage.ts
 * @brief   TypeScript-side component storage for user-defined (non-builtin) components
 */

import { Entity } from '../types';
import { ComponentDef } from '../component';
import { validateComponentData, formatValidationErrors } from '../validation';

export interface InsertResult<T> {
    value: T;
    isNew: boolean;
}

export class ScriptStorage {
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();
    private entityComponents_ = new Map<Entity, Set<symbol>>();

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
                clean
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
            filtered = clean as Partial<T>;
        }

        const value = component.create(filtered);
        const storage = this.getStorage(component);
        const isNew = !storage.has(entity);
        storage.set(entity, value);
        let ids = this.entityComponents_.get(entity);
        if (!ids) {
            ids = new Set();
            this.entityComponents_.set(entity, ids);
        }
        ids.add(component._id);
        return { value, isNew };
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
        const ids = this.entityComponents_.get(entity);
        if (ids) {
            ids.delete(component._id);
        }
    }

    set(entity: Entity, component: ComponentDef<any>, data: unknown): void {
        this.getStorage(component).set(entity, data);
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

    removeEntity(entity: Entity): symbol[] {
        const ids = this.entityComponents_.get(entity);
        if (!ids) return [];
        const removed: symbol[] = [];
        for (const id of ids) {
            this.tsStorage_.get(id)?.delete(entity);
            removed.push(id);
        }
        this.entityComponents_.delete(entity);
        return removed;
    }
}
