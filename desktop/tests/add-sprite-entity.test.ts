// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands.addSpriteEntity — the model side of "drag an image into the
 *        viewport": a Transform + Sprite entity at the drop point, texture ref set,
 *        sized to the texture, undoable. Pure TS (no WASM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 't', entities: [] } as unknown as SceneData);

describe('SceneCommands.addSpriteEntity', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(emptyScene(), new Map());
  });

  it('creates a Transform + Sprite entity at the drop point with the texture ref + size', () => {
    const id = cmds.addSpriteEntity('hero', '@uuid:abc', { x: 64, y: 48 }, { x: 120, y: -30 });
    expect(id).not.toBeNull();
    const e = model.entityBySource(id!)!;
    expect(e.name).toBe('hero');

    const tf = e.components.find((c) => c.type === 'Transform')!.data as { position: { x: number; y: number } };
    expect(tf.position.x).toBe(120);
    expect(tf.position.y).toBe(-30);

    const sp = e.components.find((c) => c.type === 'Sprite')!.data as { texture: unknown; size: { x: number; y: number } };
    expect(sp.texture).toBe('@uuid:abc');
    expect(sp.size).toMatchObject({ x: 64, y: 48 });
  });

  it('is one undo step', () => {
    const id = cmds.addSpriteEntity('hero', '@uuid:abc', { x: 10, y: 10 }, { x: 0, y: 0 });
    expect(model.entityBySource(id!)).toBeTruthy();
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(model.entityBySource(id!)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });
});
