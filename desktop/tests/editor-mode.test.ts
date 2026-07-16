// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The editor-mode registry + derivation (editorModes / activeMode). The mode
 *        is selection-derived with an optional explicit pin; it must reproduce the
 *        old implicit tilemap/transform behavior exactly (a tile tool wins ONLY when
 *        a tilemap is selected AND a paint tool is set), so resolveActiveTool stays
 *        byte-equivalent. SceneModel is mocked to drive the selection probe.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const model = vi.hoisted(() => ({
  entity: null as null | { components: { type: string; data: unknown }[] },
}));
vi.mock('@/engine/SceneModel', () => ({
  SceneModelImpl: class {},
  SceneModel: {
    subscribe: () => () => {},
    entityBySource: (id: number) => (id === 1 ? model.entity : null),
  },
}));

import { EDITOR_MODES, EDITOR_MODE_BY_ID } from '@/mode/editorModes';
import { suggestedMode, activeMode } from '@/mode/activeMode';
import { resolveActiveTool } from '@/tools';
import { TILE_TOOLS } from '@/tools/tileTools';
import { useSelection } from '@/store/selectionStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { useEditorMode } from '@/store/editorModeStore';
import { useEditorStore } from '@/store/editorStore';

const withComponents = (...types: string[]) => {
  model.entity = { components: types.map((type) => ({ type, data: {} })) };
  useSelection.getState().select(1);
};

describe('editor-mode registry + derivation', () => {
  beforeEach(() => {
    model.entity = null;
    useSelection.getState().select(1);
    useTilemapPaint.getState().setTool(null);
    useEditorMode.getState().clearPin();
    useEditorStore.getState().setTool('move');
  });

  it('has unique ids and exactly one fallback mode (Scene, last, no suggestFor)', () => {
    const ids = EDITOR_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fallbacks = EDITOR_MODES.filter((m) => !m.suggestFor);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].id).toBe('scene');
    expect(EDITOR_MODES[EDITOR_MODES.length - 1].id).toBe('scene');
  });

  it('UI mode reveals the widget palette + controllers panels on entry', () => {
    expect(EDITOR_MODE_BY_ID.ui.panels).toEqual([
      expect.objectContaining({ component: 'uiWidgets', side: 'left' }),
      expect.objectContaining({ component: 'controllers', side: 'left' }),
    ]);
  });

  it('suggests the mode implied by the selection', () => {
    withComponents('TilemapLayer');
    expect(suggestedMode().id).toBe('tilemap');
    withComponents('Canvas');
    expect(suggestedMode().id).toBe('ui');
    withComponents('UINode');
    expect(suggestedMode().id).toBe('ui');
    withComponents('Sprite');
    expect(suggestedMode().id).toBe('scene');
    model.entity = null; // nothing recognized selected
    expect(suggestedMode().id).toBe('scene');
  });

  it('resolves the highest-priority mode when a selection matches several (tilemap over ui)', () => {
    withComponents('TilemapLayer', 'Canvas');
    expect(suggestedMode().id).toBe('tilemap');
  });

  it('an explicit pin overrides the suggestion; clearPin reverts to it', () => {
    withComponents('TilemapLayer');
    expect(activeMode().id).toBe('tilemap');
    useEditorMode.getState().setMode('ui');
    expect(activeMode().id).toBe('ui');
    expect(EDITOR_MODE_BY_ID.ui.overlays?.designFrame).toBe(true);
    useEditorMode.getState().clearPin();
    expect(activeMode().id).toBe('tilemap');
  });

  it('resolveActiveTool routes to a paint tool ONLY in tilemap mode with a paint tool set', () => {
    const tileTools = Object.values(TILE_TOOLS);

    // tilemap selected, no paint tool → a transform tool, never a tile tool
    withComponents('TilemapLayer');
    useTilemapPaint.getState().setTool(null);
    expect(tileTools).not.toContain(resolveActiveTool());

    // tilemap selected + paint tool → that tile tool
    useTilemapPaint.getState().setTool('brush');
    expect(resolveActiveTool()).toBe(TILE_TOOLS.brush);

    // non-tilemap selection with a paint tool still set → transform (paint can't leak out)
    withComponents('Sprite');
    useTilemapPaint.getState().setTool('brush');
    expect(tileTools).not.toContain(resolveActiveTool());

    // pinned away from tilemap while a tilemap is selected → transform (pin wins)
    withComponents('TilemapLayer');
    useTilemapPaint.getState().setTool('brush');
    useEditorMode.getState().setMode('scene');
    expect(tileTools).not.toContain(resolveActiveTool());
  });
});
