// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pruneLayout.ts — a saved dock layout, minus what this build cannot render.
 *
 * dockview refuses a WHOLE layout over one unknown component — a panel removed
 * from the editor, or contributed by a plugin that is not loaded. Dropping that
 * panel alone keeps the arrangement.
 *
 * Pure: JSON in, JSON out. `null` means nothing usable is left, and the caller
 * should build the default layout.
 */

interface PanelState {
  contentComponent?: string;
  [key: string]: unknown;
}
interface LeafData {
  views?: string[];
  activeView?: string;
  id?: string;
  [key: string]: unknown;
}
interface GridNode {
  type?: string;
  data?: LeafData | GridNode[];
  [key: string]: unknown;
}
interface SavedLayout {
  grid?: { root?: GridNode; [key: string]: unknown };
  panels?: Record<string, PanelState>;
  activeGroup?: string;
  floatingGroups?: Array<{ data?: LeafData; [key: string]: unknown }>;
  popoutGroups?: Array<{ data?: LeafData; [key: string]: unknown }>;
  [key: string]: unknown;
}

const isBranch = (node: GridNode): node is GridNode & { data: GridNode[] } => Array.isArray(node.data);

/** A leaf with the dropped ids gone, or null when nothing is left in it. */
function pruneLeaf(data: LeafData, keep: (id: string) => boolean): LeafData | null {
  const views = (data.views ?? []).filter(keep);
  if (views.length === 0) return null;
  return {
    ...data,
    views,
    // An active tab that was dropped leaves the group with none; the first
    // surviving one is what dockview would have shown anyway.
    activeView: data.activeView && views.includes(data.activeView) ? data.activeView : views[0],
  };
}

function pruneNode(node: GridNode, keep: (id: string) => boolean): GridNode | null {
  if (isBranch(node)) {
    const children = node.data.map((c) => pruneNode(c, keep)).filter((c): c is GridNode => c !== null);
    return children.length === 0 ? null : { ...node, data: children };
  }
  const data = pruneLeaf((node.data ?? {}) as LeafData, keep);
  return data === null ? null : { ...node, data };
}

/**
 * `layout` with every panel whose component this build does not have removed,
 * or null when that empties it. `known` is the set of component keys the dock
 * can render right now.
 */
export function pruneLayout(layout: unknown, known: ReadonlySet<string>): unknown | null {
  if (!layout || typeof layout !== 'object') return null;
  const saved = layout as SavedLayout;
  const panels = saved.panels ?? {};
  const kept = new Set(
    Object.entries(panels)
      .filter(([, p]) => p?.contentComponent === undefined || known.has(p.contentComponent))
      .map(([id]) => id),
  );
  if (kept.size === Object.keys(panels).length) return layout; // nothing to do
  const keep = (id: string): boolean => kept.has(id);

  const root = saved.grid?.root ? pruneNode(saved.grid.root, keep) : null;
  if (!root) return null;

  type Group = NonNullable<SavedLayout['floatingGroups']>[number];
  const groups = (list: Group[]): Group[] =>
    list
      .map((g) => ({ ...g, data: g.data ? pruneLeaf(g.data, keep) ?? undefined : undefined }))
      .filter((g) => g.data !== undefined);

  const surviving = new Set<string>();
  const collect = (node: GridNode): void => {
    if (isBranch(node)) {
      node.data.forEach(collect);
      return;
    }
    const id = (node.data as LeafData | undefined)?.id;
    if (typeof id === 'string') surviving.add(id);
  };
  collect(root);

  return {
    ...saved,
    grid: { ...saved.grid, root },
    panels: Object.fromEntries(Object.entries(panels).filter(([id]) => kept.has(id))),
    ...(saved.activeGroup && !surviving.has(saved.activeGroup) ? { activeGroup: undefined } : {}),
    ...(saved.floatingGroups ? { floatingGroups: groups(saved.floatingGroups) } : {}),
    ...(saved.popoutGroups ? { popoutGroups: groups(saved.popoutGroups) } : {}),
  };
}
