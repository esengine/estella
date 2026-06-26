// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands component-clipboard ops — Paste Values (wholesale replace on
 *        entities that have the component, skip the rest) and Reset to Defaults, each
 *        one undo step. Pure TS (model + history are real; no WASM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

const tf = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });

function scene(): SceneData {
  return {
    version: '1.0',
    name: 't',
    entities: [
      { id: 1, name: 'A', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: '@uuid:a', size: { x: 64, y: 64 } } }] },
      { id: 2, name: 'B', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: '@uuid:b', size: { x: 8, y: 8 } } }] },
      { id: 3, name: 'C', parent: null, children: [], components: [{ type: 'Transform', data: tf() }] },
    ],
  } as unknown as SceneData;
}

const sprite = (m: SceneModelImpl, id: number) =>
  m.entityBySource(id)?.components.find((c) => c.type === 'Sprite')?.data as { texture?: unknown } | undefined;

describe('SceneCommands component clipboard', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(scene(), new Map([[1, 101], [2, 102], [3, 103]]));
  });

  it('pastes values onto entities that have the component, skips those without, one undo step', () => {
    const src = sprite(model, 1)!;
    cmds.pasteComponentValuesMany([2, 3], 'Sprite', src as Record<string, unknown>);
    expect(sprite(model, 2)).toEqual(src); // B replaced with A's values
    expect(sprite(model, 3)).toBeUndefined(); // C has no Sprite → skipped

    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(sprite(model, 2)?.texture).toBe('@uuid:b'); // restored
    expect(history.canUndo()).toBe(false); // exactly one batched step
  });

  it('does not alias the source — editing the pasted copy leaves the original intact', () => {
    const src = sprite(model, 1)! as { texture: string };
    cmds.pasteComponentValuesMany([2], 'Sprite', src as unknown as Record<string, unknown>);
    cmds.setField(2, 'Sprite', 'texture', 'string', '@uuid:changed');
    expect(sprite(model, 2)?.texture).toBe('@uuid:changed');
    expect(sprite(model, 1)?.texture).toBe('@uuid:a'); // source untouched
  });

  it('resets a component to its registered defaults, undoably', () => {
    expect(sprite(model, 1)?.texture).toBe('@uuid:a');
    cmds.resetComponentMany([1], 'Sprite');
    expect(sprite(model, 1)?.texture).not.toBe('@uuid:a'); // back to the Sprite default
    history.undo();
    expect(sprite(model, 1)?.texture).toBe('@uuid:a');
  });
});
