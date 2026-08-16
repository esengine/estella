// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Sprite creation (REARCH ENTITY_CREATION E3) — the model side of "drag an
 *        image into the viewport" now runs through the unified pipeline:
 *        `spritePrefab(name, ref, size)` + SceneCommands.create at the drop point.
 *        Proves the entity is a Transform + Sprite with the texture ref + size, and
 *        one undo step — the same guarantees the bespoke addSpriteEntity gave. Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';
import { spritePrefab, meshPrefab } from '@/engine/entitySources';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 't', entities: [] } as unknown as SceneData);

describe('sprite creation (spritePrefab + SceneCommands.create)', () => {
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
    const id = cmds.create(spritePrefab('hero', '@uuid:abc', { x: 64, y: 48 }), { parent: null, position: { x: 120, y: -30 } })!;
    expect(id).not.toBeNull();
    const e = model.entityBySource(id)!;
    expect(e.name).toBe('hero');

    const tf = e.components.find((c) => c.type === 'Transform')!.data as { position: { x: number; y: number } };
    expect(tf.position.x).toBe(120);
    expect(tf.position.y).toBe(-30);

    const sp = e.components.find((c) => c.type === 'Sprite')!.data as { texture: unknown; size: { x: number; y: number } };
    expect(sp.texture).toBe('@uuid:abc');
    expect(sp.size).toMatchObject({ x: 64, y: 48 });
  });

  it('is one undo step', () => {
    const id = cmds.create(spritePrefab('hero', '@uuid:abc', { x: 10, y: 10 }), { parent: null, position: { x: 0, y: 0 } })!;
    expect(model.entityBySource(id)).toBeTruthy();
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(model.entityBySource(id)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });
});

describe('mesh creation (meshPrefab + SceneCommands.create)', () => {
  let model: SceneModelImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    cmds = new SceneCommandsImpl(model, new EditorHistoryImpl());
    model.adopt(emptyScene(), new Map());
  });

  const mesh2d = (lit: boolean) => {
    const id = cmds.create(meshPrefab('banner', '@uuid:m1', lit),
                           { parent: null, position: { x: 10, y: 20 } })!;
    return model.entityBySource(id)!.components.find((c) => c.type === 'Mesh2D')!.data as
      Record<string, unknown>;
  };

  it('points a Mesh2D at the dropped file', () => {
    expect(mesh2d(false).mesh).toBe('@uuid:m1');
  });

  it('lights geometry that carries normals, and leaves the rest alone', () => {
    // The same call the model import makes: normals mean it was authored to be
    // shaded, and geometry without them lands unlit.
    expect(mesh2d(true).lit).toBe(true);
    expect(mesh2d(false).lit).toBe(false);
  });
});
