// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editorModes.ts — THE authority for editor editing modes (the sibling of
 *        entitySources' ENTITY_SOURCES). One data-driven table replaces the
 *        implicit "which editing context am I in" logic that used to be scattered
 *        across resolveActiveTool / isTilePaintMode / App's tilemap auto-open.
 *
 * A mode declares its tool family, the companion panels it reveals on entry, the
 * viewport overlays it turns on, and a `suggestFor` predicate over the current
 * selection. The active mode is selection-derived (see activeMode.ts) with an
 * optional explicit pin (editorModeStore) — adding a mode here wires it everywhere.
 */
import type { LucideIcon } from 'lucide-react';
import { MousePointer2, LayoutPanelTop, Grid3x3 } from 'lucide-react';

export type EditorModeId = 'scene' | 'ui' | 'tilemap';

/** The current selection's component membership — all a mode's `suggestFor` needs. */
export interface SelectionProbe {
  hasComponent(type: string): boolean;
}

/** A companion panel a mode reveals when entered (routed through dockApi.openSidePanel). */
export interface ModePanel {
  id: string;
  component: string;
  title: string;
  side?: 'left' | 'right';
  width?: number;
}

export interface EditorModeDef {
  id: EditorModeId;
  label: string;
  icon: LucideIcon;
  /** Which tool family the viewport routes pointer input to (resolveActiveTool). */
  toolset: 'transform' | 'tilemap';
  /** Companion panels revealed on entering the mode. */
  panels?: ModePanel[];
  /** Viewport overlays this mode turns on. */
  overlays?: { designFrame?: boolean; safeArea?: boolean; letterbox?: boolean };
  /** True when the selection should suggest this mode. Omitted ⇒ the fallback (always last). */
  suggestFor?(sel: SelectionProbe): boolean;
}

const tilemapMode: EditorModeDef = {
  id: 'tilemap',
  label: 'Tilemap',
  icon: Grid3x3,
  toolset: 'tilemap',
  panels: [{ id: 'tilemap', component: 'tilemap', title: 'Tilemap', side: 'left', width: 300 }],
  suggestFor: (s) => s.hasComponent('TilemapLayer'),
};

const uiMode: EditorModeDef = {
  id: 'ui',
  label: 'UI',
  icon: LayoutPanelTop,
  toolset: 'transform',
  panels: [{ id: 'ui-widgets', component: 'uiWidgets', title: 'UI Widgets', side: 'left', width: 240 }],
  overlays: { designFrame: true, safeArea: true, letterbox: true },
  suggestFor: (s) => s.hasComponent('Canvas') || s.hasComponent('UINode'),
};

const sceneMode: EditorModeDef = {
  id: 'scene',
  label: 'Scene',
  icon: MousePointer2,
  toolset: 'transform',
};

/** Suggestion priority: the first mode whose `suggestFor` matches wins; sceneMode is the fallback. */
export const EDITOR_MODES: EditorModeDef[] = [tilemapMode, uiMode, sceneMode];

export const EDITOR_MODE_BY_ID: Record<EditorModeId, EditorModeDef> = {
  scene: sceneMode,
  ui: uiMode,
  tilemap: tilemapMode,
};
