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
 *
 * The built-in table below is this module's REGISTRATION input; reads go through
 * {@link editorModes} / {@link modeById}, so a plugin-contributed mode is seen by
 * the activity bar, the tool router, and the mode commands alike.
 */
import type { LucideIcon } from 'lucide-react';
import { MousePointer2, LayoutPanelTop, Grid3x3 } from 'lucide-react';
import { t } from '@/i18n';
import { ContributionRegistry } from '@/contrib/ContributionRegistry';

/** The modes the editor ships. Plugin modes widen this at runtime. */
export type BuiltinEditorModeId = 'scene' | 'ui' | 'tilemap';
/** A mode id: one of the built-ins, or a plugin-contributed one. */
export type EditorModeId = BuiltinEditorModeId | (string & {});

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
  /** Short name (activity-bar tooltip, viewport badge), e.g. 'Tilemap'. */
  label: string;
  /** Label for the mode's switch command / palette row, e.g. 'Tilemap Mode'.
   *  Carried by the def rather than derived from the id, so a contributed mode
   *  isn't forced to own an entry in the editor's compile-time message catalog. */
  commandLabel: string;
  icon: LucideIcon;
  /** Which tool family the viewport routes pointer input to (resolveActiveTool).
   *  Stays a closed set until the tool registry lands — an unrouted toolset name
   *  would silently fall back to transform, which is worse than a compile error. */
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
  commandLabel: t('cmd.mode.tilemap'),
  icon: Grid3x3,
  toolset: 'tilemap',
  panels: [{ id: 'tilemap', component: 'tilemap', title: t('panel.tilemap'), side: 'left', width: 300 }],
  suggestFor: (s) => s.hasComponent('TilemapLayer'),
};

const uiMode: EditorModeDef = {
  id: 'ui',
  label: t('mode.ui'),
  commandLabel: t('cmd.mode.ui'),
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
  commandLabel: t('cmd.mode.scene'),
  icon: MousePointer2,
  toolset: 'transform',
};

/** Suggestion priority: the first mode whose `suggestFor` matches wins; sceneMode is the fallback. */
export const EDITOR_MODES: EditorModeDef[] = [tilemapMode, uiMode, sceneMode];

export const EDITOR_MODE_BY_ID: Record<BuiltinEditorModeId, EditorModeDef> = {
  scene: sceneMode,
  ui: uiMode,
  tilemap: tilemapMode,
};

/** The fallback mode — always present, so mode resolution never returns undefined. */
export const FALLBACK_MODE = sceneMode;

const modeContrib = new ContributionRegistry<EditorModeDef>('editor mode');
modeContrib.registerAll('core', EDITOR_MODES);

export const editorModeRegistry = modeContrib;

/**
 * Every editing mode, built-ins first in suggestion-priority order, then contributed
 * ones — so a plugin mode can never outrank a built-in suggestion. A mode without
 * `suggestFor` is simply never suggested (activeMode falls back to {@link FALLBACK_MODE}),
 * which is why sceneMode's position in the list is immaterial.
 */
export function editorModes(): readonly EditorModeDef[] {
  return modeContrib.all();
}

export function modeById(id: EditorModeId): EditorModeDef | undefined {
  return modeContrib.get(id);
}
