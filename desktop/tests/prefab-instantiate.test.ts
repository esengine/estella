// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands.instantiatePrefab against a real headless World
 *        (REARCH_PREFABS.md PF2). Proves a prefab instantiates into the model as
 *        ordinary entities, the Reconciler spawns them, each is tagged with its
 *        prefab origin (for save-collapse), and undo/redo round-trips the subtree.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Transform, migratePrefabData } from 'esengine';
import type { ESEngineModule, SceneData, PrefabData } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const host = vi.hoisted(() => ({ world: null as unknown as App['world'] }));
vi.mock('@/engine/EngineHost', () => ({
  EngineHost: {
    mutableWorld: () => host.world,
    get world() {
      return host.world;
    },
    getResource: () => undefined,
  },
}));

import { EditorSession } from '@/engine/EditorSession';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

function turretPrefab(): PrefabData {
  return migratePrefabData({
    version: '1.0',
    name: 'Turret',
    rootEntityId: 'root',
    entities: [
      { prefabEntityId: 'root', name: 'Turret', parent: null, children: ['barrel'], components: [{ type: 'Transform', data: { position: { x: 1, y: 2, z: 0 } } }], visible: true },
      { prefabEntityId: 'barrel', name: 'Barrel', parent: 'root', children: [], components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }], visible: true },
    ],
  }).data as PrefabData;
}

const REF = '@uuid:turret-1111';

describe.skipIf(!HAS_WASM)('SceneCommands.instantiatePrefab (headless World)', () => {
  let module: ESEngineModule;
  let S: EditorSession;
  beforeAll(async () => {
    module = await loadWasmModule();
  });
  beforeEach(() => {
    const app = App.new();
    app.connectCpp(new module.Registry() as never, module);
    host.world = app.world;
    S = EditorSession.create();
    S.model.adopt(emptyScene(), new Map());
  });
  afterEach(() => S.dispose());

  it('expands a prefab into the model + World, tags origins, undo/redo round-trips', () => {
    const rootId = S.commands.instantiatePrefab(turretPrefab(), REF, null);
    expect(rootId).not.toBeNull();

    // Model: the subtree (root + barrel) is present.
    const entities = S.model.current!.entities;
    expect(entities).toHaveLength(2);
    const root = S.model.entityBySource(rootId!)!;
    const barrel = entities.find((e) => e.name === 'Barrel')!;
    expect(barrel.parent).toBe(rootId);

    // Tags: root carries the prefab ref; both carry instanceRoot + prefabId.
    expect(S.model.prefabTag(rootId!)).toMatchObject({ instanceRoot: rootId, prefabId: 'root', prefab: REF });
    expect(S.model.prefabTag(barrel.id)).toMatchObject({ instanceRoot: rootId, prefabId: 'barrel' });
    expect(S.model.prefabTag(barrel.id)!.prefab).toBeUndefined();

    // World: both spawned with their Transform.
    const rootRt = S.model.runtimeFor(rootId!)!;
    expect(host.world.valid(rootRt)).toBe(true);
    expect(host.world.has(rootRt, Transform)).toBe(true);
    expect(host.world.getAllEntities().length).toBe(2);

    // Undo removes the whole subtree (model + World); redo restores it.
    S.history.undo();
    expect(S.model.current!.entities).toHaveLength(0);
    expect(host.world.getAllEntities().length).toBe(0);
    expect(S.model.prefabTag(rootId!)).toBeUndefined();

    S.history.redo();
    expect(S.model.current!.entities).toHaveLength(2);
    expect(host.world.getAllEntities().length).toBe(2);
    expect(S.model.prefabTag(rootId!)?.prefab).toBe(REF);
  });

  it('instantiates under a parent entity', () => {
    const parent = S.commands.addEntity()!;
    const rootId = S.commands.instantiatePrefab(turretPrefab(), REF, parent)!;
    expect(S.model.entityBySource(rootId)!.parent).toBe(parent);
    // World: the instance root is parented under the scene parent.
    expect(host.world.getAllEntities().length).toBe(3); // parent + root + barrel
  });

  it('places the instance at a drop position (overriding the authored origin)', () => {
    // Prefab authored the root at {1,2}; the drop places it at {50,60}.
    const rootId = S.commands.instantiatePrefab(turretPrefab(), REF, null, { x: 50, y: 60 })!;
    expect(rootId).not.toBeNull();

    // Model: the root's Transform carries the drop position.
    const root = S.model.entityBySource(rootId)!;
    const tf = root.components.find((c) => c.type === 'Transform')!;
    const mp = tf.data.position as { x: number; y: number };
    expect([mp.x, mp.y]).toEqual([50, 60]);

    // World: the Reconciler projected the placed position onto the spawned entity.
    const rt = S.model.runtimeFor(rootId)!;
    const wp = (host.world.get(rt, Transform) as { position: { x: number; y: number } }).position;
    expect([wp.x, wp.y]).toEqual([50, 60]);
  });
});
