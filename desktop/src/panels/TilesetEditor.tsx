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
 * Scope: grid geometry + box/polygon/circle collision (freeform vertices, one-click slope
 * presets, fitted discs) with one-way / sensor / material brush modifiers + terrain peering
 * + per-tile animation.
 */

import {
  useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type MouseEvent as ReactMouseEvent,
} from 'react';
import { Save, Plus, Trash2, X, ArrowUp } from 'lucide-react';
import {
  TB_N, TB_E, TB_S, TB_W, TB_NE, TB_SE, TB_SW, TB_NW,
  type TilesetAsset, type TilesetAnimFrame,
} from 'esengine';
import { Segmented } from '@/components/Segmented';
import { Select } from '@/components/Select';
import { usePanelWindow } from '@/components/PanelWindow';
import { DirtyDot } from '@/components/DirtyDot';
import { GridField } from '@/components/GridField';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { TilesetCommands, type TileCollisionMods } from '@/tileset/TilesetCommands';
import { ProjectStore } from '@/project/ProjectStore';
import { colsFor, rowsFor, TERRAIN_COLORS } from '@/tools/tileMath';
import { AnimPreview, tileThumbStyle, type TileAtlas } from '@/tools/tileThumb';
import { SLOPE_PRESETS, presetPointsPx, type SlopePreset } from '@/tileset/slopePresets';
import { t } from '@/i18n';

// Peering zones in the cell's 3×3 grid; center (membership) is handled separately.
const ZONES: { gx: number; gy: number; bit: number; corner: boolean; dir: string }[] = [
  { gx: 1, gy: 0, bit: TB_N, corner: false, dir: t('tile.dir.north') },
  { gx: 2, gy: 0, bit: TB_NE, corner: true, dir: t('tile.dir.northEast') },
  { gx: 2, gy: 1, bit: TB_E, corner: false, dir: t('tile.dir.east') },
  { gx: 2, gy: 2, bit: TB_SE, corner: true, dir: t('tile.dir.southEast') },
  { gx: 1, gy: 2, bit: TB_S, corner: false, dir: t('tile.dir.south') },
  { gx: 0, gy: 2, bit: TB_SW, corner: true, dir: t('tile.dir.southWest') },
  { gx: 0, gy: 1, bit: TB_W, corner: false, dir: t('tile.dir.west') },
  { gx: 0, gy: 0, bit: TB_NW, corner: true, dir: t('tile.dir.northWest') },
];

/** A focused per-tile collision-polygon editor: a magnified tile + click-to-add /
 *  click-a-point-to-remove vertices, committed live (≥3 points) as undo steps. */
function PolygonEditor(props: {
  asset: TilesetAsset; texUrl: string; natural: { w: number; h: number };
  tileId: number; cols: number; onClose: () => void;
}) {
  const { asset, texUrl, natural, tileId, cols, onClose } = props;
  const win = usePanelWindow();
  const { tileWidth: tw, tileHeight: th, margin: mg, spacing: sp } = asset;
  const col = (tileId - 1) % cols;
  const row = Math.floor((tileId - 1) / cols);
  const tileX = mg + col * (tw + sp);
  const tileY = mg + row * (th + sp);
  const SIZE = 260;
  const sx = SIZE / tw;
  const sy = SIZE / th;
  const existing = asset.tiles[tileId]?.collision;
  const [pts, setPts] = useState<[number, number][]>(
    existing?.type === 'polygon' ? existing.points.map((p) => [p[0], p[1]] as [number, number]) : [],
  );

  const commit = (next: [number, number][]) => { setPts(next); TilesetCommands.setTilePolygon(tileId, next); };

  const addPoint = (e: ReactMouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = Math.round(((e.clientX - r.left) / r.width) * tw);
    const py = Math.round(((e.clientY - r.top) / r.height) * th);
    commit([...pts, [Math.max(0, Math.min(tw, px)), Math.max(0, Math.min(th, py))]]);
  };

  // Escape closes, like every other transient surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, [onClose, win]);

  return (
    <div className="ts-pe-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ts-pe">
        <div className="ts-pe-head">
          <span>{t('tile.pe.title', { id: tileId })}</span>
          <span className="ts-grow" />
          <button type="button" onClick={() => commit([])}>{t('tile.pe.clear')}</button>
          <button type="button" onClick={onClose}>{t('tile.done')}</button>
        </div>
        <div
          className="ts-pe-stage"
          style={{
            width: SIZE, height: SIZE,
            backgroundImage: `url(${texUrl})`,
            backgroundPosition: `-${tileX * sx}px -${tileY * sy}px`,
            backgroundSize: `${natural.w * sx}px ${natural.h * sy}px`,
          }}
          onClick={addPoint}
        >
          <svg className="ts-pe-svg" viewBox={`0 0 ${tw} ${th}`} width={SIZE} height={SIZE}>
            {pts.length >= 2 && (
              <polygon className="ts-pe-poly" points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')} />
            )}
            {pts.map((p, i) => (
              <circle
                key={i} cx={p[0]} cy={p[1]} r={Math.max(1.2, tw * 0.06)} className="ts-pe-pt"
                onClick={(e) => { e.stopPropagation(); commit(pts.filter((_, j) => j !== i)); }}
              />
            ))}
          </svg>
        </div>
        <div className="ts-pe-hint">{t('tile.pe.hint')}</div>
      </div>
    </div>
  );
}

