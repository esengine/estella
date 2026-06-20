/**
 * @file  SelectionStore — engine-anchored entity selection.
 *
 * Covers the pure selection ops and, crucially, the SELF-HEALING property that
 * lets every call site stop hand-clearing selection: when an entity is despawned
 * the scene bridge carries its id to the store, which drops it — no manual
 * deselect, no world.valid() race (the despawn notify fires before removal).
 *
 * EngineHost is mocked to a headless World built from the WASM SDK (same harness
 * as engine-commands.test.ts); SceneStore + SceneCommands run for real.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { App } from 'esengine';
import type { ESEngineModule } from 'esengine';
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
import { SceneStore } from '@/engine/SceneStore';
import { SceneCommands } from '@/engine/SceneCommands';

const sel = () => useSelection.getState();

describe('SelectionStore — pure selection ops', () => {
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

describe.skipIf(!HAS_WASM)('SelectionStore — engine-anchored self-healing', () => {
  // One World + one bridge install for the whole block, so the default context
  // (which notifyBridge reads) stays consistent across tests.
  beforeAll(async () => {
    const module: ESEngineModule = await loadWasmModule();
    const app = App.new();
    const registry = new module.Registry();
    app.connectCpp(registry as never, module);
    host.world = app.world;
    SceneStore.install();
  });
  beforeEach(() => sel().select(null));

  it('a deleted entity auto-drops from the selection via the scene bridge', () => {
    const id = SceneCommands.addEntity()!;
    sel().select(id);
    expect(sel().selectedId).toBe(id);

    // Delete via the command path → world.despawn → onEntityDespawned bridge →
    // SelectionStore.dropId. The selection clears itself, no manual deselect.
    SceneCommands.deleteEntity(id);
    expect(sel().selectedId).toBeNull();
    expect(sel().selectedIds.size).toBe(0);
  });

  it('deleting one of a multi-selection keeps the survivors selected', () => {
    const a = SceneCommands.addEntity()!;
    const b = SceneCommands.addEntity()!;
    sel().selectMany([a, b], b);
    expect(sel().selectedIds.size).toBe(2);

    SceneCommands.deleteEntity(b); // bridge drops b; a survives and becomes primary
    expect(sel().selectedIds.has(b)).toBe(false);
    expect(sel().selectedIds.has(a)).toBe(true);
    expect(sel().selectedId).toBe(a);
  });
});
