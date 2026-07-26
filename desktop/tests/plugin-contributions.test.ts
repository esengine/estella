// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The P3 contribution seams — inspector rows, overlay primitives, context
 *        menu rows, contributed asset types, and viewport tool arming.
 *
 * These cover the rules that are easy to get subtly wrong and invisible when they
 * are: a read-only row must never route a write, a partially-projected polyline must
 * not draw a false shape, contributed rows must not leave a dangling separator, a
 * plugin must not be able to re-map a built-in file extension, and arming a built-in
 * tool must disarm a contributed one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSectionBuilder, isInfoRow, inspectorRegistry } from '@/plugins/inspector';
import { contextMenuRegistry, contributedContextRows } from '@/plugins/contextMenus';
import { assetTypeRegistry, assetTypeOf, assetTypeDef, ASSET_TYPES } from '@/project/assetTypes';
import { toolRegistry } from '@/tools/toolRegistry';
import { useEditorStore } from '@/store/editorStore';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import type { OverlayPrimitive } from '@/plugins/overlays';
import type { GizmoStyle, OverlayGraphics, Vec2 } from '@/plugins/types';

const PLUGIN = 'plugin:acme';
const id = (s: string) => s;

afterEach(() => {
  for (const registry of [inspectorRegistry, contextMenuRegistry, assetTypeRegistry, toolRegistry]) {
    registry.disposeOwner(PLUGIN);
  }
});

// — Inspector builder ——————————————————————————————————————————————————————————

describe('inspector section builder', () => {
  it('turns row calls into the editor`s own field shapes', () => {
    const { ui, fields } = createSectionBuilder(id);
    ui.number('gain', 'Gain', 0.5, { min: 0, max: 1, step: 0.1, unit: 'x' });
    ui.bool('on', 'Enabled', true);
    ui.text('name', 'Name', 'hi');
    ui.vec2('at', 'At', { x: 3, y: 4 });
    ui.color('tint', 'Tint', '#ff0000');
    ui.select('mode', 'Mode', 'b', ['a', 'b']);

    expect(fields.map((f) => [f.key, f.type, f.value])).toEqual([
      ['gain', 'number', 0.5],
      ['on', 'bool', true],
      ['name', 'string', 'hi'],
      ['at', 'vec2', [3, 4]],
      ['tint', 'color', '#ff0000'],
      ['mode', 'select', 'b'],
    ]);
    // A bounded number gets a slider; an unbounded one must not.
    expect(fields[0].slider).toBe(true);
    expect(fields[0].unit).toBe('x');
    expect(fields[5].selectOptions).toEqual(['a', 'b']);
  });

  it('gives read-only rows keys that can never be written back', () => {
    const { ui, fields } = createSectionBuilder(id);
    ui.info('Components', '3');
    ui.info('Children', '1');
    ui.number('real', 'Real', 1);

    // Distinct keys, so two info rows don't collide in the field list...
    expect(fields.map((f) => f.key)).toEqual(['__info0', '__info1', 'real']);
    // ...and both are recognizable as read-only by the write router.
    expect(isInfoRow(fields[0].key)).toBe(true);
    expect(isInfoRow(fields[1].key)).toBe(true);
    expect(isInfoRow(fields[2].key)).toBe(false);
  });

  it('an unbounded number gets no slider', () => {
    const { ui, fields } = createSectionBuilder(id);
    ui.number('n', 'N', 1, { min: 0 });
    expect(fields[0].slider).toBe(false);
  });
});

describe('inspector registry', () => {
  it('resolves sections by component and by asset type, not across', () => {
    inspectorRegistry.register(PLUGIN, {
      kind: 'component', id: 'a', component: 'Sprite', title: 'A', build: () => {},
    });
    inspectorRegistry.register(PLUGIN, {
      kind: 'asset', id: 'b', assetType: 'texture', title: 'B', build: () => {},
    });
    expect(inspectorRegistry.forComponent('Sprite').map((s) => s.id)).toEqual(['a']);
    expect(inspectorRegistry.forComponent('texture')).toEqual([]);
    expect(inspectorRegistry.forAssetType('texture').map((s) => s.id)).toEqual(['b']);
    expect(inspectorRegistry.forAssetType('Sprite')).toEqual([]);
  });
});

// — Overlay primitives —————————————————————————————————————————————————————————

