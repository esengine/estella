// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { AnyComponentDef } from './component';
import { log } from '../util/logger';

/** @internal The fields still owned by a path write shrink as later writes supersede it. */
export type AssetFieldResolver = (
    entity: Entity, component: AnyComponentDef, authored: Record<string, unknown>, currentFields: ReadonlySet<string>,
) => void | Promise<void>;

interface PendingWrite {
    component: AnyComponentDef;
    fields: Set<string>;
    authored: Record<string, unknown>;
}

// A kept query row can be written twice. Track its individual fields only once it encounters a path.
const draftEdits = new WeakMap<object, Set<string> | null>();

export function rememberAssetDraft(draft: object): void { draftEdits.set(draft, null); }

/** Observe explicit writes to zero without changing the draft's ordinary object and structured-clone semantics. */
export function trackAssetEdits(draft: Record<string, unknown>, component: AnyComponentDef): void {
    const edited = new Set<string>();
    for (const { field } of component.assetFields) {
        let value = draft[field];
        Object.defineProperty(draft, field, {
            enumerable: true, configurable: true,
            get: () => value,
            set(next) { value = next; edited.add(field); },
        });
    }
    draftEdits.set(draft, edited);
}

export function assetEditsOf(draft: object, component: AnyComponentDef): Set<string> | undefined {
    const edited = draftEdits.get(draft);
    if (!edited) return undefined;
    for (const { field } of component.assetFields) {
        if (!Object.getOwnPropertyDescriptor(draft, field)?.set) edited.add(field);
    }
    return edited;
}

/** Consume the submitted strings so the next write of this draft can distinguish a new edit from a previous one. */
export function finishAssetDraft(draft: Record<string, unknown>, component: AnyComponentDef, clean?: Record<string, unknown>): void {
    const edited = draftEdits.get(draft);
    if (edited === undefined) return;
    if (clean) {
        for (const { field } of component.assetFields) if (typeof draft[field] === 'string') draft[field] = clean[field];
        if (!edited) trackAssetEdits(draft, component);
    }
    edited?.clear();
}

/** Only paths still waiting to publish into this World. */
export class PendingAssetFields {
    private readonly byEntity = new Map<Entity, Set<PendingWrite>>();

    has(entity: Entity, component: AnyComponentDef): boolean {
        const writes = this.byEntity.get(entity);
        if (writes) for (const write of writes) if (write.component === component) return true;
        return false;
    }

    restorePaths(
        entity: Entity, component: AnyComponentDef, data: Record<string, unknown>,
        mapPath?: (path: string) => string | null,
    ): void {
        const writes = this.byEntity.get(entity);
        if (!writes) return;
        let defaults: Record<string, unknown> | undefined;
        for (const write of writes) {
            if (write.component !== component) continue;
            defaults ??= component._default as Record<string, unknown>;
            for (const field of write.fields) {
                const path = write.authored[field];
                if (typeof path === 'string' && data[field] === (defaults[field] ?? 0)) {
                    data[field] = mapPath?.(path) ?? path;
                }
            }
        }
    }

    supersede(
        entity: Entity, component: AnyComponentDef, data?: Record<string, unknown>,
        keepPlaceholders = false, edited?: ReadonlySet<string>,
    ): void {
        const writes = this.byEntity.get(entity);
        if (!writes) return;
        const defaults = component._default as Record<string, unknown>;
        for (const write of writes) {
            if (write.component !== component) continue;
            for (const field of write.fields) {
                const value = data?.[field];
                if (!keepPlaceholders || edited?.has(field) || (value !== undefined && value !== (defaults[field] ?? 0))) {
                    write.fields.delete(field);
                }
            }
            if (!write.fields.size) writes.delete(write);
        }
        if (!writes.size) this.byEntity.delete(entity);
    }

    /** Reserve before observers can write again, then start the load after notifications. */
    reserve(entity: Entity, component: AnyComponentDef, authored: Record<string, unknown>, resolve: AssetFieldResolver): () => void {
        const fields = new Set<string>();
        for (const { field } of component.assetFields) {
            if (typeof authored[field] === 'string' && authored[field]) fields.add(field);
        }
        const write = { component, fields, authored };
        const writes = this.byEntity.get(entity) ?? new Set<PendingWrite>();
        this.byEntity.set(entity, writes);
        writes.add(write);
        const finish = (): void => {
            writes.delete(write);
            if (!writes.size && this.byEntity.get(entity) === writes) this.byEntity.delete(entity);
            fields.clear();
        };
        return () => {
            if (!fields.size) return;
            try {
                const settling = resolve(entity, component, authored, fields);
                if (settling) void Promise.resolve(settling).then(finish, error => {
                    finish(); log.warn('asset', `Resolving ${component._name} on entity ${entity} failed`, error);
                });
                else finish();
            } catch (error) { finish(); throw error; }
        };
    }

    remove(entity: Entity): void {
        for (const write of this.byEntity.get(entity) ?? []) write.fields.clear();
        this.byEntity.delete(entity);
    }

    clear(): void {
        for (const entity of this.byEntity.keys()) this.remove(entity);
    }
}
