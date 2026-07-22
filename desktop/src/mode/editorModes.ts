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
import { t } from '@/i18n';

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
  /** Dock as a TAB in another mode-panel's group (by id) instead of its own column —
   *  keeps a companion (e.g. Controllers) one click away without eating a second column
   *  of viewport width. Falls back to `side` if that panel isn't open. */
  tabWith?: string;
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
  label: t('mode.tilemap'),
  icon: Grid3x3,
  toolset: 'tilemap',
  panels: [{ id: 'tilemap', component: 'tilemap', title: t('panel.tilemap'), side: 'left', width: 300 }],
  suggestFor: (s) => s.hasComponent('TilemapLayer'),
};

const uiMode: EditorModeDef = {
  id: 'ui',
  label: t('mode.ui'),
  icon: LayoutPanelTop,
  toolset: 'transform',
  panels: [
    { id: 'ui-widgets', component: 'uiWidgets', title: t('panel.uiWidgets'), side: 'left', width: 240 },
    // The Controllers panel is node-scoped and reached occasionally — tab it behind the
    // widget palette (one left column, two tabs) so entering UI mode doesn't eat a second
    // column of the viewport you're laying out in.
    { id: 'controllers', component: 'controllers', title: t('panel.controllers'), tabWith: 'ui-widgets', side: 'left', width: 240 },
  ],
  overlays: { designFrame: true, safeArea: true, letterbox: true },
  suggestFor: (s) => s.hasComponent('Canvas') || s.hasComponent('UINode'),
};

const sceneMode: EditorModeDef = {
  id: 'scene',
  label: t('mode.scene'),
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
