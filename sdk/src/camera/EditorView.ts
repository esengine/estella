// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorView.ts
 * @brief   Editor viewport camera — a dedicated, editor-only 2D view.
 *
 * This is NOT a scene entity: it is never serialized, never on the undo stack,
 * and never part of the saved scene. When `active`, the camera system renders
 * the framebuffer through this view and drives all screen<->world queries from
 * it (CameraView / UICameraInfo) INSTEAD of the scene's game Camera entities —
 * so editor navigation (pan / zoom / frame) moves only this view and never the
 * scene's camera. In play mode it is deactivated, so the viewport shows the real
 * game camera (the true "Game" view). The editor mutates x / y / orthoSize.
 *
 * The view's view-projection is built from the SAME math primitives as scene
 * cameras (see CameraPlugin) — there is one source of view-projection math; only
 * the camera *configuration* (full-frame, raw orthoSize) differs.
 */
import { defineResource } from '../resource';

export interface EditorViewData {
  /** When true, the framebuffer + screen<->world use this view, not scene cameras. */
  active: boolean;
  /** World-space camera center. */
  x: number;
  y: number;
  /** Half-height of the view in world units (zoom; smaller = more zoomed in). */
  orthoSize: number;
}

export const DEFAULT_EDITOR_VIEW: EditorViewData = { active: false, x: 0, y: 0, orthoSize: 360 };

export const EditorView = defineResource<EditorViewData>({ ...DEFAULT_EDITOR_VIEW }, 'EditorView');
