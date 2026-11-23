// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ReplicationTableEntry } from './codec';

interface ReferenceField {
    owner: number;
    component: ReplicationTableEntry;
    index: number;
    value: unknown;
}

/** A source ID changing identity affects only the component fields that refer
 *  to it. The server indexes local entities and the client indexes network IDs.
 *  Field masks use the same declaration order as state frames. */
export class EntityReferenceIndex {
    private readonly owners = new Map<number, Map<ReplicationTableEntry, Map<number, ReferenceField>>>();
    private readonly users = new Map<number, Set<ReferenceField>>();
    private changedFields = new Map<ReplicationTableEntry, Map<number, number>>();

    /** The caller owns an immutable sample, separate from the live ECS value. */
    remember(owner: number, component: ReplicationTableEntry, index: number, value: unknown): void {
        let rows = this.owners.get(owner);
        let fields = rows?.get(component);
        let field = fields?.get(index);
        if (field && field.value === value) return;
        const targets: readonly unknown[] = Array.isArray(value) ? value : [value];
        if (!targets.some(id => typeof id === 'number' && id !== 0)) {
            if (field && fields) {
                this.unlink(field);
                fields.delete(index);
                if (!fields.size) this.drop(owner, component);
            }
            return;
        }
        if (field) {
            this.unlink(field);
            field.value = value;
        } else {
            if (!rows) this.owners.set(owner, rows = new Map());
            if (!fields) rows.set(component, fields = new Map());
            field = { owner, component, index, value };
            fields.set(index, field);
        }
        for (const id of targets) {
            if (typeof id !== 'number' || id === 0) continue;
            let users = this.users.get(id);
            if (!users) this.users.set(id, users = new Set());
            users.add(field);
        }
    }

    get(owner: number, component: ReplicationTableEntry, index: number): unknown {
        return this.owners.get(owner)?.get(component)?.get(index)?.value;
    }

    targetChanged(id: number): void {
        const users = this.users.get(id);
        if (!users) return;
        for (const { owner, component, index } of users) {
            let masks = this.changedFields.get(component);
            if (!masks) this.changedFields.set(component, masks = new Map());
            masks.set(owner, (masks.get(owner) ?? 0) | (1 << index));
        }
    }

    takeChanges(): ReadonlyMap<ReplicationTableEntry, ReadonlyMap<number, number>> | undefined {
        if (!this.changedFields.size) return;
        const changes = this.changedFields;
        this.changedFields = new Map();
        return changes;
    }

    drop(owner: number, component?: ReplicationTableEntry): void {
        const rows = this.owners.get(owner);
        if (!rows) return;
        for (const [entry, fields] of rows) {
            if (component && entry !== component) continue;
            for (const field of fields.values()) this.unlink(field);
            const masks = this.changedFields.get(entry);
            if (masks?.delete(owner) && !masks.size) this.changedFields.delete(entry);
            rows.delete(entry);
        }
        if (!rows.size) this.owners.delete(owner);
    }

    private unlink(field: ReferenceField): void {
        for (const id of Array.isArray(field.value) ? field.value : [field.value]) {
            const users = this.users.get(id);
            if (users?.delete(field) && !users.size) this.users.delete(id);
        }
    }

    clear(): void {
        this.owners.clear();
        this.users.clear();
        this.changedFields.clear();
    }
}
