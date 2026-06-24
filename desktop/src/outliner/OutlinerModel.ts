// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerModel.ts — the ONE outliner tree builder.
 *
 * Flattens a SceneData into a render-ordered list of {@link OutlinerItem}s,
 * honoring the expansion set + a name filter. The same builder feeds the editor
 * tree (the model SceneData) and the live PIE "Game" tree (a PlayInspect
 * snapshot) — one path, virtualization-ready (the list IS the render order, so a
 * windowed list renders only the visible slice). This replaces the panel's old
 * recursive `<Row>` walk + its separate PIE flatten.
 *
 * Hierarchy comes from {@link buildSceneTree} (derived from each entity's
 * `parent`, robust to a drifted `children[]`), so this stays a pure projection.
 * The item shape is folder-aware (`kind`) for the path-folder phase; P1 emits
 * only `entity` items.
 */
import type { SceneData } from 'esengine';
import type { SceneNode, EntityId } from '@/types';
import { buildSceneTree } from '@/engine/SceneQuery';

export type OutlinerItemKind = 'entity' | 'folder';

/** One row of the flattened outliner — a tree node placed at render order/depth. */
export interface OutlinerItem {
  /** Entity source id (editor) or realm runtime id (PIE). */
  id: EntityId;
  /** Stable React key (`e<id>`; folders later carry a path-derived key). */
  key: string;
  kind: OutlinerItemKind;
  /** The view-model node (name / kind / visible / locked / children). */
  node: SceneNode;
  depth: number;
  hasChildren: boolean;
  /** Whether this node's children are shown (drives the twist + the walk). */
  expanded: boolean;
  parentId: EntityId | null;
}

export interface BuildOutlinerOpts {
  /** Currently-expanded node ids. Ignored when `expandAll` (or a filter) is on. */
  expanded: ReadonlySet<EntityId>;
  /** Free-text name filter; matches + their ancestors survive (case-insensitive). */
  query?: string;
  /** Render every node expanded — the PIE tree, and implicitly while filtering. */
  expandAll?: boolean;
}

/** Keep a node if its name matches, or any descendant does (matches + ancestors). */
function filterNode(node: SceneNode, q: string): SceneNode | null {
  if (node.name.toLowerCase().includes(q)) return node;
  const kids = (node.children ?? [])
    .map((c) => filterNode(c, q))
    .filter((n): n is SceneNode => n != null);
  return kids.length ? { ...node, children: kids } : null;
}

/** Flatten a SceneData to render-ordered outliner rows (the single tree builder). */
export function buildOutlinerItems(data: SceneData | null, opts: BuildOutlinerOpts): OutlinerItem[] {
  const roots = buildSceneTree(data);
  const q = opts.query?.trim().toLowerCase() ?? '';
  const shown = q ? roots.map((n) => filterNode(n, q)).filter((n): n is SceneNode => n != null) : roots;
  // A live filter force-expands so every surviving match is visible.
  const expandAll = !!opts.expandAll || !!q;

  const out: OutlinerItem[] = [];
  const walk = (nodes: SceneNode[], depth: number, parentId: EntityId | null): void => {
    for (const node of nodes) {
      const hasChildren = !!node.children?.length;
      const expanded = expandAll || opts.expanded.has(node.id);
      out.push({ id: node.id, key: `e${node.id}`, kind: 'entity', node, depth, hasChildren, expanded, parentId });
      if (hasChildren && expanded) walk(node.children!, depth + 1, node.id);
    }
  };
  walk(shown, 0, null);
  return out;
}

/** All node ids that have children — the auto-expand set for a freshly-loaded scene. */
export function collectExpandableIds(data: SceneData | null): EntityId[] {
  const out: EntityId[] = [];
  const walk = (nodes: SceneNode[]): void => {
    for (const n of nodes) {
      if (n.children?.length) {
        out.push(n.id);
        walk(n.children);
      }
    }
  };
  walk(buildSceneTree(data));
  return out;
}
