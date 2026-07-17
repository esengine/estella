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
  Brush, Eraser, Square, Circle, Slash, PaintBucket, BoxSelect, Pipette,
  FlipHorizontal, FlipVertical, RotateCw, Mountain, Plus, X, MousePointer2, Dices,
  ZoomIn, ZoomOut, Maximize2, Eye, EyeOff, Lock, Unlock, Bookmark,
} from 'lucide-react';
import { encodeTile, type TilesetAsset, type TileStamp } from 'esengine';
import { useTilemapPaint, type PaintTool, type PaletteTileset, type AtlasInfo } from '@/store/tilemapPaintStore';
import { useSelection } from '@/store/selectionStore';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { ProjectStore } from '@/project/ProjectStore';
import { TILE_TOOL_KEY, exitTilePaint } from '@/tools/tileMode';
import { MOD_LABEL } from '@/commands/keybinding';
import { usePanelWindow } from '@/components/PanelWindow';
import { buildStampGhost } from '@/tools/tileStampGhost';
import { colsFor, rowsFor, TERRAIN_COLORS } from '@/tools/tileMath';
import { loadTilesetAsset } from '@/tileset/loadTileset';
import { openTileset } from '@/tileset/openTileset';
import { createTilemapFromTileset } from '@/tilemap/createTilemap';
import { layerTilesetRefs } from '@/tilemap/layerTilesetModel';
import { AnimPreview, tileThumbStyle, type TileAtlas } from '@/tools/tileThumb';
import { parseStampLibrary, serializeStampLibrary, stampLibraryKey, addStamp, removeStampAt, type SavedStamp } from '@/tools/stampLibrary';
import { IconButton } from '@/components/IconButton';
import { ContextMenu } from '@/components/Menu';
import { t } from '@/i18n';

