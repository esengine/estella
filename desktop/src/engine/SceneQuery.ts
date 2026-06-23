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

/** Full inspector model for one entity in a SceneData. */
export function buildInspector(data: SceneData | null, id: EntityId): InspectorComponent[] {
  const e = data?.entities.find((x) => x.id === id);
  if (!e) return [];
  const out: InspectorComponent[] = [];
  for (const { name, label } of modelInspectableComponents(e)) {
    const cdata = (e.components.find((c) => c.type === name)?.data as Record<string, unknown>) ?? {};
    out.push({ name, label, fields: inspectorFields(name, cdata) });
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
    return buildInspector(this.model.current, id);
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