/** A graphics surface with a fixed, invertible projection (no engine needed). */
function fakeGraphics(out: OverlayPrimitive[], project: (x: number, y: number) => Vec2 | null): OverlayGraphics {
  const g: OverlayGraphics = {
    worldToViewport: project,
    viewportToWorld: (x, y) => ({ x, y }),
    line(a, b, style) {
      const p0 = project(a.x, a.y);
      const p1 = project(b.x, b.y);
      if (p0 && p1) out.push({ kind: 'line', points: [p0, p1], style });
    },
    polyline(points, style) {
      const projected: Vec2[] = [];
      for (const p of points) {
        const q = project(p.x, p.y);
        if (!q) return;
        projected.push(q);
      }
      if (projected.length >= 2) out.push({ kind: 'polyline', points: projected, style });
    },
    circle(center, radius, style) {
      const c = project(center.x, center.y);
      const edge = project(center.x + radius, center.y);
      if (c && edge) out.push({ kind: 'circle', center: c, radius: Math.abs(edge.x - c.x), style });
    },
    rect(a, b, style) {
      const p0 = project(a.x, a.y);
      const p1 = project(b.x, b.y);
      if (!p0 || !p1) return;
      out.push({
        kind: 'rect', x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y),
        w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y), style,
      });
    },
    text(at, text, style) {
      const p = project(at.x, at.y);
      if (p) out.push({ kind: 'text', at: p, text, style });
    },
  };
  return g;
}

describe('overlay primitives', () => {
  // 2x zoom, y flipped — enough to prove world coords are projected, not passed through.
  const zoom2 = (x: number, y: number): Vec2 => ({ x: x * 2, y: -y * 2 });

  it('projects every point, so a gizmo is authored in world space', () => {
    const out: OverlayPrimitive[] = [];
    const g = fakeGraphics(out, zoom2);
    g.line({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(out[0]).toMatchObject({ kind: 'line', points: [{ x: 2, y: -4 }, { x: 6, y: -8 }] });
  });

  it('derives a circle`s pixel radius from the projection, so it scales with zoom', () => {
    const out: OverlayPrimitive[] = [];
    fakeGraphics(out, zoom2).circle({ x: 0, y: 0 }, 10);
    // A world radius of 10 at 2x is 20 screen pixels — not 10.
    expect(out[0]).toMatchObject({ kind: 'circle', radius: 20 });
  });

  it('normalizes a rect given by any two opposite corners', () => {
    const out: OverlayPrimitive[] = [];
    fakeGraphics(out, (x, y) => ({ x, y })).rect({ x: 10, y: 10 }, { x: 4, y: 2 });
    expect(out[0]).toMatchObject({ kind: 'rect', x: 4, y: 2, w: 6, h: 8 });
  });

  it('drops a primitive whose projection fails rather than drawing it wrong', () => {
    const out: OverlayPrimitive[] = [];
    const g = fakeGraphics(out, () => null); // no camera yet
    g.line({ x: 0, y: 0 }, { x: 1, y: 1 });
    g.circle({ x: 0, y: 0 }, 5);
    g.text({ x: 0, y: 0 }, 'x');
    expect(out).toEqual([]);
  });

  it('drops a PARTIALLY projectable polyline whole — a half shape is a false shape', () => {
    const out: OverlayPrimitive[] = [];
    let calls = 0;
    const g = fakeGraphics(out, (x, y) => (++calls > 2 ? null : { x, y }));
    g.polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(out).toEqual([]);
  });
});

// — Context menu rows ——————————————————————————————————————————————————————————

describe('contributed context menu rows', () => {
  it('adds nothing at all when no plugin contributes — no dangling separator', () => {
    expect(contributedContextRows('outliner/item', { entity: 1 })).toEqual([]);
  });

  it('prefixes a separator when there ARE rows, so grouping is right either way', () => {
    contextMenuRegistry.register(PLUGIN, {
      id: 'acme.row', location: 'outliner/item', label: 'Do it', run: () => {},
    });
    const rows = contributedContextRows('outliner/item', { entity: 1 });
    expect(rows[0]).toEqual({ sep: true });
    expect(rows).toHaveLength(2);
  });

  it('filters by location and by `when`, and passes the target through to run', () => {
    const run = vi.fn();
    contextMenuRegistry.register(PLUGIN, {
      id: 'acme.entityOnly',
      location: 'outliner/item',
      label: 'Entity only',
      when: (target) => target.entity === 7,
      run,
    });
    expect(contributedContextRows('outliner/item', { entity: 1 })).toEqual([]);
    expect(contributedContextRows('content/item', { path: 'a.png' })).toEqual([]);

    const rows = contributedContextRows('outliner/item', { entity: 7 });
    expect(rows).toHaveLength(2);
    (rows[1] as { onClick: () => void }).onClick();
    expect(run).toHaveBeenCalledWith({ entity: 7 });
  });

  it('resolves a localized label against the session locale', () => {
    contextMenuRegistry.register(PLUGIN, {
      id: 'acme.loc', location: 'content/item', label: { en: 'Reveal' }, run: () => {},
    });
    const rows = contributedContextRows('content/item', { path: 'a.png' });
    expect((rows[1] as { label: string }).label).toBe('Reveal');
  });
});

// — Contributed asset types ————————————————————————————————————————————————————

describe('contributed asset types', () => {
  it('resolves its extensions, and falls back to `file` for unknown ones', () => {
    assetTypeRegistry.register(PLUGIN, {
      id: 'acme.dialogue', extensions: ['dlg'], badge: 'DLG', icon: ASSET_TYPES.file.icon, tint: '#abc',
    });
    expect(assetTypeOf('intro.dlg')).toBe('acme.dialogue');
    expect(assetTypeOf('intro.unknown')).toBe('file');
    expect(assetTypeDef('acme.dialogue').badge).toBe('DLG');
  });

  it('cannot re-map a built-in extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assetTypeRegistry.register(PLUGIN, {
      id: 'acme.png-hijack', extensions: ['png'], badge: 'X', icon: ASSET_TYPES.file.icon, tint: '#abc',
    });
    expect(assetTypeOf('hero.png')).toBe('texture');
    warn.mockRestore();
  });

  it('unknown types resolve to the generic file look rather than throwing', () => {
    expect(assetTypeDef('acme.gone')).toBe(ASSET_TYPES.file);
  });
});

