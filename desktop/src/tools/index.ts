// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tools/index.ts
 * @brief Resolves the active viewport tool from the active editor mode. Tilemap
 *        mode routes to a paint tool (when one is set — it must not re-pick/select);
 *        every other mode routes to the transform tool (select/move/rotate/scale).
 *        The Viewport calls this per pointer-down and routes the stroke to it.
 */
import { useEditorStore } from '@/store/editorStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { activeMode } from '@/mode/activeMode';
import { TRANSFORM_TOOLS } from './transformTools';
import { TILE_TOOLS } from './tileTools';
import type { EditorTool } from './EditorTool';

export function resolveActiveTool(): EditorTool {
  if (activeMode().toolset === 'tilemap') {
    const tool = useTilemapPaint.getState().tool;
    if (tool) return TILE_TOOLS[tool];
  }
  return TRANSFORM_TOOLS[useEditorStore.getState().tool] ?? TRANSFORM_TOOLS.select;
}

export type { EditorTool, PointerInput, ToolContext } from './EditorTool';
export { isTilemapSelected, isTilePaintMode } from './tileMode';
