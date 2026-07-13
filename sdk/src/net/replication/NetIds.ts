// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NetIds.ts
 * @brief   NetId ↔ Entity mapping. Entity handles are realm-local (packed
 *          generation|index, recycled on despawn), so the wire never carries
 *          them — a server-allocated NetId is the one cross-machine identity,
 *          and each endpoint keeps this bidirectional table.
 */
import type { Entity } from '../../types';

export class NetIds {
    private readonly byNetId_ = new Map<number, Entity>();
    private readonly byEntity_ = new Map<Entity, number>();
    private nextId_ = 1;

    /** Server-side: allocate the next NetId. */
    allocate(): number {
        return this.nextId_++;
    }

    register(netId: number, entity: Entity): void {
        this.byNetId_.set(netId, entity);
        this.byEntity_.set(entity, netId);
    }

    unregister(netId: number): void {
        const e = this.byNetId_.get(netId);
        this.byNetId_.delete(netId);
        if (e !== undefined) this.byEntity_.delete(e);
    }

    unregisterEntity(entity: Entity): void {
        const id = this.byEntity_.get(entity);
        this.byEntity_.delete(entity);
        if (id !== undefined) this.byNetId_.delete(id);
    }

    entityOf(netId: number): Entity | undefined {
        return this.byNetId_.get(netId);
    }

    netIdOf(entity: Entity): number | undefined {
        return this.byEntity_.get(entity);
    }

    get size(): number {
        return this.byNetId_.size;
    }

    clear(): void {
        this.byNetId_.clear();
        this.byEntity_.clear();
        this.nextId_ = 1;
    }
}