/** Key/value entry row for the tile-properties bar; commits on ＋ or Enter. */
function AddPropRow({ onAdd }: { onAdd: (k: string, v: string) => void }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const add = () => {
    const key = k.trim();
    if (!key) return;
    onAdd(key, v);
    setK('');
    setV('');
  };
  return (
    <span className="ts-prop-add">
      <input
        className="ts-prop-in" placeholder={t('tile.prop.key')} value={k} spellCheck={false}
        onChange={(e) => setK(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
      />
      <input
        className="ts-prop-in" placeholder={t('tile.prop.value')} value={v} spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
      />
      <button type="button" className="ts-prop-btn" title={t('tile.prop.add')} onClick={add}>
        <Plus size={12} />
      </button>
    </span>
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
  const [mode, setMode] = useState<'collision' | 'terrain' | 'animation' | 'properties'>('collision');
  const [animTile, setAnimTile] = useState<number | null>(null);
  const [propTile, setPropTile] = useState<number | null>(null);
  const [shape, setShape] = useState<'box' | 'polygon' | 'circle'>('box');
  const [polyTile, setPolyTile] = useState<number | null>(null);
  // In polygon mode, an active preset stamps that canned slope/half-tile on click;
  // null = freeform (click opens the vertex editor). See slopePresets.
  const [activePreset, setActivePreset] = useState<SlopePreset | null>(null);
  // Collision brush modifiers, orthogonal to the shape: while set, painted/stamped
  // collision carries a solid-top one-way normal, sensor flag, and/or a material override.
  const [oneWayOn, setOneWayOn] = useState(false);
  const [sensorOn, setSensorOn] = useState(false);
  const [frictionStr, setFrictionStr] = useState('');
  const [restitutionStr, setRestitutionStr] = useState('');
  const [densityStr, setDensityStr] = useState('');
  const [activeSet, setActiveSet] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  // Live collision paint stroke: which tiles + the target on/off state, one undo step.
  const [drag, setDrag] = useState<{ ids: Set<number>; on: boolean } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Circle / preset drag-stamp stroke — same drag-paint feel as box collision.
  const [stampDrag, setStampDrag] = useState<{ ids: Set<number>; on: boolean; kind: 'circle' | 'preset' } | null>(null);
  const stampDragRef = useRef(stampDrag);
  stampDragRef.current = stampDrag;

  useEffect(() => setNatural(null), [texUrl]);

  if (!asset) {
    return (
      <div className="ts-empty">
        <p>{t('tile.noOpen')}</p>
        <p className="ts-hint">{t('tile.noOpenHint')}</p>
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
    drag?.ids.has(id) ? drag.on : asset.tiles[id]?.collision?.type === 'box';
  const polyPointsOf = (id: number): [number, number][] | null => {
    const c = asset.tiles[id]?.collision;
    return c?.type === 'polygon' ? c.points : null;
  };
  const circleOf = (id: number): { cx: number; cy: number; r: number } | null => {
    const c = asset.tiles[id]?.collision;
    return c?.type === 'circle' ? { cx: c.cx, cy: c.cy, r: c.r } : null;
  };
  const hasOneWay = (id: number): boolean => !!asset.tiles[id]?.collision?.oneWay;
  const hasSensor = (id: number): boolean => !!asset.tiles[id]?.collision?.sensor;
  const numOrU = (s: string): number | undefined => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
  };
  const brushMods = ((): TileCollisionMods => {
    const m: TileCollisionMods = {};
    if (oneWayOn) m.oneWay = { nx: 0, ny: 1 };
    if (sensorOn) m.sensor = true;
    const fr = numOrU(frictionStr); if (fr !== undefined) m.friction = fr;
    const re = numOrU(restitutionStr); if (re !== undefined) m.restitution = re;
    const de = numOrU(densityStr); if (de !== undefined) m.density = de;
    return m;
  })();

  const commitDrag = () => {
    const d = dragRef.current;
    if (d) TilesetCommands.paintCollision([...d.ids], d.on, brushMods);
    setDrag(null);
    const sd = stampDragRef.current;
    if (sd) {
      if (sd.kind === 'circle') {
        TilesetCommands.stampCircles([...sd.ids], sd.on, tw / 2, th / 2, Math.min(tw, th) / 2, brushMods);
      } else if (activePreset) {
        TilesetCommands.stampPolygons([...sd.ids], presetPointsPx(activePreset, tw, th), brushMods);
      }
      setStampDrag(null);
    }
  };
  const growStampDrag = (id: number) => {
    const sd = stampDragRef.current;
    if (!sd || sd.ids.has(id)) return;
    const ids = new Set(sd.ids);
    ids.add(id);
    setStampDrag({ ...sd, ids });
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

  // ── animation authoring ──
  const animFrames: TilesetAnimFrame[] = animTile != null ? asset.tiles[animTile]?.animation ?? [] : [];
  const setFrames = (frames: TilesetAnimFrame[]) => {
    if (animTile != null) TilesetCommands.setTileAnimation(animTile, frames);
  };
  /** Atlas crop for a tile id at thumbnail size (shared with the painter palette). */
  const THUMB = 26;
  const atlas: TileAtlas | null = texUrl && natural
    ? { url: texUrl, naturalW: natural.w, naturalH: natural.h, cols, tileW: tw, tileH: th, margin: mg, spacing: sp }
    : null;
  const thumb = (tile: number): CSSProperties => tileThumbStyle(atlas, tile, THUMB);

  const cells = [];
  if (texUrl && natural) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = row * cols + col + 1;
        const left = (mg + col * (tw + sp)) * zoom;
        const top = (mg + row * (th + sp)) * zoom;
        const w = tw * zoom;
        const h = th * zoom;
        if (mode === 'collision' && shape === 'polygon') {
          // A preset drag-paints (live-previewed via stampDrag, one undo step on
          // release); freeform click opens the vertex editor.
          const inStamp = activePreset != null && stampDrag?.kind === 'preset' && stampDrag.ids.has(id);
          const pts = inStamp ? presetPointsPx(activePreset!, tw, th) : polyPointsOf(id);
          cells.push(
            <div
              key={id}
              className={'ts-cell ts-pcell' + (pts ? ' is-poly' : '') + (hasOneWay(id) ? ' is-oneway' : '') + (hasSensor(id) ? ' is-sensor' : '')}
              style={{ left, top, width: w, height: h }}
              title={activePreset ? t('tile.slope.stampTip', { name: t(activePreset.labelKey) }) : t('tile.cell.polyTip', { id })}
              onPointerDown={(e) => {
                e.preventDefault();
                if (activePreset) setStampDrag({ ids: new Set([id]), on: true, kind: 'preset' });
                else setPolyTile(id);
              }}
              onPointerEnter={() => growStampDrag(id)}
            >
              {pts && (
                <svg className="ts-pe-svg" width={w} height={h} viewBox={`0 0 ${tw} ${th}`} preserveAspectRatio="none">
                  <polygon
                    className="ts-pe-poly"
                    points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                    style={{ vectorEffect: 'non-scaling-stroke' }}
                  />
                </svg>
              )}
            </div>,
          );
        } else if (mode === 'collision' && shape === 'circle') {
          // Drag paints (or clears, when starting on a circled tile) fitted discs —
          // the same stroke feel as box collision, one undo step on release.
          const inStamp = stampDrag?.kind === 'circle' && stampDrag.ids.has(id);
          const circ = inStamp
            ? (stampDrag!.on ? { cx: tw / 2, cy: th / 2, r: Math.min(tw, th) / 2 } : null)
            : circleOf(id);
          cells.push(
            <div
              key={id}
              className={'ts-cell ts-pcell' + (circ ? ' is-poly' : '') + (hasOneWay(id) ? ' is-oneway' : '') + (hasSensor(id) ? ' is-sensor' : '')}
              style={{ left, top, width: w, height: h }}
              title={t('tile.cell.circleTip', { id })}
              onPointerDown={(e) => {
                e.preventDefault();
                setStampDrag({ ids: new Set([id]), on: !circleOf(id), kind: 'circle' });
              }}
              onPointerEnter={() => growStampDrag(id)}
            >
              {circ && (
                <svg className="ts-pe-svg" width={w} height={h} viewBox={`0 0 ${tw} ${th}`} preserveAspectRatio="none">
                  <circle className="ts-pe-poly" cx={circ.cx} cy={circ.cy} r={circ.r} style={{ vectorEffect: 'non-scaling-stroke' }} />
                </svg>
              )}
            </div>,
          );
        } else if (mode === 'collision') {
          cells.push(
            <div
              key={id}
              className={'ts-cell' + (isSolid(id) ? ' is-solid' : '') + (hasOneWay(id) ? ' is-oneway' : '') + (hasSensor(id) ? ' is-sensor' : '')}
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
        } else if (mode === 'animation') {
          const hasAnim = !!asset.tiles[id]?.animation?.length;
          cells.push(
            <div
              key={id}
              className={'ts-cell ts-acell' + (hasAnim ? ' has-anim' : '') + (animTile === id ? ' is-target' : '')}
              style={{ left, top, width: w, height: h }}
              title={animTile == null ? t('tile.cell.animEditTip', { id }) : t('tile.cell.animAppendTip', { id })}
              onPointerDown={(e) => {
                e.preventDefault();
                if (animTile == null) setAnimTile(id);
                else setFrames([...animFrames, { tile: id, durationMs: 120 }]);
              }}
            />,
          );
        } else if (mode === 'properties') {
          const hasProps = !!asset.tiles[id]?.properties && Object.keys(asset.tiles[id]!.properties!).length > 0;
          cells.push(
            <div
              key={id}
              className={'ts-cell ts-acell' + (hasProps ? ' has-anim' : '') + (propTile === id ? ' is-target' : '')}
              style={{ left, top, width: w, height: h }}
              title={t('tile.cell.propTip', { id })}
              onPointerDown={(e) => { e.preventDefault(); setPropTile(id); }}
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
                title={t('tile.zone.member')}
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
                    aria-label={t('tile.zone.aria', { dir: z.dir })}
                    title={t('tile.zone.peerTip', { dir: z.dir })}
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
        <GridField label={t('tile.field.tileW')} value={tw} min={1} onCommit={(n) => editGrid({ tileWidth: n })} />
        <GridField label={t('tile.field.tileH')} value={th} min={1} onCommit={(n) => editGrid({ tileHeight: n })} />
        <GridField label={t('tile.field.margin')} value={mg} onCommit={(n) => editGrid({ margin: n })} />
        <GridField label={t('tile.field.spacing')} value={sp} onCommit={(n) => editGrid({ spacing: n })} />
        <span className="ts-sep" />
        <Segmented
          value={mode}
          onChange={setMode}
          ariaLabel={t('tile.mode.aria')}
          options={[
            { value: 'collision', label: t('tile.mode.collision') },
            { value: 'terrain', label: t('tile.mode.terrain') },
            { value: 'animation', label: t('tile.mode.animation') },
            { value: 'properties', label: t('tile.mode.properties') },
          ]}
        />
        {mode === 'collision' && (
          <Segmented
            value={shape}
            onChange={setShape}
            ariaLabel={t('tile.shape.aria')}
            options={[
              { value: 'box', label: t('tile.shape.box') },
              { value: 'polygon', label: t('tile.shape.polygon') },
              { value: 'circle', label: t('tile.shape.circle') },
            ]}
          />
        )}
        <span className="ts-sep" />
        <label className="ts-field">
          <span>{t('tile.field.zoom')}</span>
          <input type="range" min={1} max={8} step={1} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <span className="ts-grow" />
        <span className="ts-stat">
          {cols}×{rows}{mode === 'collision' ? ` · ${t('tile.solidCount', { count: solidCount })}` : ''}
        </span>
        <button type="button" className="ts-save" onClick={() => void TilesetCommands.save()} disabled={!meta.dirty}>
          <Save size={13} /> {t('tile.save')}{meta.dirty && <DirtyDot />}
        </button>
      </div>

      {mode === 'animation' && (
        <div className="ts-anims">
          {animTile == null ? (
            <span className="ts-ahint">{t('tile.anim.pickHint')}</span>
          ) : (
            <>
              <AnimPreview frames={animFrames} fallback={animTile} thumb={thumb} className="ts-fthumb ts-apreview" />
              <span className="ts-astat">#{animTile}</span>
              <span className="ts-sep" />
              {animFrames.map((f, i) => (
                <span key={`${i}-${f.tile}`} className="ts-frame">
                  <span className="ts-fthumb" style={thumb(f.tile)} title={`#${f.tile}`} />
                  <input
                    key={`${animTile}-${i}-${f.durationMs}`}
                    className="ts-fdur"
                    defaultValue={f.durationMs}
                    title={t('tile.anim.durTip')}
                    spellCheck={false}
                    onBlur={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n) && n > 0 && n !== f.durationMs)
                        setFrames(animFrames.map((g, j) => (j === i ? { ...g, durationMs: n } : g)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button
                    type="button" className="ts-fx" title={t('tile.anim.removeFrame')}
                    onClick={() => setFrames(animFrames.filter((_, j) => j !== i))}
                  >
                    <X size={11} strokeWidth={2.2} />
                  </button>
                </span>
              ))}
              <span className="ts-ahint">
                {animFrames.length === 0 ? t('tile.anim.addFrames') : t('tile.anim.appendFrames')}
              </span>
              <span className="ts-grow" />
              {animFrames.length > 0 && (
                <button type="button" className="ts-trm" title={t('tile.anim.clear')} onClick={() => setFrames([])}>
                  <Trash2 size={13} />
                </button>
              )}
              <button type="button" className="ts-terrain" onClick={() => setAnimTile(null)}>{t('tile.done')}</button>
            </>
          )}
        </div>
      )}

      {mode === 'terrain' && (
        <div className="ts-terrains">
          {terrains.map((ter, i) => (
            <button
              key={i}
              type="button"
              className={'ts-terrain' + (i === activeSet ? ' is-active' : '')}
              onClick={() => setActiveSet(i)}
            >
              <span className="ts-tswatch" style={{ background: TERRAIN_COLORS[i % TERRAIN_COLORS.length] }} />
              {ter.name}
              <span className="ts-tmode">{ter.mode === 'corner' ? t('tile.terrain.cornerShort') : t('tile.terrain.edgeShort')}</span>
            </button>
          ))}
          <button type="button" className="ts-terrain ts-add" title={t('tile.terrain.new')}
            onClick={() => { TilesetCommands.addTerrain('', 'edge'); setActiveSet(terrains.length); setMode('terrain'); }}>
            <Plus size={13} />
          </button>
          {terrain && (
            <div className="ts-tedit">
              <input
                className="ts-tname" value={terrain.name}
                onChange={(e) => TilesetCommands.updateTerrain(activeSet, { name: e.target.value })}
              />
              <Select
                ariaLabel={t('tile.terrain.modeAria')}
                value={terrain.mode}
                options={[
                  { value: 'edge', label: t('tile.terrain.edge4') },
                  { value: 'corner', label: t('tile.terrain.cornerBlob') },
                ]}
                onChange={(v) => TilesetCommands.updateTerrain(activeSet, { mode: v })}
              />
              <button type="button" className="ts-trm" title={t('tile.terrain.delete')}
                onClick={() => { TilesetCommands.removeTerrain(activeSet); setActiveSet(0); }}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'properties' && (
        <div className="ts-anims ts-props">
          {propTile == null ? (
            <span className="ts-ahint">{t('tile.prop.pickHint')}</span>
          ) : (
            <>
              <span className="ts-fthumb" style={thumb(propTile)} title={`#${propTile}`} />
              <span className="ts-astat">#{propTile}</span>
              <span className="ts-sep" />
              {Object.entries(asset.tiles[propTile]?.properties ?? {}).map(([k, v]) => (
                <span key={k} className="ts-prop">
                  <span className="ts-prop-key" title={k}>{k}</span>
                  <input
                    key={`${propTile}-${k}-${v}`}
                    className="ts-prop-in"
                    defaultValue={v}
                    spellCheck={false}
                    onBlur={(e) => {
                      if (e.target.value === v) return;
                      const next = { ...(asset.tiles[propTile]?.properties ?? {}) };
                      next[k] = e.target.value;
                      TilesetCommands.setTileProperties(propTile, next);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                  <button
                    type="button" className="ts-prop-btn" title={t('tile.prop.remove')}
                    onClick={() => {
                      const next = { ...(asset.tiles[propTile]?.properties ?? {}) };
                      delete next[k];
                      TilesetCommands.setTileProperties(propTile, next);
                    }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <AddPropRow
                onAdd={(k, v) =>
                  TilesetCommands.setTileProperties(propTile, { ...(asset.tiles[propTile]?.properties ?? {}), [k]: v })}
              />
            </>
          )}
        </div>
      )}

      {mode === 'collision' && (
        <div className="ts-modbar">
          <span className="ts-slabel">{t('tile.modifiers')}</span>
          <button
            type="button"
            className={'ts-oneway' + (oneWayOn ? ' is-active' : '')}
            title={t('tile.oneWayTip')}
            aria-pressed={oneWayOn}
            onClick={() => setOneWayOn((v) => !v)}
          >
            <ArrowUp size={13} /> {t('tile.oneWay')}
          </button>
          <button
            type="button"
            className={'ts-oneway' + (sensorOn ? ' is-active' : '')}
            title={t('tile.sensorTip')}
            aria-pressed={sensorOn}
            onClick={() => setSensorOn((v) => !v)}
          >
            {t('tile.sensor')}
          </button>
          <label className="ts-modnum">
            <span>{t('tile.friction')}</span>
            <input
              type="text" inputMode="decimal" placeholder="0.3" value={frictionStr} spellCheck={false}
              onChange={(e) => setFrictionStr(e.target.value)}
            />
          </label>
          <label className="ts-modnum">
            <span>{t('tile.restitution')}</span>
            <input
              type="text" inputMode="decimal" placeholder="0" value={restitutionStr} spellCheck={false}
              onChange={(e) => setRestitutionStr(e.target.value)}
            />
          </label>
          <label className="ts-modnum">
            <span>{t('tile.density')}</span>
            <input
              type="text" inputMode="decimal" placeholder="1" value={densityStr} spellCheck={false}
              onChange={(e) => setDensityStr(e.target.value)}
            />
          </label>
        </div>
      )}

      {mode === 'collision' && (
        <div className="ts-slopes">
          <span className="ts-slabel">{t('tile.slope.presets')}</span>
          {SLOPE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'ts-slope' + (shape === 'polygon' && activePreset?.id === p.id ? ' is-active' : '')}
              title={t(p.labelKey)}
              aria-label={t(p.labelKey)}
              onClick={() => {
                // Arming a preset implies polygon shape — no mode dance first.
                setShape('polygon');
                setActivePreset((cur) => (shape === 'polygon' && cur?.id === p.id ? null : p));
              }}
            >
              <svg width={20} height={20} viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true">
                <polygon className="ts-pe-poly" points={p.points.map(([x, y]) => `${x * 10},${y * 10}`).join(' ')} style={{ vectorEffect: 'non-scaling-stroke' }} />
              </svg>
            </button>
          ))}
          <button
            type="button"
            className={'ts-slope ts-slope-free' + (shape === 'polygon' && activePreset === null ? ' is-active' : '')}
            title={t('tile.slope.freeform')}
            onClick={() => { setShape('polygon'); setActivePreset(null); }}
          >
            {t('tile.slope.freeform')}
          </button>
        </div>
      )}

      <div className="ts-canvas" onPointerUp={mode === 'collision' ? commitDrag : undefined}
        onPointerLeave={mode === 'collision' ? commitDrag : undefined}>
        {!texUrl ? (
          <div className="ts-warn">{t('tile.texNotFound', { ref: String(asset.texture) || t('tile.refEmpty') })}</div>
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

      {mode === 'collision' && shape === 'polygon' && polyTile != null && texUrl && natural && (
        <PolygonEditor
          asset={asset} texUrl={texUrl} natural={natural} tileId={polyTile} cols={cols}
          onClose={() => setPolyTile(null)}
        />
      )}
    </div>
  );
}
