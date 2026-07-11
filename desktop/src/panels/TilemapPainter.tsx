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
import {
  Brush, Eraser, Square, Slash, PaintBucket, BoxSelect, Pipette,
  FlipHorizontal, FlipVertical, RotateCw, Mountain, Plus, X, MousePointer2, Dices,
  ZoomIn, ZoomOut, Maximize2, Eye, EyeOff, Lock, Unlock,
} from 'lucide-react';
import { encodeTile, type TilesetAsset, type TileStamp } from 'esengine';
import { useTilemapPaint, type PaintTool, type PaletteTileset, type AtlasInfo } from '@/store/tilemapPaintStore';
import { useSelection } from '@/store/selectionStore';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { ProjectStore } from '@/project/ProjectStore';
import { TILE_TOOL_KEY, exitTilePaint } from '@/tools/tileMode';
import { MOD_LABEL } from '@/commands/keybinding';
import { buildStampGhost } from '@/tools/tileStampGhost';
import { colsFor, rowsFor, TERRAIN_COLORS } from '@/tools/tileMath';
import { loadTilesetAsset } from '@/tileset/loadTileset';
import { IconButton } from '@/components/IconButton';

const TOOLS: { id: PaintTool; icon: typeof Brush; label: string }[] = [
  { id: 'brush', icon: Brush, label: 'Brush' },
  { id: 'erase', icon: Eraser, label: 'Eraser' },
  { id: 'rect', icon: Square, label: 'Rect' },
  { id: 'line', icon: Slash, label: 'Line' },
  { id: 'bucket', icon: PaintBucket, label: 'Bucket' },
  { id: 'select', icon: BoxSelect, label: `Select (${MOD_LABEL}C/X/V copy/cut/paste)` },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  { id: 'terrain', icon: Mountain, label: 'Terrain' },
];

/** Resolve the .estileset ref(s) a selected TilemapLayer references — the `tilesetAssets`
 *  list (multi-tileset) or the singular `tilesetAsset` — as @uuid refs (not yet paths). */
function selectedTilemapTilesetRefs(selectedId: number | null): string[] {
  if (selectedId == null) return [];
  const e = SceneModel.entityBySource(selectedId);
  const layer = e?.components.find((c) => c.type === 'TilemapLayer');
  if (!layer) return [];
  const data = layer.data as Record<string, unknown>;
  const list = data.tilesetAssets;
  if (Array.isArray(list)) return list.filter((r): r is string => typeof r === 'string' && r !== '');
  return typeof data.tilesetAsset === 'string' && data.tilesetAsset ? [data.tilesetAsset] : [];
}

/** Natural pixel size of an image URL (for deriving a tileset's rows → tile count). */
function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

interface SelRect { c0: number; r0: number; c1: number; r1: number }
const normRect = (a: { c: number; r: number }, b: { c: number; r: number }): SelRect => ({
  c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r),
});

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const PALETTE_DIR: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** A tiny live preview of the active brush (the real tiles + their flip/rotate), so the
 *  toolbar shows WHAT you'll paint, not just its dimensions. Reuses the viewport ghost
 *  geometry. */
function BrushThumbnail({ stamp, atlas }: { stamp: TileStamp; atlas: AtlasInfo | null }) {
  const cells = buildStampGhost(stamp, atlas);
  if (!cells || !atlas) return null;
  const natW = stamp.w * atlas.tileW;
  const natH = stamp.h * atlas.tileH;
  const MAX = 26;
  const scale = Math.min(MAX / natW, MAX / natH);
  return (
    <span className="tp-brushthumb" style={{ width: natW * scale, height: natH * scale }}>
      <span className="tp-brushthumb-in" style={{ width: natW, height: natH, transform: `scale(${scale})` }}>
        {cells.map((c, i) => <span key={i} style={c.style} />)}
      </span>
    </span>
  );
}

