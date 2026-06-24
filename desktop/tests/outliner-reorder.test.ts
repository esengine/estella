// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Outliner sibling drag-reorder (REARCH_OUTLINER P4). Render order derives
 *        from `data.entities` order; reorderEntity aligns parent+folder to the
 *        target then moves the entity adjacent, undoable. Model+command only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { EditorSession } from '@/engine/EditorSession';

const ent = (id: number, parent: number | null, children: number[]) => ({ id, name: `E${id}`, parent, children, components: [] as unknown[] });
const flat = (): SceneData => ({ version: '1.0', name: 'o', entities: [ent(1, null, []), ent(2, null, []), ent(3, null, [])] }) as unknown as SceneData;

describe('SceneCommands.reorderEntity', () => {
  let S: EditorSession;
  beforeEach(() => {
    S = EditorSession.create();
    S.model.adopt(flat(), new Map());
  });

  it('moves a sibling before a target; undo restores scene order', () => {
    expect(S.model.entityOrder()).toEqual([1, 2, 3]);
    S.commands.reorderEntity(3, 1, true); // drop 3 before 1
    expect(S.model.entityOrder()).toEqual([3, 1, 2]);
    S.history.undo();
    expect(S.model.entityOrder()).toEqual([1, 2, 3]);
  });

  it('moves a sibling after a target', () => {
    S.commands.reorderEntity(1, 3, false); // drop 1 after 3
    expect(S.model.entityOrder()).toEqual([2, 3, 1]);
  });

  it('aligns the dragged entity folder to the target (root drop)', () => {
    S.model.setFolder(1, 'A/B');
    S.commands.reorderEntity(2, 1, true); // 2 before 1 → inherits folder A/B
    expect(S.model.folderOf(2)).toBe('A/B');
    expect(S.model.entityOrder()).toEqual([2, 1, 3]);
    S.history.undo();
    expect(S.model.folderOf(2)).toBe('');
    expect(S.model.entityOrder()).toEqual([1, 2, 3]);
  });

  it('rejects dropping onto its own descendant (cycle)', () => {
    S.model.adopt({ version: '1.0', name: 'o', entities: [ent(1, null, [2]), ent(2, 1, [])] } as unknown as SceneData, new Map());
    S.commands.reorderEntity(1, 2, true); // 1 is 2's ancestor → rejected, order unchanged
    expect(S.model.entityOrder()).toEqual([1, 2]);
  });

  it('a drop in place records nothing (no undo step)', () => {
    const before = S.history.canUndo();
    S.commands.reorderEntity(2, 2, true); // onto self → no-op
    expect(S.history.canUndo()).toBe(before);
  });
});
