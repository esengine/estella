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
  private revision = 1;
  private structureRevision = 1;
  private installed = false;
  private readonly listeners = new Set<() => void>();

  /** Register the bridge on the engine's default context. Idempotent. */
  install() {
    if (this.installed) return;
    this.installed = true;
    const bridge: EditorBridge = {
      registerComponent: () => {},
      onEntitySpawned: () => this.bump(true),
      onEntityDespawned: () => this.bump(true),
      onComponentAdded: () => this.bump(true),
      onComponentRemoved: () => this.bump(true),
      onParentChanged: () => this.bump(true),
      onComponentChanged: () => this.bump(false),
    };
    getDefaultContext().editorBridge = bridge;
  }

  private bump(structural: boolean) {
    this.revision += 1;
    if (structural) this.structureRevision += 1;
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRevision = (): number => this.revision;
  getStructureRevision = (): number => this.structureRevision;
}

export const SceneStore = new SceneStoreImpl();
