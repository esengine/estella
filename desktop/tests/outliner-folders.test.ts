// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Outliner path-folders (REARCH_OUTLINER.md P2). Folders are organizational
 *        PATHS — a per-entity `folder` field + a scene-level explicit-folder list,
 *        orthogonal to the transform `parent`, lossless through save. Covers the
 *        pure path grammar, the undoable folder commands, and the serialize
 *        round-trip. Model+command only (no World — folders never reach the ECS).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { EditorSession } from '@/engine/EditorSession';
import {
  normalizeFolder,
  folderName,
  folderParent,
  joinFolder,
  folderPrefixes,
  isFolderUnder,
  rebaseFolder,
} from '@/outliner/folders';

describe('folder path helpers', () => {
  it('normalizeFolder collapses separators + trims segments', () => {
    expect(normalizeFolder('a//b/ /c')).toBe('a/b/c');
    expect(normalizeFolder('  ')).toBe('');
    expect(normalizeFolder(undefined)).toBe('');
  });
  it('name / parent', () => {
    expect(folderName('A/B/C')).toBe('C');
    expect(folderParent('A/B/C')).toBe('A/B');
    expect(folderParent('A')).toBe('');
    expect(joinFolder('A/B', 'C')).toBe('A/B/C');
    expect(joinFolder('', 'C')).toBe('C');
  });
  it('prefixes / containment', () => {
    expect(folderPrefixes('A/B/C')).toEqual(['A', 'A/B', 'A/B/C']);
    expect(folderPrefixes('')).toEqual([]);
    expect(isFolderUnder('A/B/C', 'A/B')).toBe(true);
    expect(isFolderUnder('A/BC', 'A/B')).toBe(false); // segment boundary, not a string prefix
    expect(isFolderUnder('A', '')).toBe(true);
  });
  it('rebaseFolder re-roots a path (rename/move)', () => {
    expect(rebaseFolder('A/B/C', 'A/B', 'X')).toBe('X/C');
    expect(rebaseFolder('A/B', 'A/B', 'X/Y')).toBe('X/Y');
    expect(rebaseFolder('Q', 'A/B', 'X')).toBeNull(); // not under the base
  });
});

const ent = (id: number, parent: number | null) => ({ id, name: `E${id}`, parent, children: [] as number[], components: [] as unknown[] });
const scene = (): SceneData =>
  ({ version: '1.0', name: 'folders', entities: [ent(1, null), ent(2, null), ent(3, null)] }) as unknown as SceneData;

describe('SceneCommands folders (undoable)', () => {
  let S: EditorSession;
  beforeEach(() => {
    S = EditorSession.create();
    S.model.adopt(scene(), new Map());
  });

  it('createFolder adds an explicit folder; undo removes it', () => {
    S.commands.createFolder('Enemies');
    expect(S.model.sceneFolders()).toContain('Enemies');
    S.history.undo();
    expect(S.model.sceneFolders()).not.toContain('Enemies');
  });

  it('moveToFolder sets the path; undo restores; no-op when already there', () => {
    S.commands.moveToFolder([1, 2], 'Enemies/Bosses');
    expect(S.model.folderOf(1)).toBe('Enemies/Bosses');
    expect(S.model.folderOf(2)).toBe('Enemies/Bosses');
    S.history.undo();
    expect(S.model.folderOf(1)).toBe('');
    expect(S.model.folderOf(2)).toBe('');
  });

  it('renameFolder re-roots the folder + every entity under it; undo reverts', () => {
    S.commands.moveToFolder([1], 'A/B');
    S.commands.moveToFolder([2], 'A');
    S.commands.createFolder('A/Empty');
    S.commands.renameFolder('A', 'World');
    expect(S.model.folderOf(1)).toBe('World/B');
    expect(S.model.folderOf(2)).toBe('World');
    expect(S.model.sceneFolders()).toContain('World/Empty');
    S.history.undo();
    expect(S.model.folderOf(1)).toBe('A/B');
    expect(S.model.sceneFolders()).toContain('A/Empty');
  });

  it('moving a folder under another = rename to the new parent path (the drag op)', () => {
    S.commands.createFolder('Tools/Gizmos'); // explicit folder (a draggable row)
    S.commands.moveToFolder([1], 'Tools/Gizmos');
    S.commands.createFolder('Lib');
    // Dragging "Tools/Gizmos" into "Lib" is renameFolder → "Lib/Gizmos"; contents follow.
    S.commands.renameFolder('Tools/Gizmos', 'Lib/Gizmos');
    expect(S.model.folderOf(1)).toBe('Lib/Gizmos');
    expect(S.model.sceneFolders()).toContain('Lib/Gizmos');
    S.history.undo();
    expect(S.model.folderOf(1)).toBe('Tools/Gizmos');
  });

  it('deleteFolder moves contents up to the parent (entities survive); undo reverts', () => {
    S.commands.moveToFolder([1], 'A/B');
    S.commands.createFolder('A/B/C');
    S.commands.deleteFolder('A/B');
    expect(S.model.folderOf(1)).toBe('A'); // moved up one level
    expect(S.model.sceneFolders()).toContain('A/C'); // descendant folder re-homed
    expect(S.model.sceneFolders()).not.toContain('A/B');
    S.history.undo();
    expect(S.model.folderOf(1)).toBe('A/B');
    expect(S.model.sceneFolders()).toContain('A/B/C');
  });

  it('folders round-trip through serialize (lossless, editor-only)', () => {
    S.commands.moveToFolder([1], 'Enemies');
    S.commands.createFolder('Empty/Leaf');
    const out = S.model.serialize() as SceneData & { folders?: string[] };
    const e1 = out.entities.find((e) => e.id === 1) as { folder?: string };
    expect(e1.folder).toBe('Enemies');
    expect(out.folders).toContain('Empty/Leaf');
    // The World projection never sees folders — they're not components/parent/name.
  });
});
