// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  activeMode.ts — derives the active editor mode from the selection + an
 *        optional pin. Mirrors tileMode.ts: reads live store state (never a
 *        subscription) so callers in the pointer path / rAF stay allocation-cheap.
 */
import { SceneModel } from '@/engine/SceneModel';
import { useSelection } from '@/store/selectionStore';
import { useEditorMode } from '@/store/editorModeStore';
import { editorModes, modeById, FALLBACK_MODE, type EditorModeDef, type SelectionProbe } from './editorModes';

/** The active selection's component membership, for a mode's `suggestFor`. */
function probe(): SelectionProbe {
  const id = useSelection.getState().selectedId;
  const comps = id != null ? SceneModel.entityBySource(id)?.components : undefined;
  return { hasComponent: (type) => !!comps?.some((c) => c.type === type) };
}

/** The mode the current selection implies (first matching in priority order, else Scene). */
export function suggestedMode(): EditorModeDef {
  const p = probe();
  return editorModes().find((m) => m.suggestFor?.(p)) ?? FALLBACK_MODE;
}

/** The effective mode: an explicit pin wins, else the selection-suggested mode. A pin
 *  naming a mode that's gone (a plugin unloaded while pinned) falls back to derivation. */
export function activeMode(): EditorModeDef {
  const pinned = useEditorMode.getState().pinned;
  return (pinned ? modeById(pinned) : undefined) ?? suggestedMode();
}

/** The active mode's overlay flags, never undefined (for the viewport rAF gate). */
export function activeModeOverlays(): NonNullable<EditorModeDef['overlays']> {
  return activeMode().overlays ?? {};
}
