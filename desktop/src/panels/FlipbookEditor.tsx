// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FlipbookEditor.tsx
 * @brief   The .esanim sprite-flipbook editor panel — the sheet texture with a
 *          slicing-grid overlay (click or drag cells to append frames) over a
 *          frame strip with per-frame durations, fps/loop, a draggable frame anchor,
 *          and a live looping preview. Subscribes to the reactive AnimClipDocument;
 *          mutations go through AnimClipCommands (one undo step each).
 */

import {
  useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type DragEvent,
} from 'react';
import { Plus, Trash2, X, Film } from 'lucide-react';
import {
  animClipSheetCols, animClipSheetRows, animClipDrivesPivot, animClipFramePivot,
  type AnimClipFrameData, type AnimClipPivotData, type AnimClipSheetData,
} from 'esengine';
import { EmptyState } from '@/components/EmptyState';
import { GridField } from '@/components/GridField';
import { ZoomControl } from '@/components/ZoomControl';
import { Transport } from '@/components/Transport';
import { SaveButton } from '@/components/SaveButton';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { AnimClipCommands } from '@/flipbook/AnimClipCommands';
import { AssetRegistry } from '@/project/AssetRegistry';
import { t } from '@/i18n';

const THUMB = 34;

/** CSS crop of one sheet cell, width-fit to `size` px (height follows the cell aspect). */
function cellThumbStyle(
  url: string, sheet: AnimClipSheetData, cols: number, cell: number, size: number,
): CSSProperties {
  const c = cell % cols;
  const r = Math.floor(cell / cols);
  const s = size / sheet.cellWidth;
  return {
    width: size,
    height: Math.max(8, Math.round(size * (sheet.cellHeight / sheet.cellWidth))),
    backgroundImage: `url(${url})`,
    backgroundPosition:
      `${-(sheet.margin + c * (sheet.cellWidth + sheet.spacing)) * s}px ` +
      `${-(sheet.margin + r * (sheet.cellHeight + sheet.spacing)) * s}px`,
    backgroundSize: `${sheet.pageWidth * s}px ${sheet.pageHeight * s}px`,
  };
}

