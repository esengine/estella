// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilemapPainter.tsx
 * @brief   The Tilemap painter panel (REARCH_TILEMAP T3b) — the brush palette + tools
 *          for painting a selected scene `TilemapLayer` entity. Painting itself happens
 *          in the Viewport (this panel drives the active tool + brush via the paint
 *          store); the palette is the entity's referenced `.estileset` atlas.
 */

import { useEffect, useState } from 'react';
import { Brush, Eraser, Square, Pipette } from 'lucide-react';
import { parseTileset, type TilesetAsset } from 'esengine';
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
];

/** Resolve the .estileset path a selected TilemapLayer references (its `tilesetAsset` @uuid). */
function selectedTilemapTilesetPath(selectedId: number | null): string | null {
  if (selectedId == null) return null;
  const e = SceneModel.entityBySource(selectedId);
  const layer = e?.components.find((c) => c.type === 'TilemapLayer');
  if (!layer) return null;
  const ref = (layer.data as Record<string, unknown>).tilesetAsset;
  return typeof ref === 'string' ? (ProjectStore.assetInfo(ref)?.path ?? null) : null;
}

export function TilemapPainter() {
  const { tilesetPath, brushTileId, tool, setTileset, setBrush, setTool } = useTilemapPaint();
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
    if (!tilesetPath) { setAsset(null); return; }
    void (async () => {
      try {
        const a = parseTileset(JSON.parse(await window.estella.fs.read(tilesetPath)));
        if (alive) setAsset(a);
      } catch { if (alive) setAsset(null); }
    })();
    return () => { alive = false; };
  }, [tilesetPath]);

  const texUrl = asset ? `estella://project/${ProjectStore.assetInfo(asset.texture)?.path ?? ''}` : null;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setNatural(null), [texUrl]);

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

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + 1;
        cells.push(
          <div
            key={id}
            className={'tp-cell' + (id === brushTileId ? ' is-sel' : '')}
            style={{ left: mg + col * (tw + sp), top: mg + row * (th + sp), width: tw, height: th }}
            title={`#${id}`}
            onPointerDown={() => { setBrush(id); if (!tool || tool === 'eyedropper') setTool('brush'); }}
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
        <span className="tp-grow" />
        <span className="tp-brush">刷子 #{brushTileId}</span>
      </div>
      <div className="tp-palette">
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
    </div>
  );
}
