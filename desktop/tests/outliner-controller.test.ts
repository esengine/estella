// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  OutlinerController — the outliner's headless view-state (REARCH_OUTLINER
 *        P1/P2/P4). String-keyed expansion + cursor + reveal, model-anchored. Pure
 *        store over a model (no World), so it's unit-testable headless.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { EditorSession } from '@/engine/EditorSession';
import { createOutlinerStore } from '@/outliner/OutlinerController';
import { entityKey, folderKey } from '@/outliner/OutlinerModel';

const ent = (id: number, parent: number | null, children: number[]) => ({ id, name: `E${id}`, parent, children, components: [] as unknown[] });
// 1 ─ 2 ─ 3   (a chain); root 1 lives in folder "A/B".
const scene = (): SceneData =>
  ({ version: '1.0', name: 't', entities: [ent(1, null, [2]), ent(2, 1, [3]), ent(3, 2, [])] }) as unknown as SceneData;

describe('OutlinerController', () => {
  let S: EditorSession;
  let store: ReturnType<typeof createOutlinerStore>;
  beforeEach(() => {
    S = EditorSession.create();
    S.model.adopt(scene(), new Map());
    S.model.setFolder(1, 'A/B');
    store = createOutlinerStore(S.model);
  });

  it('revealEntity expands transform ancestors + the root folder path', () => {
    store.getState().revealEntity(3);
    const exp = store.getState().expanded;
    expect(exp.has(entityKey(1))).toBe(true); // ancestor
    expect(exp.has(entityKey(2))).toBe(true); // ancestor
    expect(exp.has(folderKey('A'))).toBe(true); // root's folder prefixes
    expect(exp.has(folderKey('A/B'))).toBe(true);
    expect(exp.has(entityKey(3))).toBe(false); // the node itself isn't expanded
  });

  it('toggleExpanded / setExpanded / cursor', () => {
    store.getState().setExpanded([entityKey(1)]);
    store.getState().toggleExpanded(entityKey(1));
    expect(store.getState().expanded.has(entityKey(1))).toBe(false);
    store.getState().setCursor(entityKey(2));
    expect(store.getState().cursor).toBe(entityKey(2));
  });

  it('dropId prunes the expansion + clears the cursor for that entity', () => {
    store.getState().setExpanded([entityKey(2)]);
    store.getState().setCursor(entityKey(2));
    store.getState().dropId(2);
    expect(store.getState().expanded.has(entityKey(2))).toBe(false);
    expect(store.getState().cursor).toBeNull();
  });

  it('rebaseFolderKeys re-roots expanded folder keys on rename', () => {
    store.getState().setExpanded([folderKey('A'), folderKey('A/B'), entityKey(1)]);
    store.getState().rebaseFolderKeys('A', 'X');
    const exp = store.getState().expanded;
    expect(exp.has(folderKey('X'))).toBe(true);
    expect(exp.has(folderKey('X/B'))).toBe(true);
    expect(exp.has(entityKey(1))).toBe(true); // entity keys untouched
    expect(exp.has(folderKey('A'))).toBe(false);
  });

  it('the model `entityRemoved` event self-heals expansion (subscribed)', () => {
    store.getState().setExpanded([entityKey(2)]);
    S.commands.deleteEntity(2); // emits entityRemoved(2) (+ its subtree)
    expect(store.getState().expanded.has(entityKey(2))).toBe(false);
  });

  it('reset clears expansion + query + cursor', () => {
    store.getState().setExpanded([entityKey(1)]);
    store.getState().setQuery('x');
    store.getState().setCursor(entityKey(1));
    store.getState().reset();
    expect(store.getState().expanded.size).toBe(0);
    expect(store.getState().query).toBe('');
    expect(store.getState().cursor).toBeNull();
  });
});
