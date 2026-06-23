// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorGrid.ts
 * @brief   Editor viewport reference grid — an editor-only render feature.
 *
 * Like EditorView, this is NOT a scene entity: never serialized, never on the
 * undo stack, never part of a shipped game (which leaves `enabled` false and so
 * never pays for it). The editor flips `enabled` / `spacing` from its Show-Flags
 * and Snap controls; the grid renderer (installEditorGrid) draws an infinite
 * world-space grid through the editor camera's view-projection in the pre-scene
 * pass — so it pans / zooms with the view and is occluded by scene entities,
 * exactly like a UE5 / Unity scene grid.
 *
 * Colors are straight-alpha RGBA in 0..1. `spacing` is the minor line spacing in
 * world units; every `majorEvery`-th line is a heavier major line. The world
 * x=0 / y=0 axis lines use the axis colors (red X / green Y) so the origin reads
 * at a glance.
 */
import { defineResource } from '../resource';

export type GridColor = [number, number, number, number];

export interface EditorGridData {
  /** When true (editor only), the grid renderer draws the grid this frame. */
  enabled: boolean;
  /** Minor grid line spacing, world units. */
  spacing: number;
  /** Every Nth line is drawn as a heavier major line. */
  majorEvery: number;
  /** Minor line color. */
  color: GridColor;
  /** Major line color. */
  majorColor: GridColor;
  /** World y=0 (horizontal) X-axis line color. */
  axisX: GridColor;
  /** World x=0 (vertical) Y-axis line color. */
  axisY: GridColor;
}

export const DEFAULT_EDITOR_GRID: EditorGridData = {
  enabled: false,
  spacing: 32,
  majorEvery: 10,
  color: [1, 1, 1, 0.05],
  majorColor: [1, 1, 1, 0.1],
  axisX: [0.812, 0.357, 0.325, 0.55], // --ax-x #cf5b53
  axisY: [0.502, 0.725, 0.29, 0.55], // --ax-y #80b94a
};

export const EditorGrid = defineResource<EditorGridData>({ ...DEFAULT_EDITOR_GRID }, 'EditorGrid');
