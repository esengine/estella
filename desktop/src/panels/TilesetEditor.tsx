// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetEditor.tsx
 * @brief   The .estileset editor panel — the tileset's atlas with a grid overlay, in two
 *          authoring modes. Collision: click/drag tiles to toggle box collision. Terrain:
 *          manage autotile sets and click a tile's peering zones (sides + corners) to
 *          mark which neighbours it expects, the data the painter's terrain brush resolves
 *          against. Subscribes to the reactive TilesetDocument; mutations go through
 *          TilesetCommands (one undo step each).
 *
 * Scope: grid geometry + box collision + terrain peering. Per-tile polygon shapes and
 * animation slot onto the same asset later (the schema already carries them).
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import {
  TB_N, TB_E, TB_S, TB_W, TB_NE, TB_SE, TB_SW, TB_NW,
  type TilesetAsset, type TerrainMode,
} from 'esengine';
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

const TERRAIN_COLORS = ['#4caf50', '#d6884c', '#4c8fd6', '#b14cd6', '#d6c64c', '#d64c6e'];

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

// Peering zones in the cell's 3×3 grid; center (membership) is handled separately.
const ZONES: { gx: number; gy: number; bit: number; corner: boolean }[] = [
  { gx: 1, gy: 0, bit: TB_N, corner: false },
  { gx: 2, gy: 0, bit: TB_NE, corner: true },
  { gx: 2, gy: 1, bit: TB_E, corner: false },
  { gx: 2, gy: 2, bit: TB_SE, corner: true },
  { gx: 1, gy: 2, bit: TB_S, corner: false },
  { gx: 0, gy: 2, bit: TB_SW, corner: true },
  { gx: 0, gy: 1, bit: TB_W, corner: false },
  { gx: 0, gy: 0, bit: TB_NW, corner: true },
];

export function TilesetEditor() {
  useSyncExternalStore(TilesetDocument.subscribe, TilesetDocument.getRevision);
  const asset = TilesetDocument.asset;
  const meta = TilesetDocument.meta;

  const info = asset ? ProjectStore.assetInfo(asset.texture) : null;
  const texUrl = info ? `estella://project/${info.path}` : null;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  const [mode, setMode] = useState<'collision' | 'terrain'>('collision');
  const [activeSet, setActiveSet] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  // Live collision paint stroke: which tiles + the target on/off state, one undo step.
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
  const terrains = asset.terrains ?? [];
  const terrain = terrains[activeSet];
  const terrainColor = TERRAIN_COLORS[activeSet % TERRAIN_COLORS.length];

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

  const tileTerrain = (id: number) => {
    const t = asset.tiles[id]?.terrain;
    return t && t.set === activeSet ? t : null;
  };
  const toggleBit = (id: number, bit: number) => {
    const cur = tileTerrain(id)?.mask ?? 0;
    TilesetCommands.setTileTerrain(id, activeSet, cur ^ bit);
  };
  const toggleMember = (id: number) => {
    if (tileTerrain(id)) TilesetCommands.setTileTerrain(id, null, 0);
    else TilesetCommands.setTileTerrain(id, activeSet, 0);
  };

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + 1;
        const left = (mg + col * (tw + sp)) * zoom;
        const top = (mg + row * (th + sp)) * zoom;
        const w = tw * zoom;
        const h = th * zoom;
        if (mode === 'collision') {
          cells.push(
            <div
              key={id}
              className={'ts-cell' + (isSolid(id) ? ' is-solid' : '')}
              style={{ left, top, width: w, height: h }}
              title={`#${id}`}
              onPointerDown={(e) => { e.preventDefault(); setDrag({ ids: new Set([id]), on: !isSolid(id) }); }}
              onPointerEnter={() => {
                if (dragRef.current) {
                  const ids = new Set(dragRef.current.ids);
                  ids.add(id);
                  setDrag({ ids, on: dragRef.current.on });
                }
              }}
            />,
          );
        } else {
          const tt = tileTerrain(id);
          const showZones = hovered === id || tt != null;
          const cellStyle: CSSProperties = { left, top, width: w, height: h };
          if (tt) (cellStyle as Record<string, string | number>)['--tcolor'] = terrainColor;
          cells.push(
            <div
              key={id}
              className={'ts-cell ts-tcell' + (tt ? ' is-member' : '')}
              style={cellStyle}
              title={`#${id}`}
              onPointerEnter={() => setHovered(id)}
              onPointerLeave={() => setHovered((cur) => (cur === id ? null : cur))}
            >
              <button
                type="button" className="ts-zone ts-zone-c"
                title="该瓦片属于此地形"
                onClick={() => toggleMember(id)}
              />
              {showZones && terrain && ZONES.filter((z) => terrain.mode === 'corner' || !z.corner).map((z) => {
                const on = ((tt?.mask ?? 0) & z.bit) !== 0;
                return (
                  <button
                    key={z.bit}
                    type="button"
                    className={'ts-zone' + (on ? ' is-on' : '') + (z.corner ? ' is-corner' : '')}
                    style={{ left: `${z.gx * 33.34}%`, top: `${z.gy * 33.34}%` }}
                    onClick={() => toggleBit(id, z.bit)}
                  />
                );
              })}
            </div>,
          );
        }
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
        <div className="ts-modes">
          <button type="button" className={mode === 'collision' ? 'is-active' : ''} onClick={() => setMode('collision')}>碰撞</button>
          <button type="button" className={mode === 'terrain' ? 'is-active' : ''} onClick={() => setMode('terrain')}>地形</button>
        </div>
        <span className="ts-sep" />
        <label className="ts-field">
          <span>Zoom</span>
          <input type="range" min={1} max={8} step={1} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <span className="ts-grow" />
        <span className="ts-stat">
          {cols}×{rows}{mode === 'collision' ? ` · ${solidCount} solid` : ''}
        </span>
        <button type="button" className="ts-save" onClick={() => void TilesetCommands.save()} disabled={!meta.dirty}>
          <Save size={13} /> 保存{meta.dirty ? ' •' : ''}
        </button>
      </div>

      {mode === 'terrain' && (
        <div className="ts-terrains">
          {terrains.map((t, i) => (
            <button
              key={i}
              type="button"
              className={'ts-terrain' + (i === activeSet ? ' is-active' : '')}
              onClick={() => setActiveSet(i)}
            >
              <span className="ts-tswatch" style={{ background: TERRAIN_COLORS[i % TERRAIN_COLORS.length] }} />
              {t.name}
              <span className="ts-tmode">{t.mode === 'corner' ? '角' : '边'}</span>
            </button>
          ))}
          <button type="button" className="ts-terrain ts-add" title="新建地形"
            onClick={() => { TilesetCommands.addTerrain('', 'edge'); setActiveSet(terrains.length); setMode('terrain'); }}>
            <Plus size={13} />
          </button>
          {terrain && (
            <div className="ts-tedit">
              <input
                className="ts-tname" value={terrain.name}
                onChange={(e) => TilesetCommands.updateTerrain(activeSet, { name: e.target.value })}
              />
              <select
                value={terrain.mode}
                onChange={(e) => TilesetCommands.updateTerrain(activeSet, { mode: e.target.value as TerrainMode })}
              >
                <option value="edge">边 (4-bit)</option>
                <option value="corner">角 (blob)</option>
              </select>
              <button type="button" className="ts-trm" title="删除地形"
                onClick={() => { TilesetCommands.removeTerrain(activeSet); setActiveSet(0); }}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="ts-canvas" onPointerUp={mode === 'collision' ? commitDrag : undefined}
        onPointerLeave={mode === 'collision' ? commitDrag : undefined}>
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
