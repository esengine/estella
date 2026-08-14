// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  liveTree.ts — the running world's rows, plus the authored ones it no longer has.
 */
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import type { LiveOrigin } from '@/engine/playProtocol';
import { authoredRef, refKey, refOfLive, spawnedRef, type EntityRef } from '@/engine/entityRef';
import { folderKey } from './OutlinerModel';
import { folderPrefixes, normalizeFolder } from './folders';

type Row = SceneData['entities'][number];
type LiveEntity = Row & LiveOrigin;

export interface LiveTreeView {
  /** The tree to build rows from; null until the realm has reported one. */
  data: SceneData | null;
  /** Who a row is — the one answer for every id in {@link data}. */
  refOf: (id: EntityId) => EntityRef;
  /** Ids of rows the running world does not have (nothing can be written to them). */
  gone: ReadonlySet<EntityId>;
}

// A tombstone still needs an id in the merged tree, and a realm handle must never
// be mistaken for one. Handles are indices, so the negatives are free.
const tombstoneId = (src: EntityId): EntityId => -src - 1;
const srcOfTombstone = (id: EntityId): EntityId => -id - 1;

const NO_IDS: ReadonlySet<EntityId> = new Set();

/**
 * Merge the realm's tree with the scene document: every live entity as reported,
 * plus a tombstone for each authored one the game destroyed, under whichever
 * world owns its parent.
 */
export function mergeLiveTree(live: SceneData | null, doc: SceneData | null): LiveTreeView {
  if (!live) return { data: null, refOf: spawnedRef, gone: NO_IDS };
  const srcToLive = new Map<EntityId, EntityId>();
  const liveToSrc = new Map<EntityId, EntityId>();
  for (const e of live.entities as LiveEntity[]) {
    if (e.src === undefined) continue;
    srcToLive.set(e.src, e.id);
    liveToSrc.set(e.id, e.src);
  }
  const asReported: LiveTreeView = { data: live, refOf: (id) => refOfLive(id, liveToSrc.get(id)), gone: NO_IDS };
  // With nothing of the document running, the realm is showing another world —
  // every authored row would be a tombstone, which is noise, not information.
  if (srcToLive.size === 0) return asReported;
  const docEntities = doc?.entities ?? [];
  const deadSrcs = new Set(docEntities.filter((e) => !srcToLive.has(e.id)).map((e) => e.id));
  if (deadSrcs.size === 0) return asReported;

  const parentOf = (parent: EntityId | null | undefined): EntityId | null =>
    parent == null ? null : srcToLive.get(parent) ?? (deadSrcs.has(parent) ? tombstoneId(parent) : null);
  // Placed where the document has it, behind the last authored row still running:
  // the row you were reading must not jump when the game destroys it.
  const lead: Row[] = [];
  const behind = new Map<EntityId, Row[]>();
  let anchor: EntityId | null = null;
  for (const e of docEntities) {
    const alive = srcToLive.get(e.id);
    if (alive !== undefined) { anchor = alive; continue; }
    const tomb = { ...e, id: tombstoneId(e.id), parent: parentOf(e.parent), children: [] };
    if (anchor === null) lead.push(tomb);
    else (behind.get(anchor) ?? behind.set(anchor, []).get(anchor)!).push(tomb);
  }
  const entities: Row[] = [...lead];
  for (const e of live.entities) {
    entities.push(e);
    const tombs = behind.get(e.id);
    if (tombs) entities.push(...tombs);
  }
  return {
    data: { ...live, entities },
    refOf: (id) => (id < 0 ? authoredRef(srcOfTombstone(id)) : refOfLive(id, liveToSrc.get(id))),
    gone: new Set([...deadSrcs].map(tombstoneId)),
  };
}

/**
 * The keys to expand for `ref`'s row to be on screen: every ancestor it nests
 * under, then its root's folder. The running world has its own parents and its
 * own keys, so a reveal has to be asked of the tree that is showing.
 */
export function revealKeys(view: LiveTreeView, ref: EntityRef, folderOf: (id: EntityId) => string): string[] {
  const rows = view.data?.entities;
  if (!rows) return [];
  const wanted = refKey(ref);
  const found = rows.find((e) => refKey(view.refOf(e.id)) === wanted);
  if (!found) return [];
  let node: Row = found;
  const byId = new Map(rows.map((e) => [e.id, e]));
  const out: string[] = [];
  const seen = new Set<EntityId>([node.id]);
  for (;;) {
    const parent = node.parent == null ? undefined : byId.get(node.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push(refKey(view.refOf(parent.id)));
    node = parent;
  }
  for (const pre of folderPrefixes(normalizeFolder(folderOf(node.id)))) out.push(folderKey(pre));
  return out;
}
