import { createStore } from 'zustand/vanilla';
import { getDefaultContext } from 'esengine';
import type { EditorBridge } from 'esengine';

/**
 * Reactive mirror of the engine scene.
 *
 * Registers an {@link EditorBridge} so the engine pushes every mutation
 * (spawn/despawn/parent/component add/remove/change) instead of the editor
 * polling. Panels subscribe via `useSyncExternalStore` and re-read through
 * `EngineHost`; this store only carries revision counters that say *what kind*
 * of thing changed:
 *
 *  - `structureRevision` bumps on entity/parent/component add+remove (tree shape)
 *  - `revision` bumps on any change, incl. component-data edits (inspector values)
 */
class SceneStoreImpl {
  private installed = false;
  private readonly store = createStore<{ revision: number; structureRevision: number }>(() => ({
    revision: 1,
    structureRevision: 1,
  }));
  private readonly despawnListeners = new Set<(id: number) => void>();

  /** Register the bridge on the engine's default context. Idempotent. */
  install() {
    if (this.installed) return;
    this.installed = true;
    const bridge: EditorBridge = {
      registerComponent: () => {},
      onEntitySpawned: () => this.bump(true),
      onEntityDespawned: (e) => {
        // Carry the dead id so consumers (SelectionStore) can drop references
        // precisely. Fires BEFORE the entity is fully removed, so re-validating
        // by world.valid() here would race — dropping by id is exact.
        this.despawnListeners.forEach((l) => l(e as unknown as number));
        this.bump(true);
      },
      onComponentAdded: () => this.bump(true),
      onComponentRemoved: () => this.bump(true),
      onParentChanged: () => this.bump(true),
      onComponentChanged: () => this.bump(false),
    };
    getDefaultContext().editorBridge = bridge;
  }

  /** Subscribe to entity despawns by id (the self-healing hook for selection). */
  onEntityDespawn(fn: (id: number) => void): () => void {
    this.despawnListeners.add(fn);
    return () => this.despawnListeners.delete(fn);
  }

  private bump(structural: boolean) {
    this.store.setState((s) => ({
      revision: s.revision + 1,
      structureRevision: structural ? s.structureRevision + 1 : s.structureRevision,
    }));
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getRevision = (): number => this.store.getState().revision;
  getStructureRevision = (): number => this.store.getState().structureRevision;
}

export const SceneStore = new SceneStoreImpl();
