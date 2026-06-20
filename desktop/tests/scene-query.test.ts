/**
 * @file  SceneQuery.readSceneTree — the outliner tree is derived from the MODEL
 *        (REARCH_EDITOR_MODEL.md §3.4), nested by each entity's `parent` field so
 *        every entity appears exactly once and a drifted `children[]` array (a
 *        hand-edited / malformed scene) can't drop or double-count nodes. Pure
 *        model+query (readSceneTree reads the model only — no World needed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import type { SceneNode } from '@/types';
import { EditorSession } from '@/engine/EditorSession';

const ent = (id: number, parent: number | null, children: number[]) => ({
  id,
  name: `E${id}`,
  parent,
  children,
  components: [] as unknown[],
});

function scene(): SceneData {
  return {
    version: '1.0',
    name: 'tree',
    entities: [
      ent(1, null, [2]), // root with a child
      ent(2, 1, []), // child of 1
      ent(3, 999, []), // dangling parent → must read as a root
      ent(4, 1, []), // parent is 1, but 1.children DOESN'T list 4 (drift) → still under 1
    ],
  } as unknown as SceneData;
}

const ids = (nodes: SceneNode[] | undefined) => (nodes ?? []).map((n) => n.id).sort();

describe('SceneQuery.readSceneTree (model hierarchy)', () => {
  let S: EditorSession;
  beforeEach(() => {
    S = EditorSession.create();
    S.model.adopt(scene(), new Map());
  });

  it('roots = entities with no parent or a dangling parent', () => {
    const tree = S.query.readSceneTree();
    expect(ids(tree)).toEqual([1, 3]); // 1 (no parent) + 3 (parent 999 missing)
  });

  it('nests by the parent field, robust to a drifted children[] array', () => {
    const tree = S.query.readSceneTree();
    const root1 = tree.find((n) => n.id === 1)!;
    // Both 2 (listed in children[]) and 4 (NOT listed, but parent===1) nest under 1.
    expect(ids(root1.children)).toEqual([2, 4]);
  });

  it('a dangling-parent node has no phantom children', () => {
    const tree = S.query.readSceneTree();
    const node3 = tree.find((n) => n.id === 3)!;
    expect(node3.children).toBeUndefined();
  });
});
