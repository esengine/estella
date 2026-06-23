// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SelectionStore — model-anchored entity selection.
 *
 * Covers the pure selection ops and, crucially, the SELF-HEALING property that
 * lets every call site stop hand-clearing selection: when an entity is removed
 * from the model the selection store drops it — no manual deselect. The
 * self-healing test runs in its own isolated EditorSession (REARCH_EDITOR_MODEL
 * P2): the session's selection self-heals on its own model's `entityRemoved`.
 *
 * EngineHost is mocked to a headless World built from the WASM SDK (same harness
 * as engine-commands.test.ts); the session's reconciler projects into it.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { App } from 'esengine';
import type { ESEngineModule, SceneData } from 'esengine';
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

import { useSelection } from '@/store/selectionStore';
import { EditorSession } from '@/engine/EditorSession';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe('SelectionStore — pure selection ops', () => {
  const sel = () => useSelection.getState();
  beforeEach(() => sel().select(null));

  it('select / toggleSelect / selectMany maintain the set + primary', () => {
    sel().select(5);
    expect(sel().selectedId).toBe(5);
    expect([...sel().selectedIds]).toEqual([5]);

    sel().toggleSelect(6);
    expect(sel().selectedId).toBe(6);
    expect(sel().selectedIds.has(5)).toBe(true);
    expect(sel().selectedIds.has(6)).toBe(true);

    sel().toggleSelect(6); // removing the primary falls back to a remaining id
    expect(sel().selectedIds.has(6)).toBe(false);
    expect(sel().selectedId).toBe(5);

    sel().selectMany([1, 2, 3], 2);
    expect([...sel().selectedIds].sort()).toEqual([1, 2, 3]);
    expect(sel().selectedId).toBe(2);

    sel().select(null);
    expect(sel().selectedId).toBeNull();
    expect(sel().selectedIds.size).toBe(0);
  });

  it('dropId removes one id and re-picks the primary', () => {
    sel().selectMany([1, 2, 3], 2);
    sel().dropId(2); // drop the primary
    expect(sel().selectedIds.has(2)).toBe(false);
    expect(sel().selectedIds.size).toBe(2);
    expect(sel().selectedId).toBe(3); // last of the remaining

    sel().dropId(1); // drop a non-primary
    expect(sel().selectedId).toBe(3);
    expect(sel().selectedIds.size).toBe(1);

    sel().dropId(3);
    expect(sel().selectedId).toBeNull();
    expect(sel().selectedIds.size).toBe(0);

    sel().dropId(99); // no-op on an unselected id
    expect(sel().selectedId).toBeNull();
  });
});

describe.skipIf(!HAS_WASM)('SelectionStore — model-anchored self-healing', () => {
  let S: EditorSession;
  const sel = () => S.selection.getState();
  // One World for the block; a fresh session per test isolates selection + model.
  beforeAll(async () => {
    const module: ESEngineModule = await loadWasmModule();
    const app = App.new();
    const registry = new module.Registry();
    app.connectCpp(registry as never, module);
    host.world = app.world;
  });
  beforeEach(() => {
    S = EditorSession.create();
    S.model.adopt(emptyScene(), new Map());
  });

  it('a deleted entity auto-drops from the selection via the model', () => {
    const id = S.commands.addEntity()!;
    sel().select(id);
    expect(sel().selectedId).toBe(id);

    // Delete via the command path → model entityRemoved → selection.dropId.
    S.commands.deleteEntity(id);
    expect(sel().selectedId).toBeNull();
    expect(sel().selectedIds.size).toBe(0);
  });

  it('deleting one of a multi-selection keeps the survivors selected', () => {
    const a = S.commands.addEntity()!;
    const b = S.commands.addEntity()!;
    sel().selectMany([a, b], b);
    expect(sel().selectedIds.size).toBe(2);

    S.commands.deleteEntity(b); // model drops b; a survives and becomes primary
    expect(sel().selectedIds.has(b)).toBe(false);
    expect(sel().selectedIds.has(a)).toBe(true);
    expect(sel().selectedId).toBe(a);
  });
});
