// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetEditor.tsx
 * @brief   The .estileset editor panel — the tileset's
 *          atlas with a grid overlay; click/drag tiles to toggle box collision (the
 *          collision authority every tilemap derives from). Subscribes to the reactive
 *          TilesetDocument; mutations go through TilesetCommands (one undo step each).
 *
 * Scope: grid geometry + per-tile box collision. Per-tile polygon shapes, animation and
 * terrain rules slot onto the same asset later (the schema already carries them).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Save } from 'lucide-react';
import type { TilesetAsset } from 'esengine';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { TilesetCommands } from '@/tileset/TilesetCommands';
import { ProjectStore } from '@/project/ProjectStore';

function colsFor(width: number, tileW: number, margin: number, spacing: number): number {
  const stride = tileW + spacing;
  return stride > 0 ? Math.max(1, Math.floor((width - margin + spacing) / stride)) : 1;
}
function rowsFor(height: number, tileH: number, margin: number, spacing: number): number {
  const stride = tileH + spacing;
  return stride > 0 ? Math.max(0, Math.floor((height - margin + spacing) / stride)) : 0;
}

/** A grid-geometry number field that commits on blur/Enter (one undo step per edit). */
function GridField(props: { label: string; value: number; min?: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.max(props.min ?? 0, Math.floor(n)));
    else setText(String(props.value));
  };
  return (
    <label className="ts-field">
      <span>{props.label}</span>
      <input
        type="number" value={text} min={props.min ?? 0}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

export function TilesetEditor() {
  useSyncExternalStore(TilesetDocument.subscribe, TilesetDocument.getRevision);
  const asset = TilesetDocument.asset;
  const meta = TilesetDocument.meta;

  const info = asset ? ProjectStore.assetInfo(asset.texture) : null;
  const texUrl = info ? `estella://project/${info.path}` : null;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  // Live paint stroke: which tiles + the target on/off state, committed as one undo step.
  const [drag, setDrag] = useState<{ ids: Set<number>; on: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => setNatural(null), [texUrl]);

  if (!asset) {
    return (
      <div className="ts-empty">
        <p>没有打开的瓦片集</p>
        <p className="ts-hint">在内容浏览器里双击 .estileset，或右键纹理 → 新建瓦片集</p>
      </div>
    );
  }

  const { tileWidth: tw, tileHeight: th, margin: mg, spacing: sp } = asset;
  const cols = natural ? colsFor(natural.w, tw, mg, sp) : asset.columns;
  const rows = natural ? rowsFor(natural.h, th, mg, sp) : 0;

  const isSolid = (id: number): boolean =>
    drag?.ids.has(id) ? drag.on : asset.tiles[id]?.collision !== undefined;

  const commitDrag = () => {
    const d = dragRef.current;
    if (d) TilesetCommands.paintCollision([...d.ids], d.on);
    setDrag(null);
  };

  // Grid edits recompute columns from the atlas so the asset stays consistent.
  const editGrid = (patch: Partial<Pick<TilesetAsset, 'tileWidth' | 'tileHeight' | 'margin' | 'spacing'>>) => {
    const next = { tileWidth: tw, tileHeight: th, margin: mg, spacing: sp, ...patch };
    const columns = natural ? colsFor(natural.w, next.tileWidth, next.margin, next.spacing) : asset.columns;
    TilesetCommands.setGrid({ ...patch, columns });
  };

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + 1;
        const left = (mg + col * (tw + sp)) * zoom;
        const top = (mg + row * (th + sp)) * zoom;
        cells.push(
          <div
            key={id}
            className={'ts-cell' + (isSolid(id) ? ' is-solid' : '')}
            style={{ left, top, width: tw * zoom, height: th * zoom }}
            title={`#${id}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDrag({ ids: new Set([id]), on: !isSolid(id) });
            }}
            onPointerEnter={() => {
              if (dragRef.current) {
                const ids = new Set(dragRef.current.ids);
                ids.add(id);
                setDrag({ ids, on: dragRef.current.on });
              }
            }}
          />,
        );
      }
    }
  }

  const solidCount = Object.values(asset.tiles).filter((t) => t.collision).length;

  return (
    <div className="ts-editor">
      <div className="ts-toolbar">
        <GridField label="Tile W" value={tw} min={1} onCommit={(n) => editGrid({ tileWidth: n })} />
        <GridField label="Tile H" value={th} min={1} onCommit={(n) => editGrid({ tileHeight: n })} />
        <GridField label="Margin" value={mg} onCommit={(n) => editGrid({ margin: n })} />
        <GridField label="Spacing" value={sp} onCommit={(n) => editGrid({ spacing: n })} />
        <span className="ts-sep" />
        <label className="ts-field">
          <span>Zoom</span>
          <input type="range" min={1} max={8} step={1} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <span className="ts-grow" />
        <span className="ts-stat">{cols}×{rows} · {solidCount} solid</span>
        <button type="button" className="ts-save" onClick={() => void TilesetCommands.save()} disabled={!meta.dirty}>
          <Save size={13} /> 保存{meta.dirty ? ' •' : ''}
        </button>
      </div>

      <div className="ts-canvas" onPointerUp={commitDrag} onPointerLeave={commitDrag}>
        {!texUrl ? (
          <div className="ts-warn">纹理未找到（引用 {String(asset.texture) || '空'}）</div>
        ) : (
          <div className="ts-stage" style={{ width: (natural?.w ?? 0) * zoom, height: (natural?.h ?? 0) * zoom }}>
            <img
              className="ts-img" src={texUrl} alt="" draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {cells}
          </div>
        )}
      </div>
    </div>
  );
}
