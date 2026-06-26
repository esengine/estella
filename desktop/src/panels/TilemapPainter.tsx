// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilemapPainter.tsx
 * @brief   The Tilemap painter panel — the brush palette + tools for painting a selected
 *          scene `TilemapLayer`. The palette is the entity's referenced `.estileset`
 *          atlas; drag a rectangle over it to pick a multi-tile stamp, single-click for a
 *          1×1 brush. Flip/rotate transform the active stamp. Painting itself happens in
 *          the Viewport (this panel drives the active tool + stamp via the paint store).
 */

import { useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Square, Pipette, FlipHorizontal, FlipVertical, RotateCw, Mountain } from 'lucide-react';
import { parseTileset, encodeTile, type TilesetAsset } from 'esengine';
import { useTilemapPaint, type PaintTool } from '@/store/tilemapPaintStore';
import { useSelection } from '@/store/selectionStore';
import { SceneModel } from '@/engine/SceneModel';
import { ProjectStore } from '@/project/ProjectStore';

function colsFor(width: number, tileW: number, margin: number, spacing: number): number {
  const stride = tileW + spacing;
  return stride > 0 ? Math.max(1, Math.floor((width - margin + spacing) / stride)) : 1;
}
function rowsFor(height: number, tileH: number, margin: number, spacing: number): number {
  const stride = tileH + spacing;
  return stride > 0 ? Math.max(0, Math.floor((height - margin + spacing) / stride)) : 0;
}

const TOOLS: { id: PaintTool; icon: typeof Brush; label: string }[] = [
  { id: 'brush', icon: Brush, label: '画笔' },
  { id: 'erase', icon: Eraser, label: '擦除' },
  { id: 'rect', icon: Square, label: '矩形' },
  { id: 'eyedropper', icon: Pipette, label: '吸管' },
  { id: 'terrain', icon: Mountain, label: '地形' },
];

const TERRAIN_COLORS = ['#4caf50', '#d6884c', '#4c8fd6', '#b14cd6', '#d6c64c', '#d64c6e'];

/** Resolve the .estileset path a selected TilemapLayer references (its `tilesetAsset` @uuid). */
function selectedTilemapTilesetPath(selectedId: number | null): string | null {
  if (selectedId == null) return null;
  const e = SceneModel.entityBySource(selectedId);
  const layer = e?.components.find((c) => c.type === 'TilemapLayer');
  if (!layer) return null;
  const ref = (layer.data as Record<string, unknown>).tilesetAsset;
  return typeof ref === 'string' ? (ProjectStore.assetInfo(ref)?.path ?? null) : null;
}

interface SelRect { c0: number; r0: number; c1: number; r1: number }
const normRect = (a: { c: number; r: number }, b: { c: number; r: number }): SelRect => ({
  c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r),
});

