// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A write that will not stick says so, in the reply to the write.
 *
 * From a dogfood run: an agent built a chess board out of forty UI nodes, set
 * `Transform.position` on every one of them, and got an empty viewport with no
 * error anywhere — the layout owns that field and overwrites it. The inspector
 * card says so and the diagnostics sweep repeats it, but both are places you
 * have to go LOOK; the answer belongs in the reply to the call that made the
 * mistake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = {
  entities: new Map<number, { components: Array<{ type: string }> }>(),
  nextId: 100,
};

vi.mock('../src/engine/SceneModel', () => ({
  SceneModel: {
    entityBySource: (id: number) => h.entities.get(id) ?? null,
  },
}));

vi.mock('../src/engine/EditorSession', () => ({
  EditorControlSurface: {
    atomic: (_label: string, fn: () => void) => fn(),
    addEntity: () => {
      const id = ++h.nextId;
      h.entities.set(id, { components: [{ type: 'Transform' }] });
      return id;
    },
    setField: () => {},
    renameEntity: () => {},
    setParent: () => {},
    deleteEntity: () => {},
    addComponent: (id: number, type: string) => h.entities.get(id)?.components.push({ type }),
    removeComponent: () => {},
  },
}));

vi.mock('../src/engine/entitySources', () => ({
  prefabFromSpecs: () => null,
  sourceById: () => null,
}));

const { applySceneOps } = await import('@/engine/sceneOps');

beforeEach(() => {
  h.entities.clear();
  h.nextId = 100;
});

describe('a field the layout owns', () => {
  it('warns when Transform.position is written on a UI node', async () => {
    h.entities.set(1, { components: [{ type: 'Transform' }, { type: 'UINode' }] });
    const res = await applySceneOps([
      { op: 'set', entity: 1, fields: { 'Transform.position.x': 120, 'UINode.width.value': 46 } },
    ]);
    expect(res.applied).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings?.[0]).toContain('entity 1');
    // The message has to name the way that DOES work, or it is just a scolding.
    expect(res.warnings?.[0]).toContain('UINode.left');
  });

  it('says it once per entity and field, not once per member written', async () => {
    h.entities.set(1, { components: [{ type: 'Transform' }, { type: 'UINode' }] });
    const res = await applySceneOps([
      { op: 'set', entity: 1, fields: { 'Transform.position.x': 1, 'Transform.position.y': 2, 'Transform.rotation': 45 } },
    ]);
    // x and y are one field between them; rotation is another.
    expect(res.warnings).toHaveLength(2);
    expect(res.warnings?.some((w) => w.includes('Transform.position'))).toBe(true);
    expect(res.warnings?.some((w) => w.includes('Transform.rotation'))).toBe(true);
  });

  it('says nothing about a world entity — the same write is how you place one', async () => {
    h.entities.set(2, { components: [{ type: 'Transform' }, { type: 'Sprite' }] });
    const res = await applySceneOps([{ op: 'set', entity: 2, fields: { 'Transform.position.x': 120 } }]);
    expect(res.warnings).toBeUndefined();
  });

  it('says nothing about the fields a UI node is actually moved with', async () => {
    h.entities.set(1, { components: [{ type: 'Transform' }, { type: 'UINode' }] });
    const res = await applySceneOps([
      { op: 'set', entity: 1, fields: { 'UINode.position': 1, 'UINode.left.value': 40, 'UINode.top.value': 12 } },
    ]);
    expect(res.warnings).toBeUndefined();
  });
});
