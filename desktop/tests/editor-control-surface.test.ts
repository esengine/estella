// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression net for EditorControlSurface — the one canonical
 *        programmatic entry to a session (REARCH_EDITOR_MODEL.md P2 +
 *        docs/REARCH_EDITOR_AUTOMATION.md). Proves the surface delegates to its
 *        session's command/query core and that step() drives deterministic ticks,
 *        all against a real headless World. captureViewport needs a WebGL2 canvas,
 *        so here we only assert it fails clearly without a render host (covered
 *        end-to-end by the headless editor window, not the pure-node harness).
 *
 * Each test uses its own isolated EditorSession; the engine (boot singleton that
 * needs a canvas) is mocked to a per-test headless World; tick() drives the real
 * App so step() exercises the engine.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App, Transform, Sprite, migratePrefabData } from 'esengine';
import type { ESEngineModule, PrefabData } from 'esengine';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

// Per-test state, injected into the mocked EngineHost. `vi.hoisted` so the mock
// factory (hoisted above imports) can close over it.
const host = vi.hoisted(() => ({
  world: null as unknown as App['world'],
  app: null as unknown as App,
  ticks: 0,
  runMode: null as null | [boolean, boolean],
  // null by default (no render host); a test that needs one substitutes a stub.
  canvas: null as null | { width: number; height: number; style: Record<string, string> },
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: {
    mutableWorld: () => host.world,
    get world() {
      return host.world;
    },
    getResource: () => undefined,
    get canvas() {
      return host.canvas; // null by default → captureViewport must fail clearly
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

import { EditorSession } from '@/engine/EditorSession';
import type { SceneData } from 'esengine';

const emptyScene = (): SceneData =>
  ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('EditorControlSurface (headless World)', () => {
  let module: ESEngineModule;
  let S: EditorSession;
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
    host.canvas = null;
    S = EditorSession.create();
    S.model.adopt(emptyScene(), new Map());
  });

  afterEach(() => S.dispose());

  it('addEntity surfaces through the scene tree and stats', () => {
    const id = S.surface.addEntity();
    expect(id).not.toBeNull();
    expect(S.surface.getSceneTree().length).toBe(1);
    expect(S.surface.getStats().entities).toBe(1);
  });

  it('create() spawns a ready-made entity into model + World (headless, not just blank)', () => {
    const prefab = migratePrefabData({
      version: '1.0', name: 'Hero', rootEntityId: 'root',
      entities: [{ prefabEntityId: 'root', name: 'Hero', parent: null, children: [], components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: {} }], visible: true }],
    }).data as PrefabData;
    const id = S.surface.create(prefab, { parent: null })!;
    expect(id).not.toBeNull();
    expect(S.surface.getSceneTree().length).toBe(1);
    expect(host.world.has(S.model.runtimeFor(id)!, Sprite)).toBe(true);
  });

  it('getEntity reports the prefab link, so an instance is not indistinguishable from any entity', () => {
    const prefab = migratePrefabData({
      version: '1.0', name: 'Coin', rootEntityId: 'root',
      entities: [
        { prefabEntityId: 'root', name: 'Coin', parent: null, children: ['art'], components: [{ type: 'Transform', data: {} }], visible: true },
        { prefabEntityId: 'art', name: 'Art', parent: 'root', children: [], components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: {} }], visible: true },
      ],
    }).data as PrefabData;
    const root = S.surface.create(prefab, { parent: null, linkPrefabRef: '@uuid:coin-uuid' })!;
    const child = S.surface.getSceneTree()[0].children![0].id;

    // The root carries the asset ref; a member resolves it through its instance root.
    expect(S.surface.getEntity(root)?.prefab).toMatchObject({ ref: '@uuid:coin-uuid', isRoot: true, instanceRoot: root });
    expect(S.surface.getEntity(child)?.prefab).toMatchObject({ ref: '@uuid:coin-uuid', isRoot: false, instanceRoot: root });
    // An ordinary entity says nothing at all — absent, not a false link.
    expect(S.surface.getEntity(S.surface.addEntity()!)?.prefab).toBeUndefined();
  });

  it('setField writes a component field; surface undo reverts it', () => {
    const id = S.surface.addEntity()!; // source id
    const e = S.model.runtimeFor(id)!; // runtime World entity
    S.surface.setField(id, 'Transform', 'position', 'vec3', [10, 20, 30]);
    expect(host.world.get(e, Transform).position).toMatchObject({ x: 10, y: 20, z: 30 });
    S.surface.undo();
    expect(host.world.get(e, Transform).position).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('step(n) drives exactly n deterministic ticks', async () => {
    await S.surface.step(3, 1 / 60);
    expect(host.ticks).toBe(3);
  });

  it('setField coerces JSON-text and object spellings against the DECLARED field type', () => {
    const id = S.surface.addEntity()!;
    const e = S.model.runtimeFor(id)!;
    S.surface.addComponent(id, 'Sprite');
    // Schema-loose MCP clients serialize a vec2 to its JSON text — it must land
    // as numbers, never be indexed per-character.
    S.surface.setField(id, 'Sprite', 'size', 'vec2', '[16, 16]');
    expect(host.world.get(e, Sprite).size).toMatchObject({ x: 16, y: 16 });
    S.surface.setField(id, 'Sprite', 'size', 'vec2', { x: 24, y: 32 } as never);
    expect(host.world.get(e, Sprite).size).toMatchObject({ x: 24, y: 32 });
    // Numeric fields coerce string digits; the caller's `type` hint is advisory
    // (an honest 'int' must not bypass the declared 'number' conversion).
    S.surface.setField(id, 'Sprite', 'layer', 'number', '5');
    expect(host.world.get(e, Sprite).layer).toBe(5);
  });

  it('setField rejects unknown components, unknown keys, and malformed values loudly', () => {
    const id = S.surface.addEntity()!;
    S.surface.addComponent(id, 'Sprite');
    expect(() => S.surface.setField(id, 'Rigidbody2D', 'mass', 'number', 1)).toThrow(/not on entity/);
    expect(() => S.surface.setField(id, 'Sprite', 'sizes', 'number', 16)).toThrow(/no field/);
    expect(() => S.surface.setField(id, 'Sprite', 'size.w', 'number', 16)).toThrow(/no field/);
    expect(() => S.surface.setField(id, 'Sprite', 'size', 'vec2', 'garbage')).toThrow(/expects/);
  });

  it('describeComponent refuses a name nothing declares, rather than answering "no fields"', () => {
    // The empty list was indistinguishable from a real component with nothing on
    // it, so a caller asking about the component it was about to write read the
    // answer as a description and carried on.
    expect(S.surface.describeComponent('Sprite').length).toBeGreaterThan(0);
    expect(() => S.surface.describeComponent('ChessPiece')).toThrow(/no component schema named/);
    expect(() => S.surface.describeComponent('ChessPiece')).toThrow(/defineComponent/);
    // No name at all is still the catalog, not a refusal.
    expect(S.surface.describeComponent().length).toBeGreaterThan(0);
  });

  it('setField writes ONE member of a structural field, leaving the rest', () => {
    const id = S.surface.addEntity()!;
    S.surface.addComponent(id, 'Sprite');
    const e = S.model.runtimeFor(id)!;
    const before = { ...host.world.get(e, Sprite).size };

    S.surface.setField(id, 'Sprite', 'size.x', 'number', 16);
    expect(host.world.get(e, Sprite).size.x).toBe(16);
    expect(host.world.get(e, Sprite).size.y).toBe(before.y);
  });

  it('getDiagnostics flags a required-empty field (Details parity) and clears when set', () => {
    const id = S.surface.addEntity()!;
    S.surface.addComponent(id, 'Sprite'); // Sprite.texture is required, defaults empty
    const found = S.surface.getDiagnostics();
    expect(found).toContainEqual(
      expect.objectContaining({ entity: id, component: 'Sprite', field: 'texture', problem: 'required-empty' }),
    );
    S.surface.setField(id, 'Sprite', 'texture', 'asset', 'assets/player.png');
    expect(
      S.surface.getDiagnostics().filter((d) => d.entity === id && d.problem === 'required-empty'),
    ).toHaveLength(0);
  });

  it('setRunMode delegates play/pause state to the host', () => {
    S.surface.setRunMode(true, true);
    expect(host.runMode).toEqual([true, true]);
  });

  it('captureViewport fails clearly without a render host', () => {
    expect(() => S.surface.captureViewport()).toThrow(/render host/);
  });

  it('outliner ops — folders / visibility / lock / reorder — round-trip + undo', () => {
    const a = S.surface.addEntity()!;
    const b = S.surface.addEntity()!;

    S.surface.createFolder('Enemies');
    expect(S.surface.getSceneFolders()).toContain('Enemies');
    S.surface.moveToFolder([a], 'Enemies');
    expect(S.surface.getEntityFolder(a)).toBe('Enemies');

    S.surface.setEntityHidden(a, true);
    expect(S.surface.isEntityHidden(a)).toBe(true);
    S.surface.setEntityLocked(b, true);
    expect(S.surface.isEntityLocked(b)).toBe(true);

    expect(S.model.entityOrder()).toEqual([a, b]);
    S.surface.reorderEntity(b, a, true); // b before a (one undo step)
    expect(S.model.entityOrder()).toEqual([b, a]);
    S.surface.undo();
    expect(S.model.entityOrder()).toEqual([a, b]);
  });

  it('selection — select / multi / clear, and self-heals when the selected entity is deleted', () => {
    const a = S.surface.addEntity()!;
    const b = S.surface.addEntity()!;
    S.surface.select(a);
    expect(S.surface.getSelection()).toBe(a);
    S.surface.selectMany([a, b], b);
    expect(S.surface.getSelection()).toBe(b);
    expect([...S.surface.getSelectionIds()].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
    S.surface.deleteEntity(b); // the model drops b from the selection
    expect(S.surface.getSelection()).not.toBe(b);
    S.surface.select(null);
    expect(S.surface.getSelection()).toBeNull();
  });

  it('resizeViewport sets the drawing buffer and leaves CSS sizing to layout', () => {
    // The canvas is laid out at width/height:100% of its panel. Writing a pixel
    // CSS size here detaches it from that container for good: the panel keeps
    // growing, the canvas does not, and every later frame is drawn stretched
    // into a stale box. Only the drawing buffer is this door's business.
    host.canvas = { width: 300, height: 150, style: { width: '100%', height: '100%' } };
    S.surface.resizeViewport(1280, 720);
    expect(host.canvas.width).toBe(1280);
    expect(host.canvas.height).toBe(720);
    expect(host.canvas.style.width).toBe('100%');
    expect(host.canvas.style.height).toBe('100%');
  });

  it('resizeViewport fails clearly with no render host', () => {
    expect(() => S.surface.resizeViewport(64, 64)).toThrow(/render host/);
  });

  it('subscribeSelection fires on change and stops after unsubscribe', () => {
    const a = S.surface.addEntity()!;
    let n = 0;
    const off = S.surface.subscribeSelection(() => { n++; });
    S.surface.select(a);
    expect(n).toBeGreaterThan(0);
    off();
    const before = n;
    S.surface.select(null);
    expect(n).toBe(before);
  });
});
