// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerModel.ts — the ONE outliner tree builder.
 *
 * Flattens a SceneData into a render-ordered list of {@link OutlinerItem}s — a
 * tagged union of `entity` and `folder` rows — honoring the expansion set (keyed
 * by stable string item keys) + a name filter. The same builder feeds the editor
 * tree and the always-expanded live "Game" tree.
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
  /** Manual-order position among its siblings (drag-between reads ±0.5 of this). */
  sortKey: number;
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
  /** A root entity's folder path (`""` = scene root). Absent ⇒ no folders (live game). */
  folderOf?: (id: EntityId) => string;
  /** A folder's manual sort position (drag-placed); absent ⇒ default (top of level). */
  folderOrderOf?: (path: string) => number | undefined;
  /** The scene's explicit (incl. empty) folders, so empties still show. */
  folders?: readonly string[];
  /** Free-text name filter; matches + their ancestors survive (case-insensitive). */
  query?: string;
  /** Render every node expanded — the live-game tree, and implicitly while filtering. */
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

  const childFolders = (path: string): string[] => [...allFolders].filter((p) => folderParent(p) === path);
  const countUnder = (path: string): number => {
    let n = 0;
    for (const [fp, arr] of rootsByFolder) if (isFolderUnder(fp, path)) n += arr.length;
    return n;
  };

  // Unified sibling ordering: folders and root entities INTERLEAVE at each level.
  // Manual key: entity → its scene (data) index; folder → its drag-placed order,
  // else the top of the level (a fresh folder isn't lost among the entities).
  // name/type sort orders folders + entities together by name / kind.
  const FOLDER_DEFAULT_TOP = -1e6;
  const entityIndex = new Map((data?.entities ?? []).map((e, i) => [e.id, i] as const));
  const folderOrderOf = opts.folderOrderOf ?? (() => undefined);
  const manualFolderKey = (p: string): number => {
    const o = folderOrderOf(p);
    if (o !== undefined) return o;
    const i = (opts.folders ?? []).indexOf(p);
    return FOLDER_DEFAULT_TOP + (i < 0 ? 0 : i);
  };

  type Sib = { folder: string } | { entity: SceneNode };
  const nameOf = (s: Sib): string => ('folder' in s ? folderName(s.folder) : s.entity.name);
  const kindOf = (s: Sib): string => ('folder' in s ? 'folder' : s.entity.kind);
  const manualKey = (s: Sib): number => ('folder' in s ? manualFolderKey(s.folder) : (entityIndex.get(s.entity.id) ?? 0));
  const sortSibs = (sibs: Sib[]): Sib[] => {
    if (sort === 'name') return sibs.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (sort === 'type') return sibs.sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || nameOf(a).localeCompare(nameOf(b)));
    return sibs.sort((a, b) => manualKey(a) - manualKey(b) || nameOf(a).localeCompare(nameOf(b)));
  };

  const out: OutlinerItem[] = [];

  const emitEntity = (node: SceneNode, depth: number, parentKey: string | null, sortKey: number): void => {
    const hasChildren = !!node.children?.length;
    const expanded = expandAll || opts.expanded.has(entityKey(node.id));
    out.push({ kind: 'entity', key: entityKey(node.id), id: node.id, node, depth, hasChildren, expanded, parentKey, sortKey });
    if (hasChildren && expanded) {
      sortNodes(node.children!, sort).forEach((c, i) =>
        emitEntity(c, depth + 1, entityKey(node.id), sort === 'manual' ? (entityIndex.get(c.id) ?? i) : i),
      );
    }
  };

  const emitLevel = (path: string, depth: number, parentKey: string | null): void => {
    const sibs: Sib[] = [
      ...childFolders(path).map((p): Sib => ({ folder: p })),
      ...(rootsByFolder.get(path) ?? []).map((n): Sib => ({ entity: n })),
    ];
    sortSibs(sibs);
    sibs.forEach((s, i) => {
      const sortKey = sort === 'manual' ? manualKey(s) : i;
      if ('folder' in s) {
        const fp = s.folder;
        const hasKids = childFolders(fp).length > 0 || (rootsByFolder.get(fp)?.length ?? 0) > 0;
        const expanded = expandAll || opts.expanded.has(folderKey(fp));
        out.push({ kind: 'folder', key: folderKey(fp), path: fp, name: folderName(fp), count: countUnder(fp), depth, hasChildren: hasKids, expanded, parentKey, sortKey });
        if (expanded) emitLevel(fp, depth + 1, folderKey(fp));
      } else {
        emitEntity(s.entity, depth, parentKey, sortKey);
      }
    });
  };

  emitLevel(ROOT_FOLDER, 0, null);
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
