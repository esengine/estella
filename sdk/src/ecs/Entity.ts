/**
 * ESEngine TypeScript SDK - Entity Management
 *
 * Provides entity creation and validation utilities.
 */

import { Entity, INVALID_ENTITY } from '../core/Types';

// Entity ID generation
let nextEntityId: Entity = 0;
const recycledIds: Entity[] = [];

/**
 * Generate a new entity ID.
 * Reuses recycled IDs when available.
 */
export function generateEntityId(): Entity {
  if (recycledIds.length > 0) {
    return recycledIds.pop()!;
  }
  return nextEntityId++;
}

/**
 * Recycle an entity ID for reuse.
 */
export function recycleEntityId(entity: Entity): void {
  recycledIds.push(entity);
}

/**
 * Check if an entity ID is valid (not INVALID_ENTITY).
 */
export function isValidEntity(entity: Entity): boolean {
  return entity !== INVALID_ENTITY;
}

/**
 * Reset entity ID generation (for testing).
 */
export function resetEntityIds(): void {
  nextEntityId = 0;
  recycledIds.length = 0;
}
