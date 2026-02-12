/**
 * @file    WorldTransformCache.ts
 * @brief   Caches world transforms with dirty flag optimization
 */

import type { SceneData, EntityData } from '../types/SceneTypes';
import {
    Transform,
    composeTransforms,
    createIdentityTransform,
    computeAdjustedLocalTransform,
} from '../math/Transform';

// =============================================================================
// WorldTransformCache
// =============================================================================

export class WorldTransformCache {
    private cache_ = new Map<number, Transform>();
    private dirty_ = new Set<number>();
    private entityMap_ = new Map<number, EntityData>();

    /**
     * @brief Set scene data and rebuild entity index
     */
    setScene(scene: SceneData): void {
        this.entityMap_.clear();
        this.cache_.clear();
        this.dirty_.clear();

        for (const entity of scene.entities) {
            this.entityMap_.set(entity.id, entity);
            this.dirty_.add(entity.id);
        }
    }

    /**
     * @brief Update entity data (call when entity components change)
     */
    updateEntity(entity: EntityData): void {
        this.entityMap_.set(entity.id, entity);
    }

    /**
     * @brief Add new entity to cache
     */
    addEntity(entity: EntityData): void {
        this.entityMap_.set(entity.id, entity);
        this.dirty_.add(entity.id);
    }

    /**
     * @brief Remove entity from cache
     */
    removeEntity(entityId: number): void {
        this.entityMap_.delete(entityId);
        this.cache_.delete(entityId);
        this.dirty_.delete(entityId);
    }

    /**
     * @brief Get world transform for an entity (uses cache)
     */
    getWorldTransform(entityId: number): Transform {
        if (!this.dirty_.has(entityId) && this.cache_.has(entityId)) {
            return this.cache_.get(entityId)!;
        }

        const transform = this.computeWorldTransform(entityId);
        this.cache_.set(entityId, transform);
        this.dirty_.delete(entityId);
        return transform;
    }

    /**
     * @brief Mark entity and all descendants as dirty
     */
    markDirty(entityId: number): void {
        this.invalidateSubtree(entityId);
    }

    /**
     * @brief Called when entity hierarchy changes (reparenting)
     */
    onHierarchyChanged(entityId: number): void {
        this.invalidateSubtree(entityId);
    }

    /**
     * @brief Clear all cached transforms
     */
    clear(): void {
        this.cache_.clear();
        this.dirty_.clear();
    }

    /**
     * @brief Mark all entities as dirty (force recalculation)
     */
    invalidateAll(): void {
        this.cache_.clear();
        for (const entityId of this.entityMap_.keys()) {
            this.dirty_.add(entityId);
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private invalidateSubtree(entityId: number): void {
        this.dirty_.add(entityId);
        this.cache_.delete(entityId);

        const entity = this.entityMap_.get(entityId);
        if (entity) {
            for (const childId of entity.children) {
                this.invalidateSubtree(childId);
            }
        }
    }

    private computeWorldTransform(entityId: number): Transform {
        const entity = this.entityMap_.get(entityId);
        if (!entity) {
            return createIdentityTransform();
        }

        const localTransform = computeAdjustedLocalTransform(entity, (id) => this.entityMap_.get(id));

        if (entity.parent === null) {
            return localTransform;
        }

        const parentWorld = this.getWorldTransform(entity.parent);
        return composeTransforms(parentWorld, localTransform);
    }
}
