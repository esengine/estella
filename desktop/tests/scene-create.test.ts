// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands.create — the unified template/prefab birth path (REARCH
 *        ENTITY_CREATION E1). Proves the merged `create` reproduces both legacy
 *        methods branch-for-branch: a plain template (no prefab tag, "Create X"
 *        label) vs a linked prefab (origin tags + placement + "Instantiate X"),
 *        and that the `createFromTemplate` / `instantiatePrefab` adapters delegate
 *        equivalently. Pure TS (model + history are real; no WASM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData, PrefabData } from 'esengine';
import { migratePrefabData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 't', entities: [] }) as unknown as SceneData;

/** A two-entity prefab (root + child) so tag-per-entity and parenting are visible. */
function widgetPrefab(): PrefabData {
  return migratePrefabData({
    version: '1.0',
    name: 'Widget',
    rootEntityId: 'root',
    entities: [
      { prefabEntityId: 'root', name: 'Widget', parent: null, children: ['child'], components: [{ type: 'Transform', data: { position: { x: 1, y: 2, z: 0 } } }], visible: true },
      { prefabEntityId: 'child', name: 'Child', parent: 'root', children: [], components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }], visible: true },
    ],
  }).data as PrefabData;
}

const REF = '@uuid:widget-1';

const rootPos = (m: SceneModelImpl, id: number) =>
  (m.entityBySource(id)!.components.find((c) => c.type === 'Transform')!.data as { position: { x: number; y: number; z: number } }).position;

describe('SceneCommands.create (unified template/prefab birth path)', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(emptyScene(), new Map());
  });

  it('template branch: expands entities with NO prefab tag; undo/redo round-trips', () => {
    const rootId = cmds.create(widgetPrefab(), { parent: null })!;
    expect(rootId).not.toBeNull();
    expect(model.current!.entities).toHaveLength(2);
    const child = model.current!.entities.find((e) => e.name === 'Child')!;
    expect(child.parent).toBe(rootId);
    expect(model.prefabTag(rootId)).toBeUndefined();
    expect(model.prefabTag(child.id)).toBeUndefined();
    expect(history.undoLabel()).toBe('Create Widget');

    history.undo();
    expect(model.current!.entities).toHaveLength(0);
    history.redo();
    expect(model.current!.entities).toHaveLength(2);
  });

  it('prefab branch: tags every entity with its origin (root carries the ref)', () => {
    const rootId = cmds.create(widgetPrefab(), { parent: null, linkPrefabRef: REF })!;
    const child = model.current!.entities.find((e) => e.name === 'Child')!;
    expect(model.prefabTag(rootId)).toMatchObject({ instanceRoot: rootId, prefabId: 'root', prefab: REF });
    expect(model.prefabTag(child.id)).toMatchObject({ instanceRoot: rootId, prefabId: 'child' });
    expect(model.prefabTag(child.id)!.prefab).toBeUndefined();
    expect(history.undoLabel()).toBe('Instantiate Widget');
  });

  it('position overrides the root authored placement (drop point)', () => {
    const rootId = cmds.create(widgetPrefab(), { parent: null, linkPrefabRef: REF, position: { x: 50, y: 60 } })!;
    const p = rootPos(model, rootId);
    expect([p.x, p.y]).toEqual([50, 60]);
  });

  // A drop point in a 3D view has a depth of its own, and the caller says so.
  it('a drop point with a depth places the root at it', () => {
    const rootId = cmds.create(widgetPrefab(), { parent: null, position: { x: 50, y: 60, z: -140 } })!;
    const p = rootPos(model, rootId);
    expect([p.x, p.y, p.z]).toEqual([50, 60, -140]);
  });

  // Without one, the template keeps the depth it was authored at — which is what
  // every 2D caller means by naming only x and y.
  it('a drop point without one leaves the authored depth alone', () => {
    const prefab = widgetPrefab();
    (prefab.entities[0].components[0].data as { position: { z: number } }).position.z = -7;
    const rootId = cmds.create(prefab, { parent: null, position: { x: 50, y: 60 } })!;
    expect(rootPos(model, rootId).z).toBe(-7);
  });

  it('under a parent: the root attaches to the given parent', () => {
    const parent = cmds.addEntity()!;
    const rootId = cmds.create(widgetPrefab(), { parent })!;
    expect(model.entityBySource(rootId)!.parent).toBe(parent);
  });

  it('adapters delegate: createFromTemplate = create(no link); instantiatePrefab = create(linked + placed)', () => {
    const a = cmds.createFromTemplate(widgetPrefab(), null)!;
    expect(model.prefabTag(a)).toBeUndefined();
    expect(history.undoLabel()).toBe('Create Widget');

    const b = cmds.instantiatePrefab(widgetPrefab(), REF, null, { x: 7, y: 8 })!;
    expect(model.prefabTag(b)).toMatchObject({ prefab: REF });
    const p = rootPos(model, b);
    expect([p.x, p.y]).toEqual([7, 8]);
    expect(history.undoLabel()).toBe('Instantiate Widget');
  });
});
