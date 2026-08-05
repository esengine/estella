// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A scene with content and no camera is a black game.
 *
 * The editor renders through a view of its own, so a cameraless scene looks
 * finished in the viewport and draws nothing the moment Play starts. From a
 * dogfood run: an agent built a 116-entity chess board, ran it, and got a black
 * frame with no error — the diagnostics sweep had nothing to say about the one
 * thing that was wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneNode } from '@/types';

const h = { tree: [] as SceneNode[] };

vi.mock('../src/engine/EngineHost', () => ({ EngineHost: {} }));

const node = (id: number, name: string, kind: string, children: SceneNode[] = []): SceneNode =>
  ({ id, name, kind, visible: true, locked: false, children } as SceneNode);

const surface = {
  s: {
    query: {
      readSceneTree: () => h.tree,
      readInspector: () => [],
    },
  },
};

// The sweep under test, bound to the stub session.
const { EditorControlSurfaceImpl } = await import('@/engine/EditorControlSurface');
const getDiagnostics = (): Array<{ component: string; detail: string }> =>
  EditorControlSurfaceImpl.prototype.getDiagnostics.call(surface as never);

beforeEach(() => { h.tree = []; });

describe('the camera a scene needs to be seen at all', () => {
  it('says so when content has no camera anywhere', () => {
    h.tree = [node(1, 'Board', 'group', [node(2, 'a1', 'sprite')])];
    const found = getDiagnostics().filter((d: { component: string }) => d.component === 'Camera');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('renders NOTHING');
  });

  it('says nothing when a camera is there, however deep', () => {
    h.tree = [node(1, 'Board', 'group', [node(2, 'a1', 'sprite'), node(3, 'Cam', 'camera')])];
    expect(getDiagnostics().filter((d: { component: string }) => d.component === 'Camera')).toHaveLength(0);
  });

  // An empty scene is a scene being started, not a mistake to nag about.
  it('says nothing about an empty scene', () => {
    h.tree = [];
    expect(getDiagnostics()).toHaveLength(0);
  });

  it('says nothing about a scene that is only a camera', () => {
    h.tree = [node(1, 'Cam', 'camera')];
    expect(getDiagnostics().filter((d: { component: string }) => d.component === 'Camera')).toHaveLength(0);
  });
});
