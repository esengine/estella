// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands transaction API — a scoped edit batches into one undo step
 *        on commit, reverts live (no step) on abort. Pure TS (the model + undo
 *        plumbing are real; no WASM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

function scene(): SceneData {
  return {
    version: '1.0',
    name: 't',
    entities: [
      {
        id: 1,
        name: 'E',
        parent: null,
        children: [],
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
        ],
      },
    ],
  } as unknown as SceneData;
}

const posX = (m: SceneModelImpl): number =>
  ((m.entityBySource(1)!.components.find((c) => c.type === 'Transform')!.data as Record<string, { x: number }>).position).x;

describe('SceneCommands transaction', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(scene(), new Map([[1, 100]]));
  });

  it('commit coalesces a burst of edits into one undo step', () => {
    const tx = cmds.transaction('Move');
    cmds.setEntityXY(1, 5, 0);
    cmds.setEntityXY(1, 9, 0);
    tx.commit();
    expect(posX(model)).toBe(9);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(posX(model)).toBe(0); // one step reverts the whole burst
    expect(history.canUndo()).toBe(false);
  });

  it('abort reverts live edits and records nothing', () => {
    const tx = cmds.transaction('Move');
    cmds.setEntityXY(1, 7, 0);
    expect(posX(model)).toBe(7); // applied live during the stroke
    tx.abort();
    expect(posX(model)).toBe(0); // restored to the captured BEFORE
    expect(history.canUndo()).toBe(false); // no undo step recorded
  });

  it('transact commits on return and aborts (rethrows) on throw', () => {
    cmds.transact('Batch', () => cmds.setEntityXY(1, 3, 0));
    expect(posX(model)).toBe(3);
    expect(history.canUndo()).toBe(true);

    expect(() =>
      cmds.transact('Bad', () => {
        cmds.setEntityXY(1, 8, 0);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(posX(model)).toBe(3); // aborted → back to the pre-transact value
  });

  it('handle is idempotent (double commit/abort is a no-op)', () => {
    const tx = cmds.transaction('Move');
    cmds.setEntityXY(1, 4, 0);
    tx.commit();
    tx.commit(); // no-op
    tx.abort(); // no-op
    expect(posX(model)).toBe(4);
    history.undo();
    expect(posX(model)).toBe(0);
    expect(history.canUndo()).toBe(false); // exactly one step was recorded
  });
});
