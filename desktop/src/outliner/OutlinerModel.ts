// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerModel.ts — the ONE outliner tree builder.
 *
 * Flattens a SceneData into a render-ordered list of {@link OutlinerItem}s — a
 * tagged union of `entity` and `folder` rows (UE5 path-folders) — honoring the
 * expansion set (keyed by stable string item keys) + a name filter. The same
 * builder feeds the editor tree and the always-expanded PIE "Game" tree.
 *
 * Folders are organizational PATHS (orthogonal to the transform `parent`): they
 * group **root** entities only; a parented entity always nests under its parent.
 * The folder tree is the union of every root's folder-path prefixes and the
 * scene's explicit (incl. empty) folder list. Hierarchy among entities comes from
 * {@link buildSceneTree} (derived from `parent`, robust to a drifted `children[]`),
 * so this stays a pure projection.
 */
import type { SceneData } from 'esengine';
import type { SceneNode, EntityId } from '@/types';
import { buildSceneTree } from '@/engine/SceneQuery';
import { ROOT_FOLDER, normalizeFolder, folderName, folderParent, folderPrefixes, isFolderUnder } from './folders';

export type OutlinerItemKind = 'entity' | 'folder';

interface OutlinerItemBase {
  /** Stable identity for React keys + the expansion set (`e<id>` / `f:<path>`). */
  key: string;
  depth: number;
  hasChildren: boolean;
  /** Whether this node's children are shown (drives the twist + the walk). */
  expanded: boolean;
  parentKey: string | null;
}
export interface OutlinerEntityItem extends OutlinerItemBase {
  kind: 'entity';
  id: EntityId;
  node: SceneNode;
}
export interface OutlinerFolderItem extends OutlinerItemBase {
  kind: 'folder';
  /** Full folder path. */
  path: string;
  /** Display name (last path segment). */
  name: string;
  /** Entity roots under this folder (recursive) — the row's count badge. */
  count: number;
}
export type OutlinerItem = OutlinerEntityItem | OutlinerFolderItem;

/** Expansion/identity key for an entity row. */
export const entityKey = (id: EntityId): string => `e${id}`;
/** Expansion/identity key for a folder row. */
export const folderKey = (path: string): string => `f:${path}`;

/** Sibling sort: `manual` keeps scene (data) order; `name`/`type` are view-only. */
export type SortMode = 'manual' | 'name' | 'type';

export interface BuildOutlinerOpts {
  /** Expanded item keys. Ignored when `expandAll` (or a filter) is on. */
  expanded: ReadonlySet<string>;
  /** Sibling sort mode (default `manual` = scene order). */
  sort?: SortMode;
  /** A root entity's folder path (`""` = scene root). Absent ⇒ no folders (PIE). */
  folderOf?: (id: EntityId) => string;
  /** The scene's explicit (incl. empty) folders, so empties still show. */
  folders?: readonly string[];
  /** Free-text name filter; matches + their ancestors survive (case-insensitive). */
  query?: string;
  /** Render every node expanded — the PIE tree, and implicitly while filtering. */
  expandAll?: boolean;
}

/** A parsed search query: bare-word name text + `type:`/`comp:` token filters. */
export interface ParsedQuery {
  /** Bare words joined — the name substring + highlight target. */
  text: string;
  /** `type:`/`t:` values, matched against a node's kind (OR). */
  types: string[];
  /** `comp:`/`c:` values, matched against an entity's component types (OR). */
  comps: string[];
}

/** Tokenize a query: `type:sprite comp:RigidBody name` → typed filters + bare text. */
export function parseQuery(raw: string): ParsedQuery {
  const text: string[] = [];
  const types: string[] = [];
  const comps: string[] = [];
  for (const tok of (raw ?? '').trim().toLowerCase().split(/\s+/)) {
    if (!tok) continue;
    const colon = tok.indexOf(':');
    const key = colon > 0 ? tok.slice(0, colon) : '';
    const val = colon > 0 ? tok.slice(colon + 1) : '';
    if (val && (key === 'type' || key === 't')) types.push(val);
    else if (val && (key === 'comp' || key === 'c')) comps.push(val);
    else text.push(tok);
  }
  return { text: text.join(' '), types, comps };
}

const queryActive = (q: ParsedQuery): boolean => q.text !== '' || q.types.length > 0 || q.comps.length > 0;

/** Sort a sibling list by mode (manual = unchanged scene order). */
function sortNodes(nodes: SceneNode[], mode: SortMode): SceneNode[] {
  if (mode === 'manual') return nodes;
  const by = mode === 'name'
    ? (a: SceneNode, b: SceneNode) => a.name.localeCompare(b.name)
    : (a: SceneNode, b: SceneNode) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  return [...nodes].sort(by);
}

/** Keep a node if it matches `keep`, or any descendant does (matches + ancestors). */
function filterNode(node: SceneNode, keep: (n: SceneNode) => boolean): SceneNode | null {
  if (keep(node)) return node; // self matches → keep the whole subtree
  const kids = (node.children ?? [])
    .map((c) => filterNode(c, keep))
    .filter((n): n is SceneNode => n != null);
  return kids.length ? { ...node, children: kids } : null;
}

