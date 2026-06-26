// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editor-grid.test.ts
 * @brief   Editor reference grid: resource defaults, the pre-scene draw registry,
 *          and installEditorGrid's wiring + disabled-state no-op (no GL needed).
 *
 * The enabled draw path needs a live WebGL/wasm context (shader + mesh), so it is
 * a live feel-check, not a unit test. Here we prove the resource contract, the
 * pre-scene seam, and that the grid stays a safe no-op until enabled + active.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { EditorGrid, DEFAULT_EDITOR_GRID } from '../src/camera/EditorGrid';
import { EditorView } from '../src/camera/EditorView';
import { installEditorGrid } from '../src/camera/editorGridRenderer';
import {
  registerPreSceneDrawCallback,
  unregisterPreSceneDrawCallback,
  getPreSceneDrawCallbacks,
} from '../src/customDraw';

// Minimal App surface installEditorGrid + the grid callback actually touch.
function stubApp() {
  const res = new Map<unknown, unknown>();
  return {
    hasResource: (d: unknown) => res.has(d),
    insertResource: (d: unknown, v: unknown) => {
      res.set(d, v);
    },
    getResource: (d: unknown) => res.get(d),
  };
}

describe('EditorGrid resource', () => {
  it('ships disabled with a 32-unit minor / 10× major grid', () => {
    expect(DEFAULT_EDITOR_GRID.enabled).toBe(false);
    expect(DEFAULT_EDITOR_GRID.spacing).toBe(32);
    expect(DEFAULT_EDITOR_GRID.majorEvery).toBe(10);
    expect(DEFAULT_EDITOR_GRID.color).toHaveLength(4);
  });
});

describe('pre-scene draw registry', () => {
  beforeEach(() => {
    unregisterPreSceneDrawCallback('editor:grid');
    unregisterPreSceneDrawCallback('t');
  });

  it('register / get / unregister a pre-scene callback', () => {
    const fn = () => {
      /* noop */
    };
    registerPreSceneDrawCallback('t', fn);
    expect(getPreSceneDrawCallbacks().get('t')).toBe(fn);
    unregisterPreSceneDrawCallback('t');
    expect(getPreSceneDrawCallbacks().has('t')).toBe(false);
  });
});

describe('installEditorGrid', () => {
  beforeEach(() => {
    unregisterPreSceneDrawCallback('editor:grid');
  });

  it('inserts the EditorGrid resource and registers the pre-scene grid pass', () => {
    const app = stubApp();
    installEditorGrid(app as never);
    expect(app.hasResource(EditorGrid)).toBe(true);
    expect(getPreSceneDrawCallbacks().has('editor:grid')).toBe(true);
  });

  it('does not overwrite an existing EditorGrid resource', () => {
    const app = stubApp();
    app.insertResource(EditorGrid, { ...DEFAULT_EDITOR_GRID, spacing: 64 });
    installEditorGrid(app as never);
    expect((app.getResource(EditorGrid) as { spacing: number }).spacing).toBe(64);
  });

  it('the grid pass is a safe no-op while disabled (touches no GL)', () => {
    const app = stubApp();
    app.insertResource(EditorView, { active: true, x: 0, y: 0, orthoSize: 360 });
    installEditorGrid(app as never); // inserts EditorGrid disabled by default
    const cb = getPreSceneDrawCallbacks().get('editor:grid')!;
    expect(() => cb({ width: 800, height: 600, elapsed: 0 })).not.toThrow();
  });
});
