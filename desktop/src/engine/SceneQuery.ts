import type { SceneNode, NodeKind, EntityId, InspectorComponent, InspectorFieldValue } from '@/types';
import { SceneStore, SceneStoreImpl } from './SceneStore';
import { SceneModel, SceneModelImpl } from './SceneModel';
import {
  inspectorFields,
  inferField,
  isColorKey,
  modelInspectableComponents,
  modelKindOf,
  modelNameOf,
  modelIsVisible,
} from './schema';

/**
 * Read-only projection of the editor's source-of-truth model into view-models
 * (REARCH_EDITOR_MODEL.md §3.4). The outliner tree, inspector, and field reads
 * all come from the MODEL — the single truth — never the World. The Viewport
 * still reads the World for camera-derived screen geometry (pick / gizmo /
 * selection outline) via ViewportController; that is rendering, the engine's
 * domain. All ids here are stable **source ids**.
 *
 * An instance bound to a session's model + store; `SceneQuery` is the app's
 * default-session one.
 */
export class SceneQueryImpl {
  constructor(
    private readonly model: SceneModelImpl,
    private readonly store: SceneStoreImpl,
  ) {}

  /** Monotonic counter; bump means the scene structure changed (for observers). */
  worldVersion(): number {
    return this.store.getStructureRevision();
  }

  /** Build the outliner tree from the model, nesting via parent/children links. */
  readSceneTree(): SceneNode[] {
    const data = this.model.current;
    if (!data) return [];
    const byId = new Map(data.entities.map((e) => [e.id, e]));

    const build = (e: (typeof data.entities)[number]): SceneNode => {
      const kind = modelKindOf(e);
      const kids = e.children
        .map((cid) => byId.get(cid))
        .filter((c): c is typeof e => c != null)
        .map(build);
      return {
        id: e.id,
        name: modelNameOf(e, kind),
        kind,
        visible: modelIsVisible(e),
        locked: false,
        children: kids.length ? kids : undefined,
      };
    };

    // Roots = entities with no parent, or whose parent no longer exists.
    return data.entities.filter((e) => e.parent == null || !byId.has(e.parent)).map(build);
  }

  /** Inspect a single source entity (name, kind, which components it carries). */
  readEntity(id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
    const e = this.model.entityBySource(id);
    if (!e) return null;
    const kind = modelKindOf(e);
    return { name: modelNameOf(e, kind), kind, components: modelInspectableComponents(e).map((c) => c.label) };
  }

  /** Full editable inspector model for a source entity — fields resolved per component. */
  readInspector(id: EntityId): InspectorComponent[] {
    const e = this.model.entityBySource(id);
    if (!e) return [];
    const out: InspectorComponent[] = [];
    for (const { name, label } of modelInspectableComponents(e)) {
      const data = (e.components.find((c) => c.type === name)?.data as Record<string, unknown>) ?? {};
      out.push({ name, label, fields: inspectorFields(name, data) });
    }
    return out;
  }

  /** Read one inspector field's current value (for undo before/after capture). */
  getFieldValue(id: EntityId, compName: string, key: string): InspectorFieldValue | null {
    const comp = this.model.entityBySource(id)?.components.find((c) => c.type === compName);
    if (!comp) return null;
    const data = comp.data as Record<string, unknown>;
    const f = inferField(key, data[key], isColorKey(compName, key));
    return f ? f.value : null;
  }
}

/** The app's default-session query surface. Other sessions construct their own SceneQueryImpl(model, store). */
export const SceneQuery = new SceneQueryImpl(SceneModel, SceneStore);