export function TilemapPainter() {
  const {
    tilesetPath, tilesets, activeTileset, stamp, tool, terrainSet,
    setTilesets, setActiveTileset, setTilesetAsset, setStamp, setTool, setTerrainSet,
    setActiveAtlas, flipH, flipV, rotateCW, randomBrush, toggleRandomBrush,
  } = useTilemapPaint();
  const selectedId = useSelection((s) => s.selectedId);
  const hasTilemap = selectedId != null
    && !!SceneModel.entityBySource(selectedId)?.components.some((c) => c.type === 'TilemapLayer');
  // Bumped after add/remove tileset: the layer's `tilesetAssets` changed but selectedId
  // did not, so the palette-load effect below wouldn't otherwise re-read the new list.
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  // Selecting a TilemapLayer loads ALL its referenced .estileset(s) into the palette,
  // each assigned its firstId (matching resolveTilesetModel's running sum), so the tab
  // bar can switch between them and painted cells encode to the right global gid.
  useEffect(() => {
    const paths = selectedTilemapTilesetRefs(selectedId)
      .map((r) => ProjectStore.assetInfo(r)?.path).filter((p): p is string => !!p);
    if (paths.length === 0) { setTilesets([]); return; }
    let alive = true;
    void (async () => {
      const entries: PaletteTileset[] = [];
      let firstId = 1;
      for (const path of paths) {
        try {
          const a = await loadTilesetAsset(path);
          entries.push({ path, asset: a, firstId });
          let count = a.tileCount ?? 0;
          if (count <= 0) {
            const url = `estella://project/${ProjectStore.assetInfo(a.texture)?.path ?? ''}`;
            const dims = await loadImageDims(url);
            count = a.columns * rowsFor(dims.h, a.tileHeight, a.margin, a.spacing);
          }
          firstId += Math.max(1, count);
        } catch { /* skip a bad tileset */ }
      }
      if (alive) setTilesets(entries);
    })();
    return () => { alive = false; };
  }, [selectedId, setTilesets, reloadKey]);

  const [asset, setAsset] = useState<TilesetAsset | null>(null);
  useEffect(() => {
    let alive = true;
    if (!tilesetPath) { setAsset(null); setTilesetAsset(null); return; }
    void (async () => {
      try {
        const a = await loadTilesetAsset(tilesetPath);
        if (alive) { setAsset(a); setTilesetAsset(a); }
      } catch { if (alive) { setAsset(null); setTilesetAsset(null); } }
    })();
    return () => { alive = false; };
  }, [tilesetPath, setTilesetAsset]);

  const texUrl = asset ? `estella://project/${ProjectStore.assetInfo(asset.texture)?.path ?? ''}` : null;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setNatural(null), [texUrl]);

  // Publish the active tileset's atlas layout for the viewport's WYSIWYG brush ghost.
  // The painter is the one place that loads the atlas image, so it owns this geometry;
  // the viewport reads it instead of re-loading. Cleared on unmount so a closed painter
  // leaves no stale ghost.
  useEffect(() => {
    if (!asset || !natural || !texUrl) { setActiveAtlas(null); return; }
    setActiveAtlas({
      url: texUrl,
      cols: colsFor(natural.w, asset.tileWidth, asset.margin, asset.spacing),
      tileW: asset.tileWidth, tileH: asset.tileHeight,
      margin: asset.margin, spacing: asset.spacing,
      firstId: tilesets[activeTileset]?.firstId ?? 1,
    });
  }, [asset, natural, texUrl, tilesets, activeTileset, setActiveAtlas]);
  useEffect(() => () => setActiveAtlas(null), [setActiveAtlas]);

  // Palette marquee: drag a rectangle of cells to pick a multi-tile stamp.
  const [sel, setSel] = useState<SelRect | null>(null);
  const dragAnchor = useRef<{ c: number; r: number } | null>(null);

  // Palette zoom (small tilesets are unclickable at 1:1). A fresh tileset opens at a
  // comfortable magnification derived from its tile size; − / + / fit adjust from there.
  const paletteRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(2);
  useEffect(() => {
    if (asset) setZoom(clamp(Math.round(28 / (asset.tileWidth || 16)), 1, 4));
  }, [tilesetPath, asset]);
  // Clearing the marquee when the active tileset changes stops a stale highlight from
  // lingering on a tab that no longer shows the picked cells.
  useEffect(() => setSel(null), [activeTileset]);
  const fitZoom = () => {
    const pal = paletteRef.current;
    if (pal && natural && natural.w > 0) setZoom(clamp((pal.clientWidth - 16) / natural.w, 0.25, 8));
  };

  // Dismiss the add-tileset menu on any outside click (the menu + its opener stop
  // their own pointerdown so those don't self-close it) — and on Escape, like
  // every other transient surface.
  useEffect(() => {
    if (!addOpen) return;
    const close = () => setAddOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);

  // Re-render the layer strip on any model change (add/remove/rename/hide/lock).
  const [, bumpModel] = useState(0);
  useEffect(() => SceneModel.subscribe(() => bumpModel((v) => v + 1)), []);

  if (!hasTilemap) {
    return (
      <div className="tp-empty">
        <p>No tilemap selected</p>
        <p className="tp-hint">Right-click an .estileset in the Content Browser → Create Tilemap, or select a tilemap entity in the Outliner</p>
      </div>
    );
  }

  const tw = asset?.tileWidth ?? 16;
  const th = asset?.tileHeight ?? 16;
  const mg = asset?.margin ?? 0;
  const sp = asset?.spacing ?? 0;
  const cols = natural ? colsFor(natural.w, tw, mg, sp) : (asset?.columns ?? 1);
  const rows = natural ? rowsFor(natural.h, th, mg, sp) : 0;
  // Global tile-id base of the active tileset — a cell's gid = firstId + (row*cols + col),
  // so the renderer resolves it back to THIS tileset (single-tileset layers have firstId 1).
  const activeFirstId = tilesets[activeTileset]?.firstId ?? 1;
  const localAtlas: AtlasInfo | null = texUrl && natural
    ? { url: texUrl, cols, tileW: tw, tileH: th, margin: mg, spacing: sp, firstId: activeFirstId }
    : null;

  // The scene's tilemap layers (the paint targets) — click one to make it active, without
  // hunting in the Outliner; toggle its viewport visibility / lock inline.
  const layers = SceneModel.entityOrder()
    .map((id) => ({ id, e: SceneModel.entityBySource(id) }))
    .filter((L) => L.e?.components.some((c) => c.type === 'TilemapLayer'))
    .map((L) => ({ id: L.id, name: L.e!.name, hidden: SceneModel.isHidden(L.id), locked: SceneModel.isLocked(L.id) }));

  const commitSel = (r: SelRect) => {
    const w = r.c1 - r.c0 + 1;
    const h = r.r1 - r.r0 + 1;
    const cells: number[] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells.push(encodeTile((r.r0 + dy) * cols + (r.c0 + dx) + activeFirstId));
      }
    }
    setStamp({ w, h, cells });
    if (!tool || tool === 'eyedropper') setTool('brush');
  };

  const endDrag = () => {
    if (dragAnchor.current && sel) commitSel(sel);
    dragAnchor.current = null;
  };

  // Palette keyboard: arrows walk the grid (a 1×1 brush at the new cell),
  // Shift+arrows grow the selection into a multi-tile stamp. The focused
  // palette owns these keys — they must not reach the global selection nudge.
  const onPaletteKey = (e: React.KeyboardEvent) => {
    const dir = PALETTE_DIR[e.key];
    if (!dir || !cols || !rows) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = sel ?? { c0: 0, r0: 0, c1: 0, r1: 0 };
    const next = e.shiftKey
      ? {
          c0: cur.c0,
          r0: cur.r0,
          c1: clamp(Math.max(cur.c0, cur.c1 + dir[0]), 0, cols - 1),
          r1: clamp(Math.max(cur.r0, cur.r1 + dir[1]), 0, rows - 1),
        }
      : (() => {
          const c = sel ? clamp(cur.c0 + dir[0], 0, cols - 1) : 0;
          const r = sel ? clamp(cur.r0 + dir[1], 0, rows - 1) : 0;
          return { c0: c, r0: r, c1: c, r1: r };
        })();
    setSel(next);
    commitSel(next);
    requestAnimationFrame(() =>
      paletteRef.current
        ?.querySelector('.tp-cell.is-sel')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  };

  const inSel = (col: number, row: number): boolean =>
    sel != null && col >= sel.c0 && col <= sel.c1 && row >= sel.r0 && row <= sel.r1;

  // Add/remove a tileset on the selected layer (writes `tilesetAssets` + live-syncs the
  // runtime), then reload the palette. Refs are @uuid, in firstId order == tab order.
  const addTileset = (ref: string) => {
    if (selectedId == null) return;
    SceneCommands.setLayerTilesets(selectedId, [...selectedTilemapTilesetRefs(selectedId), ref]);
    setAddOpen(false);
    setReloadKey((k) => k + 1);
  };
  const removeTilesetAt = (i: number) => {
    if (selectedId == null) return;
    SceneCommands.setLayerTilesets(selectedId, selectedTilemapTilesetRefs(selectedId).filter((_, j) => j !== i));
    setReloadKey((k) => k + 1);
  };
  // The project's .estileset assets not already on this layer (populated on open).
  const addable = addOpen
    ? ProjectStore.listAssets('tileset').filter((a) => !selectedTilemapTilesetRefs(selectedId).includes(a.ref))
    : [];

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + activeFirstId;
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
      {layers.length > 1 && (
        <div className="tp-layers">
          {layers.map((L) => (
            <span key={L.id} className={'tp-layer' + (L.id === selectedId ? ' is-active' : '')}>
              <button
                type="button" className="tp-layer-vis" title={L.hidden ? 'Show' : 'Hide'}
                onClick={() => SceneCommands.setEntityVisible(L.id, L.hidden)}
              >
                {L.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                type="button" className="tp-layer-name" title={`Paint on "${L.name}"`}
                onClick={() => useSelection.getState().select(L.id)}
              >
                {L.name}
              </button>
              <button
                type="button" className="tp-layer-lock" title={L.locked ? 'Unlock' : 'Lock'}
                onClick={() => SceneCommands.setEntityLocked(L.id, !L.locked)}
              >
                {L.locked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tp-tools">
        <IconButton
          variant="outline"
          size="lg"
          active={tool === null}
          title="Select / transform (Q · Esc to exit painting)"
          onClick={() => exitTilePaint('select')}
        >
          <MousePointer2 size={15} />
        </IconButton>
        <span className="tp-sep" />
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            variant="outline"
            size="lg"
            active={tool === t.id}
            title={`${t.label} (${TILE_TOOL_KEY[t.id]})`}
            onClick={() => setTool(t.id)}
          >
            <t.icon size={15} />
          </IconButton>
        ))}
        <span className="tp-sep" />
        <IconButton variant="outline" size="lg" title="Flip horizontal (H)" onClick={() => flipH()}>
          <FlipHorizontal size={15} />
        </IconButton>
        <IconButton variant="outline" size="lg" title="Flip vertical (V)" onClick={() => flipV()}>
          <FlipVertical size={15} />
        </IconButton>
        <IconButton variant="outline" size="lg" title="Rotate 90° (R)" onClick={() => rotateCW()}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton
          variant="outline"
          size="lg"
          active={randomBrush}
          title="Random: each painted cell samples one tile from the selection"
          onClick={() => toggleRandomBrush()}
        >
          <Dices size={15} />
        </IconButton>
        <span className="tp-grow" />
        <span className="tp-brush">
          {tool === 'terrain' ? 'Terrain brush' : (
            <>
              <BrushThumbnail stamp={stamp} atlas={localAtlas} />
              {stamp.w}×{stamp.h}
            </>
          )}
        </span>
      </div>
      {tool !== 'terrain' && (
        <div className="tp-tilesets">
          {tilesets.map((ts, i) => (
            <span
              key={ts.path}
              className={'tp-tschip' + (i === activeTileset ? ' is-active' : '')}
              title={`${ts.path}  (gid ${ts.firstId}+)`}
            >
              <button type="button" className="tp-tsbtn" onClick={() => setActiveTileset(i)}>
                {ts.path.split(/[\\/]/).pop()?.replace(/\.estileset$/, '') ?? `Tileset ${i + 1}`}
              </button>
              {tilesets.length > 1 && (
                <button type="button" className="tp-tsx" title="Remove tileset" onClick={() => removeTilesetAt(i)}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          <div className="tp-tsadd-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="tp-tsadd" title="Add tileset" onClick={() => setAddOpen((o) => !o)}>
              <Plus size={13} />
            </button>
            {addOpen && (
              <div className="tp-tsmenu">
                {addable.length === 0 ? (
                  <div className="empty-line empty-line--sm">No tilesets to add</div>
                ) : (
                  addable.map((a) => (
                    <button key={a.ref} type="button" className="tp-tsmenu-item" onClick={() => addTileset(a.ref)}>
                      {a.name.replace(/\.estileset$/, '')}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {tool === 'terrain' ? (
        <div className="tp-terrains">
          {(asset?.terrains ?? []).length === 0 ? (
            <div className="tp-warn">No terrains (create and tag tiles in the Tileset Editor's Terrain mode)</div>
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
        <>
          {texUrl && (
            <div className="tp-palbar">
              <button type="button" className="tp-zbtn" title="Zoom out" onClick={() => setZoom((z) => clamp(z / 1.25, 0.25, 8))}>
                <ZoomOut size={13} />
              </button>
              <span className="tp-zpct">{Math.round(zoom * 100)}%</span>
              <button type="button" className="tp-zbtn" title="Zoom in" onClick={() => setZoom((z) => clamp(z * 1.25, 0.25, 8))}>
                <ZoomIn size={13} />
              </button>
              <button type="button" className="tp-zbtn" title="Fit width" onClick={fitZoom}>
                <Maximize2 size={13} />
              </button>
            </div>
          )}
          <div
            className="tp-palette"
            ref={paletteRef}
            tabIndex={0}
            aria-label="Tile palette"
            onKeyDown={onPaletteKey}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {!texUrl ? (
              <div className="tp-warn">No palette (the tilemap references no .estileset)</div>
            ) : (
              <div className="tp-atlas-sizer" style={{ width: (natural?.w ?? 0) * zoom, height: (natural?.h ?? 0) * zoom }}>
                <div
                  className="tp-atlas"
                  style={{ width: natural?.w ?? 0, height: natural?.h ?? 0, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
                >
                  <img
                    className="tp-img" src={texUrl} alt="" draggable={false}
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  />
                  {cells}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