const TOOLS: { id: PaintTool; icon: typeof Brush; label: string }[] = [
  { id: 'brush', icon: Brush, label: t('tile.tool.brush') },
  { id: 'erase', icon: Eraser, label: t('tile.tool.eraser') },
  { id: 'rect', icon: Square, label: t('tile.tool.rect') },
  { id: 'ellipse', icon: Circle, label: t('tile.tool.ellipse') },
  { id: 'line', icon: Slash, label: t('tile.tool.line') },
  { id: 'bucket', icon: PaintBucket, label: t('tile.tool.bucket') },
  { id: 'select', icon: BoxSelect, label: t('tile.tool.select', { mod: MOD_LABEL }) },
  { id: 'eyedropper', icon: Pipette, label: t('tile.tool.eyedropper') },
  { id: 'terrain', icon: Mountain, label: t('tile.tool.terrain') },
];

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
    tilesetPath, tilesets, activeTileset, stamp, tool, terrainSet, wangColor,
    setTilesets, setActiveTileset, setTilesetAsset, setStamp, setBrushTile, setTool, setTerrainSet, setWangColor,
    setActiveAtlas, flipH, flipV, rotateCW, randomBrush, toggleRandomBrush,
  } = useTilemapPaint();
  const win = usePanelWindow();
  const selectedId = useSelection((s) => s.selectedId);
  const hasTilemap = selectedId != null
    && !!SceneModel.entityBySource(selectedId)?.components.some((c) => c.type === 'TilemapLayer');
  // Bumped after add/remove tileset: the layer's `tilesetAssets` changed but selectedId
  // did not, so the palette-load effect below wouldn't otherwise re-read the new list.
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [layerCtx, setLayerCtx] = useState<{ x: number; y: number; id: number } | null>(null);
  const [renamingLayer, setRenamingLayer] = useState<number | null>(null);
  const layerDragFrom = useRef<number | null>(null);
  const [layerDropIdx, setLayerDropIdx] = useState<number | null>(null);

  // Saved-stamp library — per project (stamps carry gids only this project's tilesets
  // mint), persisted in localStorage, pure logic in tools/stampLibrary.
  const projectRoot = ProjectStore.getSnapshot()?.root ?? '';
  const [savedStamps, setSavedStamps] = useState<SavedStamp[]>(() =>
    parseStampLibrary(typeof localStorage !== 'undefined' ? localStorage.getItem(stampLibraryKey(projectRoot)) : null));
  const updateStamps = (next: SavedStamp[]) => {
    setSavedStamps(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(stampLibraryKey(projectRoot), serializeStampLibrary(next));
  };

  // Selecting a TilemapLayer loads ALL its referenced .estileset(s) into the palette,
  // each assigned its firstId (matching resolveTilesetModel's running sum), so the tab
  // bar can switch between them and painted cells encode to the right global gid.
  useEffect(() => {
    const paths = layerTilesetRefs(selectedId)
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

  // A tile selection (the select-tool marquee) is layer-scoped: drop it when the active
  // layer changes so a stale marquee can't drive copy/cut/delete on the wrong layer.
  useEffect(() => { useTilemapPaint.getState().setSelection(null); }, [selectedId]);

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
    win.addEventListener('pointerdown', close);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('pointerdown', close);
      win.removeEventListener('keydown', onKey);
    };
  }, [addOpen, win]);

  // Re-render the layer strip on any model change (add/remove/rename/hide/lock).
  const [, bumpModel] = useState(0);
  useEffect(() => SceneModel.subscribe(() => bumpModel((v) => v + 1)), []);

  if (!hasTilemap) {
    return (
      <div className="tp-empty">
        <p>{t('tile.noTilemap')}</p>
        <p className="tp-hint">{t('tile.noTilemapHint')}</p>
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
    .map((L) => {
      const data = L.e!.components.find((c) => c.type === 'TilemapLayer')!.data as { opacity?: number };
      return {
        id: L.id,
        name: L.e!.name,
        hidden: SceneModel.isHidden(L.id),
        locked: SceneModel.isLocked(L.id),
        opacity: typeof data.opacity === 'number' ? data.opacity : 1,
      };
    });

  // New layer: another TilemapLayer entity on the active tileset (a sibling paint
  // target). Opacity edits coalesce into one undo step per slider drag.
  const addLayer = () => { if (tilesetPath) void createTilemapFromTileset(tilesetPath); };
  const setLayerOpacity = (id: number, v: number) =>
    SceneCommands.setField(id, 'TilemapLayer', 'opacity', 'number', v);

  // Layer chip context menu (rename / duplicate / reorder / delete) — the layer
  // bar is the tilemap home, so managing layers must not require the Outliner.
  const layerMenuItems = (id: number) => {
    const i = layers.findIndex((L) => L.id === id);
    return [
      { label: t('tile.layerRename'), onClick: () => setRenamingLayer(id) },
      { label: t('tile.layerDuplicate'), onClick: () => SceneCommands.duplicateEntity(id) },
      { label: t('tile.layerMoveUp'), disabled: i <= 0, onClick: () => SceneCommands.reorderEntity(id, layers[i - 1]!.id, true) },
      { label: t('tile.layerMoveDown'), disabled: i < 0 || i >= layers.length - 1, onClick: () => SceneCommands.reorderEntity(id, layers[i + 1]!.id, false) },
      { label: t('tile.layerDelete'), onClick: () => SceneCommands.deleteEntity(id) },
    ];
  };

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
    SceneCommands.setLayerTilesets(selectedId, [...layerTilesetRefs(selectedId), ref]);
    setAddOpen(false);
    setReloadKey((k) => k + 1);
  };
  const removeTilesetAt = (i: number) => {
    if (selectedId == null) return;
    SceneCommands.setLayerTilesets(selectedId, layerTilesetRefs(selectedId).filter((_, j) => j !== i));
    setReloadKey((k) => k + 1);
  };
  // The project's .estileset assets not already on this layer (populated on open).
  const addable = addOpen
    ? ProjectStore.listAssets('tileset').filter((a) => !layerTilesetRefs(selectedId).includes(a.ref))
    : [];

  const atlas: TileAtlas | null = texUrl && natural
    ? { url: texUrl, naturalW: natural.w, naturalH: natural.h, cols, tileW: tw, tileH: th, margin: mg, spacing: sp }
    : null;
  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + activeFirstId;
        // asset.tiles is keyed by the tileset-local 1-based id (== TilesetEditor's).
        const meta = asset?.tiles[row * cols + col + 1];
        const anim = meta?.animation;
        const ter = meta?.terrain;
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
          >
            {anim && anim.length > 1 && atlas && (
              <AnimPreview
                frames={anim}
                fallback={row * cols + col + 1}
                className="tp-cell-anim"
                thumb={(t) => tileThumbStyle(atlas, t, tw)}
              />
            )}
            {meta?.collision && <span className="tp-badge tp-badge-col" title={t('tile.badgeCollision')} />}
            {ter != null && (
              <span
                className="tp-badge tp-badge-ter"
                style={{ background: TERRAIN_COLORS[ter.set % TERRAIN_COLORS.length] }}
                title={t('tile.badgeTerrain')}
              />
            )}
            {anim && anim.length > 0 && <span className="tp-badge tp-badge-anim" title={t('tile.badgeAnimated')} />}
          </div>,
        );
      }
    }
  }

  return (
    <div className="tp-panel">
      {layers.length > 0 && (
        <div className="tp-layers">
          <IconButton size="sm" title={t('tile.newLayerTip')} disabled={!tilesetPath} onClick={addLayer}>
            <Plus size={14} />
          </IconButton>
          {layers.map((L, li) => (
            <span
              key={L.id}
              draggable={renamingLayer !== L.id}
              className={'tp-layer' + (L.id === selectedId ? ' is-active' : '') + (layerDropIdx === li ? ' drop' : '')}
              onContextMenu={(e) => {
                e.preventDefault();
                setLayerCtx({ x: e.clientX, y: e.clientY, id: L.id });
              }}
              onDragStart={(e) => { layerDragFrom.current = li; e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                if (layerDragFrom.current == null) return;
                e.preventDefault();
                setLayerDropIdx(li);
              }}
              onDragLeave={() => setLayerDropIdx((d) => (d === li ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setLayerDropIdx(null);
                const from = layerDragFrom.current;
                layerDragFrom.current = null;
                if (from != null && from !== li && layers[from]) {
                  SceneCommands.reorderEntity(layers[from].id, L.id, from > li);
                }
              }}
              onDragEnd={() => { layerDragFrom.current = null; setLayerDropIdx(null); }}
            >
              <button
                type="button" className="tp-layer-vis" title={L.hidden ? t('tile.show') : t('tile.hide')}
                onClick={() => SceneCommands.setEntityVisible(L.id, L.hidden)}
              >
                {L.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              {renamingLayer === L.id ? (
                <input
                  className="tp-layer-rename"
                  defaultValue={L.name}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== L.name) SceneCommands.renameEntity(L.id, name);
                    setRenamingLayer(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenamingLayer(null);
                  }}
                />
              ) : (
                <button
                  type="button" className="tp-layer-name" title={t('tile.paintOn', { name: L.name })}
                  onClick={() => useSelection.getState().select(L.id)}
                  onDoubleClick={() => setRenamingLayer(L.id)}
                >
                  {L.name}
                </button>
              )}
              <input
                className="tp-layer-op" type="range" min={0} max={1} step={0.05} value={L.opacity}
                title={t('tile.opacityPct', { pct: Math.round(L.opacity * 100) })}
                draggable
                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onPointerDown={() => SceneCommands.beginGesture('Layer opacity')}
                onChange={(e) => setLayerOpacity(L.id, Number(e.target.value))}
                onPointerUp={() => SceneCommands.endGesture()}
              />
              <button
                type="button" className="tp-layer-lock" title={L.locked ? t('tile.unlock') : t('tile.lock')}
                onClick={() => SceneCommands.setEntityLocked(L.id, !L.locked)}
              >
                {L.locked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
            </span>
          ))}
          {layerCtx && (
            <ContextMenu
              x={layerCtx.x}
              y={layerCtx.y}
              onClose={() => setLayerCtx(null)}
              items={layerMenuItems(layerCtx.id)}
            />
          )}
        </div>
      )}
      <div className="tp-tools">
        <IconButton
          variant="outline"
          size="lg"
          active={tool === null}
          title={t('tile.tool.exit')}
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
        <IconButton variant="outline" size="lg" title={t('tile.flipH')} onClick={() => flipH()}>
          <FlipHorizontal size={15} />
        </IconButton>
        <IconButton variant="outline" size="lg" title={t('tile.flipV')} onClick={() => flipV()}>
          <FlipVertical size={15} />
        </IconButton>
        <IconButton variant="outline" size="lg" title={t('tile.rotate')} onClick={() => rotateCW()}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton
          variant="outline"
          size="lg"
          active={randomBrush}
          title={t('tile.randomTip')}
          onClick={() => toggleRandomBrush()}
        >
          <Dices size={15} />
        </IconButton>
      </div>
      {tool !== 'terrain' && (
        <div className="tp-stamps">
          <IconButton size="sm" title={t('tile.saveStamp')} onClick={() => updateStamps(addStamp(savedStamps, stamp))}>
            <Bookmark size={13} />
          </IconButton>
          {savedStamps.length === 0 ? (
            <span className="tp-stamps-empty">{t('tile.stampsEmpty')}</span>
          ) : (
            savedStamps.map((s, i) => (
              <span key={s.name} className="tp-tschip tp-stampchip">
                <button
                  type="button"
                  className="tp-tsbtn"
                  title={t('tile.recallStamp', { name: s.name, w: s.stamp.w, h: s.stamp.h })}
                  onClick={() => setStamp(s.stamp)}
                >
                  <BrushThumbnail stamp={s.stamp} atlas={localAtlas} />
                  {s.name}
                </button>
                <button type="button" className="tp-tsx" title={t('tile.deleteStamp')} onClick={() => updateStamps(removeStampAt(savedStamps, i))}>
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>
      )}
      {tool !== 'terrain' && (
        <div className="tp-tilesets">
          {tilesets.map((ts, i) => (
            <span
              key={ts.path}
              className={'tp-tschip' + (i === activeTileset ? ' is-active' : '')}
              title={t('tile.tilesetGid', { path: ts.path, gid: ts.firstId })}
            >
              {/* Switching tabs resets the brush to the new tileset's first tile so the
                  stamp + thumbnail can't linger on the previous tileset's (now blank) gids. */}
              <button type="button" className="tp-tsbtn" onClick={() => { setActiveTileset(i); setBrushTile(ts.firstId); }}>
                {ts.path.split(/[\\/]/).pop()?.replace(/\.estileset$/, '') ?? t('tile.tilesetN', { n: i + 1 })}
              </button>
              {tilesets.length > 1 && (
                <button type="button" className="tp-tsx" title={t('tile.removeTileset')} onClick={() => removeTilesetAt(i)}>
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          <div className="tp-tsadd-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="tp-tsadd" title={t('tile.addTileset')} onClick={() => setAddOpen((o) => !o)}>
              <Plus size={13} />
            </button>
            {addOpen && (
              <div className="tp-tsmenu">
                {addable.length === 0 ? (
                  <div className="empty-line empty-line--sm">{t('tile.noTilesetsToAdd')}</div>
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
            <div className="tp-warn">
              {t('tile.noTerrains')}
              {tilesetPath && (
                <button type="button" className="tp-warn-cta" onClick={() => void openTileset(tilesetPath)}>
                  {t('tile.openTilesetEditor')}
                </button>
              )}
            </div>
          ) : (
            (asset?.terrains ?? []).map((ter, i) => (
              ter.mode === 'wang' ? (
                // A wang set paints by COLOR: one swatch button per color in the set.
                <span key={i} className="tp-wgroup">
                  <span className="tp-wglabel">{ter.name}</span>
                  <span className="tp-wcrow">
                    {(ter.colors ?? []).map((c, ci) => (
                      <button
                        key={ci}
                        type="button"
                        className={'tp-wcbtn' + (i === terrainSet && ci + 1 === wangColor ? ' is-active' : '')}
                        title={c.name}
                        onClick={() => { setTerrainSet(i); setWangColor(ci + 1); }}
                      >
                        <span className="tp-tswatch" style={{ background: c.color }} />
                        {c.name}
                      </button>
                    ))}
                  </span>
                </span>
              ) : (
                <button
                  key={i}
                  type="button"
                  className={'tp-terrain' + (i === terrainSet ? ' is-active' : '')}
                  onClick={() => setTerrainSet(i)}
                >
                  <span className="tp-tswatch" style={{ background: TERRAIN_COLORS[i % TERRAIN_COLORS.length] }} />
                  {ter.name}
                </button>
              )
            ))
          )}
        </div>
      ) : (
        <>
          {texUrl && (
            <div className="tp-palbar">
              {/* Active-brush preview lives with the palette it's picked from + the zoom it
                  scales with — always visible (the tools row above no longer steals it). */}
              <span className="tp-brush">
                <BrushThumbnail stamp={stamp} atlas={localAtlas} />
                {stamp.w}×{stamp.h}
              </span>
              <span className="tp-grow" />
              <button type="button" className="tp-zbtn" title={t('tile.zoomOut')} onClick={() => setZoom((z) => clamp(z / 1.25, 0.25, 8))}>
                <ZoomOut size={13} />
              </button>
              <span className="tp-zpct">{Math.round(zoom * 100)}%</span>
              <button type="button" className="tp-zbtn" title={t('tile.zoomIn')} onClick={() => setZoom((z) => clamp(z * 1.25, 0.25, 8))}>
                <ZoomIn size={13} />
              </button>
              <button type="button" className="tp-zbtn" title={t('tile.fitWidth')} onClick={fitZoom}>
                <Maximize2 size={13} />
              </button>
            </div>
          )}
          <div
            className="tp-palette"
            ref={paletteRef}
            tabIndex={0}
            aria-label={t('tile.paletteAria')}
            onKeyDown={onPaletteKey}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {!texUrl ? (
              <div className="tp-warn">{t('tile.noPalette')}</div>
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
