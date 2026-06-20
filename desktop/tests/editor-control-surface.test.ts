/**
 * @file  Regression net for EditorControlSurface — the one canonical
 *        programmatic entry to the editor (docs/REARCH_EDITOR_AUTOMATION.md).
 *        Proves the surface delegates correctly to the command/query core and
 *        that step() drives deterministic ticks, all against a real headless
 *        World. captureViewport needs a WebGL2 canvas, so here we only assert it
 *        fails clearly without a render host (covered end-to-end by the headless
 *        editor window, not the pure-node harness).
 *
 * EngineHost (the boot singleton that needs a canvas) is mocked to a per-test
 * headless World; tick() drives the real App so step() exercises the engine.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { App, Transform } from 'esengine';
import type { ESEngineModule } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

// Per-test state, injected into the mocked EngineHost. `vi.hoisted` so the mock
// factory (hoisted above imports) can close over it.
const host = vi.hoisted(() => ({
  world: null as unknown as App['world'],
  app: null as unknown as App,
  ticks: 0,
  runMode: null as null | [boolean, boolean],
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: {
    mutableWorld: () => host.world,
    get world() {
      return host.world;
    },
    getResource: () => undefined,
    get canvas() {
      return null; // no render host in the node harness → captureViewport must fail clearly
    },
    tick: async (dt: number) => {
      host.ticks++;
      await host.app?.tick(dt);
    },
    setRunMode: (playing: boolean, paused: boolean) => {
      host.runMode = [playing, paused];
      return false;
    },
    loadScene: async () => 0,
  },
}));

import { EditorControlSurface as API } from '@/engine/EditorControlSurface';
import { EditorHistory } from '@/engine/EditorHistory';

describe.skipIf(!HAS_WASM)('EditorControlSurface (headless World)', () => {
  let module: ESEngineModule;
  beforeAll(async () => {
    module = await loadWasmModule();
  });
  beforeEach(() => {
    const app = App.new();
    const registry = new module.Registry();
    app.connectCpp(registry as never, module);
    host.world = app.world;
    host.app = app;
    host.ticks = 0;
    host.runMode = null;
    EditorHistory.clear();
  });

  it('addEntity surfaces through the scene tree and stats', () => {
    const id = API.addEntity();
    expect(id).not.toBeNull();
    expect(API.getSceneTree().length).toBe(1);
    expect(API.getStats().entities).toBe(1);
  });

  it('setField writes a component field; surface undo reverts it', () => {
    const id = API.addEntity()!;
    API.setField(id, 'Transform', 'position', 'vec3', [10, 20, 30]);
    expect(host.world.get(id, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });
    API.undo();
    expect(host.world.get(id, Transform).position).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('step(n) drives exactly n deterministic ticks', async () => {
    await API.step(3, 1 / 60);
    expect(host.ticks).toBe(3);
  });

  it('setRunMode delegates play/pause state to the host', () => {
    API.setRunMode(true, true);
    expect(host.runMode).toEqual([true, true]);
  });

  it('captureViewport fails clearly without a render host', () => {
    expect(() => API.captureViewport()).toThrow(/render host/);
  });
});
