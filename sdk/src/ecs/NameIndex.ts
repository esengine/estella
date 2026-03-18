/**
 * @file    NameIndex.ts
 * @brief   Bidirectional name-to-entity index
 */

import { Entity } from '../types';

export class NameIndex {
    private nameToEntity_ = new Map<string, Entity>();
    private entityToName_ = new Map<Entity, string>();

    update(entity: Entity, name: string): void {
        const oldName = this.entityToName_.get(entity);
        if (oldName !== undefined) {
            this.nameToEntity_.delete(oldName);
        }
        if (name) {
            this.nameToEntity_.set(name, entity);
            this.entityToName_.set(entity, name);
        } else {
            this.entityToName_.delete(entity);
        }
    }

    remove(entity: Entity): void {
        const oldName = this.entityToName_.get(entity);
        if (oldName !== undefined) {
            this.nameToEntity_.delete(oldName);
            this.entityToName_.delete(entity);
        }
    }

    findByName(name: string): Entity | null {
        return this.nameToEntity_.get(name) ?? null;
    }
}
