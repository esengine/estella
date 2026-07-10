// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tools/index.ts
 * @brief Resolves the active viewport tool from editor state. A tilemap paint tool
 *        wins when a TilemapLayer is selected (it must not re-pick/select); else
 *        the transform tool (select/move/rotate/scale) is active. The Viewport
 *        calls this per pointer-down and routes the stroke to the returned tool.
 */
import { useEditorStore } from '@/store/editorStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { TRANSFORM_TOOLS } from './transformTools';
import { TILE_TOOLS } from './tileTools';
import { isTilePaintMode } from './tileMode';
import type { EditorTool } from './EditorTool';

export function resolveActiveTool(): EditorTool {
  if (isTilePaintMode()) return TILE_TOOLS[useTilemapPaint.getState().tool!];
  return TRANSFORM_TOOLS[useEditorStore.getState().tool] ?? TRANSFORM_TOOLS.select;
}

export type { EditorTool, PointerInput, ToolContext } from './EditorTool';
export { isTilemapSelected, isTilePaintMode } from './tileMode';
