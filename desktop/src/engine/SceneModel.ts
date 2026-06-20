import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';

type SceneEntity = SceneData['entities'][number];

/**
 * The editor's source-of-truth scene data model — JSON-first (REARCH_SERIALIZATION.md, L1).
 *
 * Holds the COMPLETE loaded SceneData: components/fields/entities the live World
 * drops on projection (unknown component types, schema-extra fields,
 * `visible:false` entities) and portable `@uuid:` asset refs, all preserved here
 * verbatim. The World is a lossy render projection of this model; lossless save
 * serializes THIS, not the World.
 *
 * L1 (this step): adopt + retain the model and the model⇄runtime-entity
 * correspondence on load. L3 will route edits through here; L4 will save from
 * here (and retire the editor's `lossy` refuse-to-save guard).
 */
class SceneModelImpl {
  private data: SceneData | null = null;
  /** runtime World entity → this scene's source entity id. */
  private readonly runtimeToSource = new Map<EntityId, number>();
  /** source entity id → runtime World entity (absent for visible:false / unspawned). */
  private readonly sourceToRuntime = new Map<number, EntityId>();

  /**
   * Adopt a freshly-loaded scene as the editor truth.
   * @param loaded   the complete SceneData (with `@uuid:` refs + unknown components)
   * @param entityMap source-id → runtime entity, as returned by resetWorldTo / loadSceneData
   */
  adopt(loaded: SceneData, entityMap: Map<number, EntityId>): void {
    this.data = loaded;
    this.runtimeToSource.clear();
    this.sourceToRuntime.clear();
    for (const [sourceId, runtime] of entityMap) {
      this.sourceToRuntime.set(sourceId, runtime);
      this.runtimeToSource.set(runtime, sourceId);
    }
  }

  clear(): void {
    this.data = null;
    this.runtimeToSource.clear();
    this.sourceToRuntime.clear();
  }

  /** The current scene truth, or null if none loaded. */
  get current(): SceneData | null {
    return this.data;
  }

  /** The source entity record backing a runtime World entity, if tracked. */
  sourceEntity(runtime: EntityId): SceneEntity | undefined {
    const sourceId = this.runtimeToSource.get(runtime);
    if (sourceId === undefined || !this.data) return undefined;
    return this.data.entities.find((e) => e.id === sourceId);
  }

  /** Runtime World entity for a source id (if currently spawned). */
  runtimeFor(sourceId: number): EntityId | undefined {
    return this.sourceToRuntime.get(sourceId);
  }
  /** Source id for a runtime World entity (if tracked). */
  sourceFor(runtime: EntityId): number | undefined {
    return this.runtimeToSource.get(runtime);
  }
}

export const SceneModel = new SceneModelImpl();