/** Flatten a SceneData to render-ordered outliner rows (the single tree builder). */
export function buildOutlinerItems(data: SceneData | null, opts: BuildOutlinerOpts): OutlinerItem[] {
  const roots = buildSceneTree(data);
  const q = parseQuery(opts.query ?? '');
  const active = queryActive(q);
  // Component lookup only when a `comp:` token is present (else skip the scan).
  const compsOf = q.comps.length
    ? new Map((data?.entities ?? []).map((e) => [e.id, e.components.map((c) => c.type.toLowerCase())]))
    : null;
  const keep = (n: SceneNode): boolean => {
    if (q.text && !n.name.toLowerCase().includes(q.text)) return false;
    if (q.types.length && !q.types.includes(n.kind)) return false;
    if (q.comps.length) {
      const cs = compsOf?.get(n.id) ?? [];
      if (!q.comps.some((c) => cs.includes(c))) return false;
    }
    return true;
  };
  const shown = active ? roots.map((n) => filterNode(n, keep)).filter((n): n is SceneNode => n != null) : roots;
  const expandAll = !!opts.expandAll || active;
  const folderOf = opts.folderOf ?? (() => ROOT_FOLDER);
  const sort = opts.sort ?? 'manual';

  // Group the shown roots by their folder path, and gather every folder to show:
  // each root path's prefixes, plus the scene's explicit folders (only when not
  // filtering — an explicit empty folder has no match to surface under a query).
  const rootsByFolder = new Map<string, SceneNode[]>();
  const allFolders = new Set<string>();
  for (const root of shown) {
    const path = normalizeFolder(folderOf(root.id));
    (rootsByFolder.get(path) ?? rootsByFolder.set(path, []).get(path)!).push(root);
    for (const pre of folderPrefixes(path)) allFolders.add(pre);
  }
  if (!active) for (const f of opts.folders ?? []) for (const pre of folderPrefixes(normalizeFolder(f))) allFolders.add(pre);

  // Manual sort orders sibling folders by their position in the scene's explicit
  // folder list (drag-reorderable, like entities); derived/list-absent folders
  // fall to the end alphabetically. name/type sort is plain alphabetical.
  const folderRank = sort === 'manual' ? new Map((opts.folders ?? []).map((f, i) => [normalizeFolder(f), i])) : null;
  const childFolders = (path: string): string[] => {
    const kids = [...allFolders].filter((p) => folderParent(p) === path);
    if (folderRank) {
      return kids.sort(
        (a, b) => (folderRank.get(a) ?? Infinity) - (folderRank.get(b) ?? Infinity) || folderName(a).localeCompare(folderName(b)),
      );
    }
    return kids.sort((a, b) => folderName(a).localeCompare(folderName(b)));
  };
  const countUnder = (path: string): number => {
    let n = 0;
    for (const [fp, arr] of rootsByFolder) if (isFolderUnder(fp, path)) n += arr.length;
    return n;
  };

  const out: OutlinerItem[] = [];

  const emitEntity = (node: SceneNode, depth: number, parentKey: string | null): void => {
    const hasChildren = !!node.children?.length;
    const expanded = expandAll || opts.expanded.has(entityKey(node.id));
    out.push({ kind: 'entity', key: entityKey(node.id), id: node.id, node, depth, hasChildren, expanded, parentKey });
    if (hasChildren && expanded) for (const c of sortNodes(node.children!, sort)) emitEntity(c, depth + 1, entityKey(node.id));
  };

  // Emit the child folders of `path` (nested) then the entity roots directly in it.
  const emitFolderContents = (path: string, depth: number, parentKey: string | null): void => {
    for (const fp of childFolders(path)) {
      const hasKids = childFolders(fp).length > 0 || (rootsByFolder.get(fp)?.length ?? 0) > 0;
      const expanded = expandAll || opts.expanded.has(folderKey(fp));
      out.push({ kind: 'folder', key: folderKey(fp), path: fp, name: folderName(fp), count: countUnder(fp), depth, hasChildren: hasKids, expanded, parentKey });
      if (expanded) emitFolderContents(fp, depth + 1, folderKey(fp));
    }
    for (const root of sortNodes(rootsByFolder.get(path) ?? [], sort)) emitEntity(root, depth, parentKey);
  };

  emitFolderContents(ROOT_FOLDER, 0, null);
  return out;
}

/** Every expandable key (folders + entity parents) — the auto-expand set for a fresh scene. */
export function collectExpandableKeys(data: SceneData | null, opts?: Pick<BuildOutlinerOpts, 'folderOf' | 'folders'>): string[] {
  const folderOf = opts?.folderOf ?? (() => ROOT_FOLDER);
  const out: string[] = [];
  const folders = new Set<string>();
  const walk = (nodes: SceneNode[]): void => {
    for (const n of nodes) {
      if (n.children?.length) {
        out.push(entityKey(n.id));
        walk(n.children);
      }
    }
  };
  const roots = buildSceneTree(data);
  walk(roots);
  for (const r of roots) for (const pre of folderPrefixes(normalizeFolder(folderOf(r.id)))) folders.add(pre);
  for (const f of opts?.folders ?? []) for (const pre of folderPrefixes(normalizeFolder(f))) folders.add(pre);
  for (const f of folders) out.push(folderKey(f));
  return out;
}
