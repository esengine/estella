// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NameIndex.ts
 * @brief   Bidirectional name-to-entity index
 */

import { Entity } from '../types';

export class NameIndex {
    // Names are NOT unique (games routinely have many "Coin"/"Enemy"), so a name
    // maps to a SET of entities. A 1:1 map corrupted on the first collision:
    // removing/renaming one "Enemy" dropped the shared key and orphaned the other.
    private nameToEntities_ = new Map<string, Set<Entity>>();
    private entityToName_ = new Map<Entity, string>();

    update(entity: Entity, name: string): void {
        const oldName = this.entityToName_.get(entity);
        if (oldName !== undefined) this.unlink_(oldName, entity);
        if (name) {
            let set = this.nameToEntities_.get(name);
            if (!set) this.nameToEntities_.set(name, (set = new Set()));
            set.add(entity);
            this.entityToName_.set(entity, name);
        } else {
            this.entityToName_.delete(entity);
        }
    }

    remove(entity: Entity): void {
        const oldName = this.entityToName_.get(entity);
        if (oldName !== undefined) {
            this.unlink_(oldName, entity);
            this.entityToName_.delete(entity);
        }
    }

    findByName(name: string): Entity | null {
        const set = this.nameToEntities_.get(name);
        if (!set) return null;
        // "Last wins" for duplicates (Set keeps insertion order → last added is the
        // last iterated); after one duplicate leaves, the survivor is still found.
        let last: Entity | null = null;
        for (const e of set) last = e;
        return last;
    }

    private unlink_(name: string, entity: Entity): void {
        const set = this.nameToEntities_.get(name);
        if (!set) return;
        set.delete(entity);
        if (set.size === 0) this.nameToEntities_.delete(name);
    }
}