export function TilemapPainter() {
  const {
    tilesetPath, stamp, tool, terrainSet,
    setTileset, setTilesetAsset, setStamp, setTool, setTerrainSet, flipH, flipV, rotateCW,
  } = useTilemapPaint();
  const selectedId = useSelection((s) => s.selectedId);
  const hasTilemap = selectedId != null
    && !!SceneModel.entityBySource(selectedId)?.components.some((c) => c.type === 'TilemapLayer');

  // Selecting a TilemapLayer loads its referenced .estileset as the active palette.
  useEffect(() => {
    const path = selectedTilemapTilesetPath(selectedId);
    if (path && path !== tilesetPath) setTileset(path);
  }, [selectedId, tilesetPath, setTileset]);

  const [asset, setAsset] = useState<TilesetAsset | null>(null);
  useEffect(() => {
    let alive = true;
    if (!tilesetPath) { setAsset(null); setTilesetAsset(null); return; }
    void (async () => {
      try {
        const a = parseTileset(JSON.parse(await window.estella.fs.read(tilesetPath)));
        if (alive) { setAsset(a); setTilesetAsset(a); }
      } catch { if (alive) { setAsset(null); setTilesetAsset(null); } }
    })();
    return () => { alive = false; };
  }, [tilesetPath, setTilesetAsset]);

  const texUrl = asset ? `estella://project/${ProjectStore.assetInfo(asset.texture)?.path ?? ''}` : null;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setNatural(null), [texUrl]);

  // Palette marquee: drag a rectangle of cells to pick a multi-tile stamp.
  const [sel, setSel] = useState<SelRect | null>(null);
  const dragAnchor = useRef<{ c: number; r: number } | null>(null);

  // H/V/R transform the active stamp — only while a paint tool is active, so they don't
  // shadow the transform-tool shortcuts when not painting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useTilemapPaint.getState();
      if (!st.tool || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'h') { st.flipH(); e.preventDefault(); }
      else if (k === 'v') { st.flipV(); e.preventDefault(); }
      else if (k === 'r') { st.rotateCW(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!hasTilemap) {
    return (
      <div className="tp-empty">
        <p>未选择瓦片地图</p>
        <p className="tp-hint">在内容浏览器右键 .estileset → 新建瓦片地图，或在大纲里选中一个瓦片地图实体</p>
      </div>
    );
  }

  const tw = asset?.tileWidth ?? 16;
  const th = asset?.tileHeight ?? 16;
  const mg = asset?.margin ?? 0;
  const sp = asset?.spacing ?? 0;
  const cols = natural ? colsFor(natural.w, tw, mg, sp) : (asset?.columns ?? 1);
  const rows = natural ? rowsFor(natural.h, th, mg, sp) : 0;

  const commitSel = (r: SelRect) => {
    const w = r.c1 - r.c0 + 1;
    const h = r.r1 - r.r0 + 1;
    const cells: number[] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push(encodeTile((r.r0 + dy) * cols + (r.c0 + dx) + 1));
      }
    }
    setStamp({ w, h, cells });
    if (!tool || tool === 'eyedropper') setTool('brush');
  };

  const endDrag = () => {
    if (dragAnchor.current && sel) commitSel(sel);
    dragAnchor.current = null;
  };

  const inSel = (col: number, row: number): boolean =>
    sel != null && col >= sel.c0 && col <= sel.c1 && row >= sel.r0 && row <= sel.r1;

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + 1;
        cells.push(
          <div
            key={id}
            className={'tp-cell' + (inSel(col, row) ? ' is-sel' : '')}
            style={{ left: mg + col * (tw + sp), top: mg + row * (th + sp), width: tw, height: th }}
            title={`#${id}`}
            onPointerDown={(e) => {
              e.preventDefault();
              dragAnchor.current = { c: col, r: row };
              setSel({ c0: col, r0: row, c1: col, r1: row });
            }}
            onPointerEnter={() => {
              if (dragAnchor.current) setSel(normRect(dragAnchor.current, { c: col, r: row }));
            }}
          />,
        );
      }
    }
  }

  return (
    <div className="tp-panel">
      <div className="tp-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'tp-tool' + (tool === t.id ? ' is-active' : '')}
            title={t.label}
            onClick={() => setTool(tool === t.id ? null : t.id)}
          >
            <t.icon size={15} />
          </button>
        ))}
        <span className="tp-sep" />
        <button type="button" className="tp-tool" title="水平翻转 (H)" onClick={() => flipH()}>
          <FlipHorizontal size={15} />
        </button>
        <button type="button" className="tp-tool" title="垂直翻转 (V)" onClick={() => flipV()}>
          <FlipVertical size={15} />
        </button>
        <button type="button" className="tp-tool" title="旋转 90° (R)" onClick={() => rotateCW()}>
          <RotateCw size={15} />
        </button>
        <span className="tp-grow" />
        <span className="tp-brush">{tool === 'terrain' ? '地形画笔' : `刷子 ${stamp.w}×${stamp.h}`}</span>
      </div>
      {tool === 'terrain' ? (
        <div className="tp-terrains">
          {(asset?.terrains ?? []).length === 0 ? (
            <div className="tp-warn">没有地形（在瓦片集编辑器的「地形」模式里新建并标记瓦片）</div>
          ) : (
            (asset?.terrains ?? []).map((t, i) => (
              <button
                key={i}
                type="button"
                className={'tp-terrain' + (i === terrainSet ? ' is-active' : '')}
                onClick={() => setTerrainSet(i)}
              >
                <span className="tp-tswatch" style={{ background: TERRAIN_COLORS[i % TERRAIN_COLORS.length] }} />
                {t.name}
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="tp-palette" onPointerUp={endDrag} onPointerLeave={endDrag}>
          {!texUrl ? (
            <div className="tp-warn">没有调色板（瓦片地图未引用 .estileset）</div>
          ) : (
            <div className="tp-atlas" style={{ width: natural?.w ?? 0, height: natural?.h ?? 0 }}>
              <img
                className="tp-img" src={texUrl} alt="" draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
              {cells}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
