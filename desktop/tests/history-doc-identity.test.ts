// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorHistory document identity — entries carry a docId so an asset
 *        editor reopening/closing its file can purge ONLY its own stale steps,
 *        and a scene switch (clearScene) keeps asset-doc steps alive. Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

describe('EditorHistory document identity', () => {
  let h: EditorHistoryImpl;
  let log: string[];
  beforeEach(() => {
    h = new EditorHistoryImpl();
    log = [];
  });
  const rec = (label: string, doc?: string) =>
    h.record(label, () => log.push(`fwd:${label}`), () => log.push(`rev:${label}`), doc);

  it('purgeDoc drops only that document entries from the undo stack', () => {
    rec('scene1');
    rec('tsA', 'tileset');
    rec('scene2');
    rec('tsB', 'tileset');
    h.purgeDoc('tileset');
    h.undo();
    h.undo();
    expect(log).toEqual(['rev:scene2', 'rev:scene1']);
    expect(h.canUndo()).toBe(false);
  });

  it('purgeDoc also drops that document entries from the redo stack', () => {
    rec('tsA', 'tileset');
    rec('scene1');
    h.undo();
    h.undo(); // both on the redo stack now
    h.purgeDoc('tileset');
    h.redo();
    expect(log).toEqual(['rev:scene1', 'rev:tsA', 'fwd:scene1']);
    expect(h.canRedo()).toBe(false);
  });

  it('purgeDoc leaves other documents entries untouched', () => {
    rec('bt1', 'bt');
    rec('fsm1', 'fsm');
    h.purgeDoc('bt');
    expect(h.undoLabel()).toBe('fsm1');
    h.undo();
    expect(log).toEqual(['rev:fsm1']);
    expect(h.canUndo()).toBe(false);
  });

  it('clearScene purges scene entries but keeps asset-doc entries undoable', () => {
    rec('scene1');
    rec('bt1', 'bt');
    rec('scene2');
    h.clearScene();
    expect(h.undoLabel()).toBe('bt1');
    h.undo();
    expect(log).toEqual(['rev:bt1']);
    expect(h.canUndo()).toBe(false);
  });

  it('doc-tagged edits do not dirty the scene; scene edits do', () => {
    rec('bt1', 'bt');
    expect(h.isDirty()).toBe(false);
    rec('scene1');
    expect(h.isDirty()).toBe(true);
  });

  it('scene dirty tracks the scene head across interleaved asset edits', () => {
    rec('scene1');
    h.markSaved();
    rec('bt1', 'bt');
    expect(h.isDirty()).toBe(false); // asset edit on top of the saved scene head
    rec('scene2');
    expect(h.isDirty()).toBe(true);
    h.undo(); // scene2
    expect(h.isDirty()).toBe(false); // back at the saved scene head (bt1 on top)
  });

  it('clearScene resets the scene clean baseline', () => {
    rec('scene1');
    expect(h.isDirty()).toBe(true);
    h.clearScene();
    expect(h.isDirty()).toBe(false);
  });

  it('run/batch accept a docId and purge with it', () => {
    let v = 0;
    h.run('set', () => { v = 1; }, () => { v = 0; }, 'material');
    h.batch('pair', [{ forward: () => { v = 2; }, reverse: () => { v = 1; } }], 'material');
    expect(v).toBe(1); // batch registers already-applied ops; forward not re-run
    h.purgeDoc('material');
    expect(h.canUndo()).toBe(false);
    expect(h.isDirty()).toBe(false);
  });
});