export function FlipbookEditor() {
  useSyncExternalStore(AnimClipDocument.subscribe, AnimClipDocument.getRevision);
  const asset = AnimClipDocument.asset;
  const meta = AnimClipDocument.meta;

  const sheet = asset?.sheet;
  const info = sheet ? AssetRegistry.assetInfo(sheet.texture) : null;
  const texUrl = info ? `estella://project/${info.path}` : null;

  const [zoom, setZoom] = useState(2);
  // Fit the whole sheet page into the scroll viewport (both axes).
  const canvasRef = useRef<HTMLDivElement>(null);
  const fitZoom = () => {
    const c = canvasRef.current;
    if (!c || !sheet || sheet.pageWidth <= 0 || sheet.pageHeight <= 0) return;
    const pad = 24;
    const z = Math.min((c.clientWidth - pad) / sheet.pageWidth, (c.clientHeight - pad) / sheet.pageHeight);
    setZoom(Math.max(0.1, Math.min(8, z)));
  };
  // Live append stroke: ordered cells picked in one pointer gesture, one undo step.
  const [stroke, setStroke] = useState<number[] | null>(null);
  const strokeRef = useRef(stroke);
  strokeRef.current = stroke;
  const [dragFrame, setDragFrame] = useState<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const frameIdxRef = useRef(frameIdx);
  frameIdxRef.current = frameIdx;
  const [onion, setOnion] = useState(true);
  const [onionFrames, setOnionFrames] = useState(1);
  // Live anchor drag: shown while the pointer is down, committed once on release
  // (one undo step, same shape as the cell-append stroke above).
  const [anchorDrag, setAnchorDrag] = useState<AnimClipPivotData | null>(null);

  const playFrames = asset?.frames;
  const playFps = asset?.fps ?? 12;
  // Keep the playhead inside the (possibly shrunk) frame list.
  useEffect(() => {
    const n = playFrames?.length ?? 0;
    setFrameIdx((i) => (n === 0 ? 0 : Math.min(i, n - 1)));
  }, [playFrames?.length]);
  // Transport-driven preview: advance by each frame's own duration, always looping
  // (the asset's loop mode governs runtime playback, not this editor preview).
  useEffect(() => {
    if (!playing || !playFrames || playFrames.length < 2) return;
    const durMs = (j: number) => Math.max(16, (playFrames[j].duration ?? 1 / playFps) * 1000);
    let live = true;
    let h: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!live) return;
      const next = (frameIdxRef.current + 1) % playFrames.length;
      setFrameIdx(next);
      h = setTimeout(tick, durMs(next));
    };
    h = setTimeout(tick, durMs(frameIdxRef.current));
    return () => { live = false; clearTimeout(h); };
  }, [playing, playFrames, playFps]);

  if (!asset) {
    return <EmptyState icon={Film} title={t('fb.noOpen')} hint={t('fb.noOpenHint')} />;
  }

  const fps = asset.fps ?? 12;
  const cols = sheet ? animClipSheetCols(sheet) : 0;
  const rows = sheet ? animClipSheetRows(sheet) : 0;
  const cellCount = cols * rows;

  const thumbFor = (f: AnimClipFrameData, size = THUMB): CSSProperties => {
    if (sheet && texUrl && f.cell !== undefined) {
      return cellThumbStyle(texUrl, sheet, cols, Math.min(f.cell, Math.max(0, cellCount - 1)), size);
    }
    // Legacy per-texture frame: show the whole referenced image.
    const fi = f.texture ? AssetRegistry.assetInfo(f.texture) : null;
    return fi
      ? { width: size, height: size, backgroundImage: `url(estella://project/${fi.path})`, backgroundSize: 'contain' }
      : { width: size, height: size };
  };

  const curFrame = Math.min(frameIdx, Math.max(0, asset.frames.length - 1));

  // Anchors: the clip drives Sprite.pivot only once it authors one. The stage
  // handle edits the CURRENT frame; the clip-wide default lives in the inspector.
  const anchors = animClipDrivesPivot(asset);
  const curPivot: AnimClipPivotData =
    anchorDrag ?? (asset.frames[curFrame] ? animClipFramePivot(asset, asset.frames[curFrame]) : null) ?? { x: 0.5, y: 0.5 };
  const pivotFromPointer = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): AnimClipPivotData => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return {
      x: round(clamp01((e.clientX - r.left) / (r.width || 1))),
      // Bottom-up, because that is the space Sprite.pivot is in.
      y: round(clamp01(1 - (e.clientY - r.top) / (r.height || 1))),
    };
  };

  // Onion skin: ghost the nearest frames behind the current one, fading with
  // distance. Only while paused — during playback the trail is just noise.
  const STAGE = 152;
  const onionGhosts: { i: number; dir: number; op: number }[] = [];
  if (onion && !playing && asset.frames.length > 1) {
    const n = asset.frames.length;
    const depth = Math.min(onionFrames, n - 1);
    for (let d = 1; d <= depth; d++) {
      onionGhosts.push({ i: (curFrame - d + n) % n, dir: -1, op: 0.5 / (d + 0.4) });
      onionGhosts.push({ i: (curFrame + d) % n, dir: 1, op: 0.5 / (d + 0.4) });
    }
  }

  const commitStroke = () => {
    const s = strokeRef.current;
    if (s && s.length > 0) AnimClipCommands.appendFrames(s);
    setStroke(null);
  };

  const frameUse = new Set(asset.frames.map((f) => f.cell).filter((c): c is number => c !== undefined));
  const defaultMs = Math.round(1000 / fps);

  const cells = [];
  if (sheet && texUrl) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = row * cols + col;
        const left = (sheet.margin + col * (sheet.cellWidth + sheet.spacing)) * zoom;
        const top = (sheet.margin + row * (sheet.cellHeight + sheet.spacing)) * zoom;
        const pending = stroke?.includes(cell);
        cells.push(
          <div
            key={cell}
            className={'fb-cell' + (frameUse.has(cell) ? ' is-used' : '') + (pending ? ' is-pending' : '')}
            style={{ left, top, width: sheet.cellWidth * zoom, height: sheet.cellHeight * zoom }}
            title={t('fb.cell.appendTip', { cell })}
            onPointerDown={(e) => { e.preventDefault(); setStroke([cell]); }}
            onPointerEnter={() => {
              const s = strokeRef.current;
              if (s && !s.includes(cell)) setStroke([...s, cell]);
            }}
          />,
        );
      }
    }
  }

  return (
    <div
      className="fb-editor"
      tabIndex={0}
      onKeyDown={(e) => {
        // A field owns its own typing/backspace.
        const el = e.target as HTMLElement;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
        // This editor OWNS Delete/Backspace — remove the current frame, and never let
        // the key fall through to the global entity-delete and wipe the scene
        // selection sitting behind the panel.
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          e.stopPropagation();
          if (asset.frames.length) AnimClipCommands.removeFrame(curFrame);
        }
      }}
    >
      <div className="fb-toolbar">
        {sheet && (
          <>
            <GridField label={t('fb.field.cellW')} value={sheet.cellWidth} min={1} onCommit={(n) => AnimClipCommands.setGrid({ cellWidth: n })} />
            <GridField label={t('fb.field.cellH')} value={sheet.cellHeight} min={1} onCommit={(n) => AnimClipCommands.setGrid({ cellHeight: n })} />
            <GridField label={t('fb.field.margin')} value={sheet.margin} onCommit={(n) => AnimClipCommands.setGrid({ margin: n })} />
            <GridField label={t('fb.field.spacing')} value={sheet.spacing} onCommit={(n) => AnimClipCommands.setGrid({ spacing: n })} />
            <span className="fb-sep" />
          </>
        )}
        <ZoomControl zoom={zoom} min={0.1} onZoom={setZoom} onFit={fitZoom} />
        <span className="fb-grow" />
        <span className="fb-stat">
          {sheet ? `${cols}×${rows} · ` : ''}{t('fb.frameCount', { count: asset.frames.length })}
        </span>
        <SaveButton dirty={meta.dirty} onSave={() => void AnimClipCommands.save()} />
      </div>

      {asset.frames.length > 0 && (
        <div className="fb-pv">
          <div className="fb-pv__view">
            {onionGhosts.map((g) => (
              <span
                key={`${g.dir}-${g.i}`}
                className={`fb-thumb fb-pv__ghost fb-pv__ghost--${g.dir < 0 ? 'prev' : 'next'}`}
                style={{ ...thumbFor(asset.frames[g.i], STAGE), opacity: g.op }}
              />
            ))}
            <span className="fb-thumb fb-pv__cur" style={thumbFor(asset.frames[curFrame], STAGE)} title={t('fb.preview')} />
            {anchors && (() => {
              const box = thumbFor(asset.frames[curFrame], STAGE);
              return (
                <span
                  className="fb-pv__anchor"
                  style={{ width: box.width, height: box.height }}
                  title={t('fb.anchor.dragTip')}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    // Capture keeps the drag alive past the box edge; a pointer the
                    // browser no longer considers active throws instead, and losing
                    // capture must not lose the drag.
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* drag without capture */ }
                    setPlaying(false);
                    setAnchorDrag(pivotFromPointer(e));
                  }}
                  onPointerMove={(e) => { if (anchorDrag) setAnchorDrag(pivotFromPointer(e)); }}
                  onPointerUp={(e) => {
                    if (!anchorDrag) return;
                    const p = pivotFromPointer(e);
                    setAnchorDrag(null);
                    AnimClipCommands.setFramePivot(curFrame, p);
                  }}
                  // A cancelled pointer (released off-window, touch interrupted) must
                  // drop the preview rather than leave the crosshair parked mid-drag.
                  onPointerCancel={() => setAnchorDrag(null)}
                >
                  <span
                    className="fb-pv__anchor-dot"
                    style={{ left: `${curPivot.x * 100}%`, bottom: `${curPivot.y * 100}%` }}
                  />
                </span>
              );
            })()}
          </div>
          <div className="fb-pv__bar">
            <Transport
              playing={playing}
              onPlayPause={() => setPlaying((p) => !p)}
              onJumpStart={() => { setPlaying(false); setFrameIdx(0); }}
              onJumpEnd={() => { setPlaying(false); setFrameIdx(asset.frames.length - 1); }}
              onStepBack={() => { setPlaying(false); setFrameIdx((i) => (i - 1 + asset.frames.length) % asset.frames.length); }}
              onStepForward={() => { setPlaying(false); setFrameIdx((i) => (i + 1) % asset.frames.length); }}
              stepBackTitle={t('fb.prevFrame')}
              stepForwardTitle={t('fb.nextFrame')}
              frame={curFrame}
              frameCount={asset.frames.length}
            />
            <span className="fb-grow" />
            {/* fps + loop live here too, not only in the Details inspector (which
                vanishes the moment you select an entity). */}
            <GridField label={t('fb.fps')} value={fps} min={1} onCommit={(n) => AnimClipCommands.setFps(n)} />
            <label className="fb-field" title={t('fb.loop')}>
              <input type="checkbox" checked={asset.loop ?? true} onChange={(e) => AnimClipCommands.setLoop(e.target.checked)} />
              <span>{t('fb.loop')}</span>
            </label>
            <label className="fb-field" title={t('fb.anchor.tip')}>
              <input
                type="checkbox" checked={anchors}
                onChange={(e) => AnimClipCommands.setAnchorsEnabled(e.target.checked)}
              />
              <span>{t('fb.anchor')}</span>
            </label>
            {anchors && (
              <span className="fb-anchor" title={t('fb.anchor.frameTip')}>
                <GridField
                  label={t('fb.anchor.x')} value={curPivot.x} min={-1} max={2} decimals={3}
                  onCommit={(n) => AnimClipCommands.setFramePivot(curFrame, { x: n, y: curPivot.y })}
                />
                <GridField
                  label={t('fb.anchor.y')} value={curPivot.y} min={-1} max={2} decimals={3}
                  onCommit={(n) => AnimClipCommands.setFramePivot(curFrame, { x: curPivot.x, y: n })}
                />
                {asset.frames[curFrame]?.pivot && (
                  <button
                    type="button" className="fb-fx" title={t('fb.anchor.clearFrame')}
                    onClick={() => AnimClipCommands.setFramePivot(curFrame, undefined)}
                  >
                    <X size={11} strokeWidth={2.2} />
                  </button>
                )}
              </span>
            )}
            <label className="fb-field fb-onion" title={t('fb.onionTip')}>
              <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} />
              <span>{t('fb.onion')}</span>
            </label>
            {onion && (
              <GridField
                label={t('fb.onionFrames')}
                value={onionFrames}
                min={1}
                onCommit={(n) => setOnionFrames(Math.max(1, Math.min(5, Math.round(n))))}
              />
            )}
          </div>
        </div>
      )}

      <div className="fb-frames">
        {asset.frames.map((f, i) => {
          const invalid = f.cell !== undefined && f.cell >= cellCount;
          return (
            <span
              key={`${i}-${f.cell ?? f.texture}`}
              className={'fb-frame' + (invalid ? ' is-invalid' : '') + (dragFrame === i ? ' is-dragging' : '') + (i === curFrame ? ' is-current' : '')}
              draggable
              onDragStart={(e: DragEvent) => { e.dataTransfer.setData('text/plain', String(i)); setDragFrame(i); }}
              onDragEnd={() => setDragFrame(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                if (Number.isInteger(from)) AnimClipCommands.moveFrame(from, i);
                setDragFrame(null);
              }}
              title={invalid ? t('fb.frame.invalidTip', { cell: f.cell ?? 0 }) : undefined}
            >
              {asset.events?.some((e) => e.frame === i) && <span className="fb-frame__evt" title={t('fb.event.onFrame')} />}
              {f.pivot && <span className="fb-frame__pin" title={t('fb.anchor.overridden')} />}
              <span
                className="fb-thumb fb-frame__thumb" style={thumbFor(f)}
                title={t('fb.frame.scrubTip')}
                onClick={() => { setPlaying(false); setFrameIdx(i); }}
              />
              <input
                key={`${i}-${f.duration ?? ''}`}
                className="fb-dur"
                defaultValue={f.duration !== undefined ? Math.round(f.duration * 1000) : ''}
                placeholder={String(defaultMs)}
                title={t('fb.frame.durTip')}
                spellCheck={false}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '') {
                    if (f.duration !== undefined) AnimClipCommands.setFrameDuration(i, undefined);
                    return;
                  }
                  const n = parseInt(raw, 10);
                  if (Number.isFinite(n) && n > 0 && n / 1000 !== f.duration) AnimClipCommands.setFrameDuration(i, n / 1000);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button
                type="button" className="fb-fx" title={t('fb.frame.remove')}
                onClick={() => AnimClipCommands.removeFrame(i)}
              >
                <X size={11} strokeWidth={2.2} />
              </button>
            </span>
          );
        })}
        <span className="fb-hint">
          {!sheet ? t('fb.noSheet') : asset.frames.length === 0 ? t('fb.addFrames') : t('fb.appendFrames')}
        </span>
        <span className="fb-grow" />
        {asset.frames.length > 0 && (
          <button type="button" className="fb-clear" title={t('fb.clearFrames')} onClick={() => AnimClipCommands.clearFrames()}>
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {asset.frames.length > 0 && (
        <div className="fb-events">
          <span className="fb-events__head">
            <span>{t('fb.events')}</span>
            <button
              type="button"
              className="fb-events__add"
              title={t('fb.addEvent')}
              onClick={() => AnimClipCommands.addEvent(curFrame, t('fb.event.default'))}
            >
              <Plus size={12} /> {t('fb.addEvent')}
            </button>
          </span>
          {(asset.events ?? []).map((ev, i) => (
            <span key={i} className="fb-event">
              <button
                type="button"
                className="fb-event__frame"
                title={t('fb.event.onFrame')}
                onClick={() => { setPlaying(false); setFrameIdx(Math.min(ev.frame, asset.frames.length - 1)); }}
              >
                {ev.frame}
              </button>
              <input
                key={`${i}-${ev.name}`}
                className="fb-event__name"
                defaultValue={ev.name}
                spellCheck={false}
                onBlur={(e) => AnimClipCommands.setEventName(i, e.target.value.trim())}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button type="button" className="fb-event__x" title={t('fb.event.remove')} onClick={() => AnimClipCommands.removeEvent(i)}>
                <X size={10} strokeWidth={2.2} />
              </button>
            </span>
          ))}
          {(asset.events?.length ?? 0) === 0 && <span className="fb-hint">{t('fb.events.empty')}</span>}
        </div>
      )}

      {sheet && (
        <div ref={canvasRef} className="fb-canvas" onPointerUp={commitStroke} onPointerLeave={commitStroke}>
          {!texUrl ? (
            <div className="fb-warn">{t('fb.texNotFound', { ref: String(sheet.texture) || t('fb.refEmpty') })}</div>
          ) : (
            <div className="fb-stage" style={{ width: sheet.pageWidth * zoom, height: sheet.pageHeight * zoom }}>
              <img
                className="fb-img" src={texUrl} alt="" draggable={false}
                onLoad={(e) => {
                  // The image's natural size is the UV page size; re-bake if the
                  // texture changed on disk since the clip was authored.
                  const el = e.currentTarget;
                  AnimClipCommands.bakePageSize(el.naturalWidth, el.naturalHeight);
                }}
              />
              {cells}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
