// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CollisionBrushPalette.tsx
 * @brief   The palette for a COLLISION (obstacle) layer — the fixed built-in collision
 *          brushes (solid / slopes / halves / one-way / trigger) in place of a texture
 *          atlas. Picking a brush sets a 1×1 stamp of that brush's global id; the Viewport
 *          paints it like any tile and the tile-collision overlay draws the resulting
 *          collider. The brush set + its gids come from the SDK ({@link COLLISION_BRUSHES}),
 *          so the palette can't drift from what the runtime spawns.
 */
import { COLLISION_BRUSHES, tileIdOf, type CollisionBrush } from 'esengine';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { t } from '@/i18n';

/** Brush key → localized label. The six slope/half brushes share the `.estileset` slope
 *  preset labels (same shapes); solid / one-way / trigger are collision-layer specific. */
const BRUSH_LABEL: Record<string, string> = {
  solid: t('tile.collision.solid'),
  rampR: t('tile.slope.rampR'),
  rampL: t('tile.slope.rampL'),
  halfBottom: t('tile.slope.halfBottom'),
  halfTop: t('tile.slope.halfTop'),
  halfLeft: t('tile.slope.halfLeft'),
  halfRight: t('tile.slope.halfRight'),
  oneWay: t('tile.collision.oneWay'),
  sensor: t('tile.collision.sensor'),
};

/** A 24×24 glyph of a brush's collision — a filled polygon/box, dashed for a sensor,
 *  with a top arrow for a one-way floor — so the shape you'll paint is legible at a glance. */
function BrushIcon({ brush }: { brush: CollisionBrush }) {
  const { shape } = brush.collision;
  const sensor = !!brush.collision.sensor;
  const oneWay = !!brush.collision.oneWay;
  const fill = sensor ? 'none' : 'currentColor';
  const S = 24;
  const body = shape.type === 'polygon'
    ? <polygon points={shape.points.map(([x, y]) => `${x * S},${y * S}`).join(' ')}
        fill={fill} stroke="currentColor" strokeWidth={sensor ? 1.5 : 0}
        strokeDasharray={sensor ? '3 2' : undefined} />
    : <rect x={0.5} y={0.5} width={S - 1} height={S - 1} rx={1}
        fill={fill} stroke="currentColor" strokeWidth={sensor ? 1.5 : 0}
        strokeDasharray={sensor ? '3 2' : undefined} />;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={26} height={26} aria-hidden="true">
      {body}
      {oneWay && (
        // Solid-top marker: an up arrow along the solid side (world y-up ⇒ top edge).
        <path d="M12 3 l4 5 h-3 v4 h-2 v-4 h-3 z" fill="var(--acc, #4ea1ff)" />
      )}
    </svg>
  );
}

/** The collision-layer brush grid. Reads/writes the shared paint store: the active brush is
 *  the current 1×1 stamp's tile id; clicking a brush sets it (and switches to the brush tool
 *  if none is armed, so the first click paints). */
export function CollisionBrushPalette() {
  const stamp = useTilemapPaint((s) => s.stamp);
  const tool = useTilemapPaint((s) => s.tool);
  const setBrushTile = useTilemapPaint((s) => s.setBrushTile);
  const setTool = useTilemapPaint((s) => s.setTool);
  const activeId = stamp.w === 1 && stamp.h === 1 ? tileIdOf(stamp.cells[0]) : -1;

  return (
    <div className="cp-panel">
      <div className="cp-hint">{t('tile.collision.hint')}</div>
      <div className="cp-grid" role="listbox" aria-label={t('tile.collision.title')}>
        {COLLISION_BRUSHES.map((brush) => (
          <button
            key={brush.id}
            type="button"
            role="option"
            aria-selected={brush.id === activeId}
            className={'cp-brush' + (brush.id === activeId ? ' is-active' : '')}
            title={BRUSH_LABEL[brush.key] ?? brush.key}
            onClick={() => {
              setBrushTile(brush.id);
              if (!tool || tool === 'eyedropper' || tool === 'select') setTool('brush');
            }}
          >
            <BrushIcon brush={brush} />
            <span className="cp-brush-label">{BRUSH_LABEL[brush.key] ?? brush.key}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
