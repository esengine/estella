import type { EntityId } from '@/types';

/**
 * Stable editor handles for entities.
 *
 * The engine frees an entity id on despawn and hands out a fresh one on the
 * next spawn, so undo/redo that re-creates an entity changes its live id. Undo
 * closures therefore can't capture a raw id — they capture a stable handle and
 * resolve it to the current live id at run time. `acquire` returns the SAME
 * handle for an id that already has one, so commands acting on the same entity
 * (e.g. duplicate then delete) share a handle and stay consistent across
 * re-creates.
 */
class EntityHandlesImpl {
  private next = 1;
  private readonly toId = new Map<number, EntityId | null>();
  private readonly toHandle = new Map<EntityId, number>();

  /** Get the handle for an entity, creating one if needed. */
  acquire(id: EntityId): number {
    const existing = this.toHandle.get(id);
    if (existing != null) return existing;
    const handle = this.next++;
    this.toId.set(handle, id);
    this.toHandle.set(id, handle);
    return handle;
  }

  /** Current live entity id for a handle, or null if it's deleted. */
  liveId(handle: number): EntityId | null {
    return this.toId.get(handle) ?? null;
  }

  /** Point a handle at a new live id (or null when the entity is deleted). */
  rebind(handle: number, newId: EntityId | null): void {
    const old = this.toId.get(handle);
    if (old != null) this.toHandle.delete(old);
    this.toId.set(handle, newId);
    if (newId != null) this.toHandle.set(newId, handle);
  }
}

export const EntityHandles = new EntityHandlesImpl();
