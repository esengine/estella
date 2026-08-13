// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One tree across the play boundary: what makes a row "the same row".
 *
 * The Outliner showed two trees because a document id and a realm handle are
 * different numbers for the same entity. These are the claims that let one tree
 * span both: an authored row keeps its key while the game runs, a spawned row
 * gets one that cannot collide with a document id, and a selection made in the
 * editor still points at the same thing after Play.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { authoredRef, spawnedRef, refKey, refOfLive, sameRef, srcIdOf } from '@/engine/entityRef';
import { buildOutlinerItems, entityKey } from '@/outliner/OutlinerModel';
import { useSelection } from '@/store/selectionStore';

/** A live tree as the realm reports it: realm handles, `src` only where the
 *  entity came from the open document. */
const liveTree = (rows: Array<{ id: number; src?: number; parent?: number | null }>): SceneData =>
  ({
    version: '1.0',
    name: 'live',
    entities: rows.map((r) => ({
      id: r.id,
      name: `E${r.id}`,
      parent: r.parent ?? null,
      children: [],
      components: [{ type: 'Transform', data: {} }],
      ...(r.src === undefined ? {} : { src: r.src }),
    })),
  }) as unknown as SceneData;

const srcOfLive = (tree: SceneData) => {
  const map = new Map<number, number>();
  for (const e of tree.entities as Array<{ id: number; src?: number }>) {
    if (e.src !== undefined) map.set(e.id, e.src);
  }
  return (id: number) => refOfLive(id, map.get(id));
};

describe('entity refs', () => {
  it('keys an authored row exactly as the plain scene tree does', () => {
    // A saved expansion set is a set of these strings. If the key changed on
    // Play, every open row would close and reopen somewhere else.
    expect(refKey(authoredRef(7))).toBe(entityKey(7));
  });

  it('cannot confuse a realm handle with a document id', () => {
    // Realm handles are small integers too — the collision is certain, not
    // theoretical, so the two spaces must not share a key format.
    expect(refKey(spawnedRef(7))).not.toBe(refKey(authoredRef(7)));
    expect(sameRef(spawnedRef(7), authoredRef(7))).toBe(false);
  });

  it('reads a document id only from something the document has', () => {
    expect(srcIdOf(authoredRef(7))).toBe(7);
    expect(srcIdOf(spawnedRef(7))).toBeNull();
    expect(srcIdOf(null)).toBeNull();
  });
});

describe('the tree of a running world', () => {
  it('gives an authored entity the row key it had before Play', () => {
    // Realm handle 900, loaded from document row 3.
    const tree = liveTree([{ id: 900, src: 3 }]);
    const items = buildOutlinerItems(tree, { expanded: new Set(), refOf: srcOfLive(tree) });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe(entityKey(3));
    // The row still ACTS on the running world: live ops need the handle.
    expect(items[0].kind === 'entity' && items[0].id).toBe(900);
  });

  it('marks an entity the game spawned as belonging to no document row', () => {
    const tree = liveTree([{ id: 901 }]);
    const items = buildOutlinerItems(tree, { expanded: new Set(), refOf: srcOfLive(tree) });
    expect(items[0].kind === 'entity' && items[0].ref.world).toBe('spawned');
    expect(items[0].key).toBe(refKey(spawnedRef(901)));
  });

  it('separates a spawned row from the document row that shares its number', () => {
    // Handle 3 is a bullet; document row 3 is a platform loaded as handle 900.
    const tree = liveTree([{ id: 900, src: 3 }, { id: 3 }]);
    const items = buildOutlinerItems(tree, { expanded: new Set(), refOf: srcOfLive(tree) });
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it('keeps a parent row expanded under the key its child nests below', () => {
    const tree = liveTree([{ id: 900, src: 3 }, { id: 901, src: 4, parent: 900 }]);
    const refOf = srcOfLive(tree);
    const collapsed = buildOutlinerItems(tree, { expanded: new Set(), refOf });
    expect(collapsed).toHaveLength(1); // the child is folded away

    const opened = buildOutlinerItems(tree, { expanded: new Set([entityKey(3)]), refOf });
    expect(opened.map((i) => i.key)).toEqual([entityKey(3), entityKey(4)]);
    expect(opened[1].parentKey).toBe(entityKey(3));
  });
});

describe('one selection', () => {
  beforeEach(() => useSelection.getState().select(null));

  it('survives Play as the same ref it was made with', () => {
    useSelection.getState().select(3);
    const before = useSelection.getState().selectedRef;
    // Play changes nothing about the selection: the running world is looked up
    // through the ref, not stored in it.
    expect(sameRef(before, authoredRef(3))).toBe(true);
    expect(useSelection.getState().selectedId).toBe(3);
  });

  it('holds a spawned entity without claiming the document has one', () => {
    useSelection.getState().selectRef(spawnedRef(901));
    const s = useSelection.getState();
    expect(s.selectedRef).toEqual(spawnedRef(901));
    // Every edit command reads selectedId/selectedIds; a bullet must not reach
    // one and be looked up as a document row.
    expect(s.selectedId).toBeNull();
    expect(s.selectedIds.size).toBe(0);
  });

  it('drops a spawned selection on Stop and keeps an authored one', () => {
    useSelection.getState().selectRef(spawnedRef(901));
    useSelection.getState().dropSpawnedSelection();
    expect(useSelection.getState().selectedRef).toBeNull();

    useSelection.getState().select(3);
    useSelection.getState().dropSpawnedSelection();
    expect(sameRef(useSelection.getState().selectedRef, authoredRef(3))).toBe(true);
  });

  it('never lets the ref and the id disagree', () => {
    useSelection.getState().selectMany([3, 4], 4);
    expect(useSelection.getState().selectedId).toBe(4);
    expect(sameRef(useSelection.getState().selectedRef, authoredRef(4))).toBe(true);

    useSelection.getState().toggleSelect(4); // drops the primary
    const s = useSelection.getState();
    expect(srcIdOf(s.selectedRef)).toBe(s.selectedId);

    useSelection.getState().selectAsset('a/b.png');
    expect(useSelection.getState().selectedRef).toBeNull();
    expect(useSelection.getState().selectedId).toBeNull();
  });
});
