// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SceneData } from 'esengine';
import type { SceneNode, NodeKind, EntityId, InspectorComponent, InspectorFieldValue } from '@/types';
import { SceneStore, SceneStoreImpl } from './SceneStore';
import { SceneModel, SceneModelImpl } from './SceneModel';
import {
  inspectorFields,
  inferField,
  isColorKey,
  componentEnable,
  modelInspectableComponents,
  modelKindOf,
  modelNameOf,
  modelIsVisible,
} from './schema';

type SceneEntity = SceneData['entities'][number];

// ── Pure view-model builders over a SceneData ────────────────────────────────
// Shared by SceneQuery (the editor model) and PlayInspect (a live realm snapshot
// from serializeScene) — same view-models, different source. Ids are whatever the
// source uses (editor source ids / realm runtime ids).

/** Outliner tree from a SceneData; nesting derived from each entity's `parent`. */
export function buildSceneTree(data: SceneData | null): SceneNode[] {
  if (!data) return [];
  const ids = new Set(data.entities.map((e) => e.id));
  const childrenOf = new Map<number, SceneEntity[]>();
  const roots: SceneEntity[] = [];
  for (const e of data.entities) {
    if (e.parent != null && ids.has(e.parent)) {
      const arr = childrenOf.get(e.parent);
      if (arr) arr.push(e);
      else childrenOf.set(e.parent, [e]);
    } else {
      roots.push(e); // no parent, or a dangling parent → a scene root
    }
  }
  const build = (e: SceneEntity): SceneNode => {
    const kind = modelKindOf(e);
    const kids = childrenOf.get(e.id)?.map(build);
    return { id: e.id, name: modelNameOf(e, kind), kind, visible: modelIsVisible(e), locked: false, children: kids && kids.length ? kids : undefined };
  };
  return roots.map(build);
}

/** Name/kind/components for one entity in a SceneData. */
export function buildEntityInfo(data: SceneData | null, id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
  const e = data?.entities.find((x) => x.id === id);
  if (!e) return null;
  const kind = modelKindOf(e);
  return { name: modelNameOf(e, kind), kind, components: modelInspectableComponents(e).map((c) => c.label) };
}

/**
 * Full inspector model for one entity in a SceneData. `baseOf` (optional) supplies
 * a per-component override base — the prefab-instance base data, when the entity
 * is a prefab instance — so reset/override marks compare against the prefab rather
 * than the class default. Without it, fields fall back to the component default.
 */
export function buildInspector(
  data: SceneData | null,
  id: EntityId,
  baseOf?: (comp: string) => Record<string, unknown> | undefined,
): InspectorComponent[] {
  const e = data?.entities.find((x) => x.id === id);
  if (!e) return [];
  const out: InspectorComponent[] = [];
  for (const { name, label } of modelInspectableComponents(e)) {
    const cdata = (e.components.find((c) => c.type === name)?.data as Record<string, unknown>) ?? {};
    const enable = componentEnable(name, cdata) ?? undefined;
    // The enable field is promoted to the header checkbox — drop it from the body.
    const fields = inspectorFields(name, cdata, baseOf?.(name)).filter((f) => f.key !== enable?.key);
    out.push({ name, label, fields, enable });
  }
  return out;
}

/**
 * Read-only projection of the editor's source-of-truth model into view-models.
 * The outliner tree, inspector, and field reads
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

  /**
   * Build the outliner tree from the model. Nesting is derived from each entity's
   * `parent` field (the authoritative tree position) — grouped into a parent→
   * children index — so every entity appears exactly once: under its parent if it
   * exists, else as a root. This is robust to a `children[]` array that drifted
   * out of sync (e.g. a hand-edited / malformed scene), which a children-driven
   * walk would silently drop or double-count.
   */
  readSceneTree(): SceneNode[] {
    return buildSceneTree(this.model.current);
  }

  /** Inspect a single source entity (name, kind, which components it carries). */
  readEntity(id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
    return buildEntityInfo(this.model.current, id);
  }

  /** Full editable inspector model for a source entity — fields resolved per component. */
  readInspector(id: EntityId): InspectorComponent[] {
    return buildInspector(this.model.current, id, this.prefabBaseOf(id));
  }

  /**
   * The prefab-instance base for an entity: a per-component lookup into the prefab
   * asset's data, so the inspector marks/resets fields against the prefab (the UE
   * override semantic) rather than the class default. Undefined when the entity
   * isn't a prefab instance or no resolver is registered (e.g. isolated tests) —
   * then fields fall back to the component default. The prefab asset is owned by
   * the project layer, so the data source is injected (see {@link setPrefabBaseResolver}).
   */
  private prefabBaseOf(id: EntityId): ((comp: string) => Record<string, unknown> | undefined) | undefined {
    if (!prefabBaseResolver) return undefined;
    const tag = this.model.prefabTag(id);
    if (!tag) return undefined;
    const ref = tag.prefab ?? this.model.prefabTag(tag.instanceRoot)?.prefab;
    if (!ref) return undefined;
    const comps = prefabBaseResolver(ref, tag.prefabId);
    if (!comps) return undefined;
    return (comp) => comps.find((c) => c.type === comp)?.data;
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

/** Resolves a prefab instance's base component data, by ref + the entity's prefab id. */
export type PrefabBaseComponents = Array<{ type: string; data: Record<string, unknown> }>;
export type PrefabBaseResolver = (ref: string, prefabId: string) => PrefabBaseComponents | null;

// Injected by the project layer (it owns the loaded `.esprefab` cache). Left unset
// in isolated sessions/tests, where reset falls back to the component default.
let prefabBaseResolver: PrefabBaseResolver | null = null;

/** Register the source of prefab-instance base data (for override-aware reset). */
export function setPrefabBaseResolver(resolver: PrefabBaseResolver | null): void {
  prefabBaseResolver = resolver;
}

/** The app's default-session query surface. Other sessions construct their own SceneQueryImpl(model, store). */
export const SceneQuery = new SceneQueryImpl(SceneModel, SceneStore);