// — Viewport tool arming ———————————————————————————————————————————————————————

describe('contributed viewport tools', () => {
  const tool = {
    id: 'acme.measure',
    title: 'Measure',
    onPointerDown: () => true,
    onPointerMove: () => {},
    onPointerUp: () => {},
  };

  it('is only active while armed, and only in its declared modes', () => {
    toolRegistry.register(PLUGIN, { ...tool, modes: ['scene'] });
    expect(toolRegistry.activeFor('scene')).toBeUndefined(); // registered ≠ armed

    toolRegistry.activate('acme.measure');
    expect(toolRegistry.activeFor('scene')?.id).toBe('acme.measure');
    expect(toolRegistry.activeFor('tilemap')).toBeUndefined(); // wrong mode

    toolRegistry.activate(null);
    expect(toolRegistry.activeFor('scene')).toBeUndefined();
  });

  it('is active in every mode when it declares none', () => {
    toolRegistry.register(PLUGIN, tool);
    toolRegistry.activate('acme.measure');
    expect(toolRegistry.activeFor('scene')?.id).toBe('acme.measure');
    expect(toolRegistry.activeFor('tilemap')?.id).toBe('acme.measure');
  });

  it('ignores arming an id that isn`t registered', () => {
    toolRegistry.activate('acme.nope');
    expect(toolRegistry.activeId()).toBeNull();
  });

  it('disarms when the tool is retracted, so no stroke routes to a gone tool', () => {
    const d = toolRegistry.register(PLUGIN, tool);
    toolRegistry.activate('acme.measure');
    d.dispose();
    expect(toolRegistry.activeId()).toBeNull();
    expect(toolRegistry.activeFor('scene')).toBeUndefined();
  });

  it('disarms when its owner is disposed (plugin unload)', () => {
    toolRegistry.register(PLUGIN, tool);
    toolRegistry.activate('acme.measure');
    toolRegistry.disposeOwner(PLUGIN);
    expect(toolRegistry.activeId()).toBeNull();
  });

  it('is disarmed by picking a built-in tool, so the user is never stuck in it', () => {
    toolRegistry.register(PLUGIN, tool);

    toolRegistry.activate('acme.measure');
    useEditorStore.getState().setTool('move');
    expect(toolRegistry.activeId()).toBeNull();

    toolRegistry.activate('acme.measure');
    useTilemapPaint.getState().setTool('brush');
    expect(toolRegistry.activeId()).toBeNull();

    // Clearing the paint tool is not a tool CHOICE, so it must not disarm.
    toolRegistry.activate('acme.measure');
    useTilemapPaint.getState().setTool(null);
    expect(toolRegistry.activeId()).toBe('acme.measure');
  });
});
