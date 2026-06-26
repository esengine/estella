// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor tool registry shape — every transform/tile tool exists, is keyed
 *        by the editor's ToolMode / PaintTool, implements the EditorTool contract,
 *        and has a unique namespaced id. Guards the Viewport router's lookups.
 */
import { describe, it, expect } from 'vitest';
import { TRANSFORM_TOOLS } from '@/tools/transformTools';
import { TILE_TOOLS } from '@/tools/tileTools';
import type { EditorTool } from '@/tools/EditorTool';

const implementsContract = (t: EditorTool) =>
  typeof t.onPointerDown === 'function' &&
  typeof t.onPointerMove === 'function' &&
  typeof t.onPointerUp === 'function';

describe('editor tool registry', () => {
  it('has the transform tools keyed by ToolMode', () => {
    for (const k of ['select', 'move', 'rotate', 'scale']) {
      expect(TRANSFORM_TOOLS[k]).toBeDefined();
      expect(implementsContract(TRANSFORM_TOOLS[k])).toBe(true);
    }
  });

  it('has the tile tools keyed by PaintTool', () => {
    for (const k of ['brush', 'erase', 'rect', 'line', 'bucket', 'select', 'eyedropper', 'terrain'] as const) {
      expect(TILE_TOOLS[k]).toBeDefined();
      expect(implementsContract(TILE_TOOLS[k])).toBe(true);
    }
  });

  it('tool ids are unique and namespaced', () => {
    const ids = [...Object.values(TRANSFORM_TOOLS), ...Object.values(TILE_TOOLS)].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('transform.move');
    expect(ids).toContain('tilemap.brush');
  });
});
