// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FlipbookEditor.tsx
 * @brief   The .esanim sprite-flipbook editor panel — the sheet texture with a
 *          slicing-grid overlay (click or drag cells to append frames) over a
 *          frame strip with per-frame durations, fps/loop, and a live looping
 *          preview. Subscribes to the reactive AnimClipDocument; mutations go
 *          through AnimClipCommands (one undo step each).
 */

import {
  useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type DragEvent,
} from 'react';
import { Save, Trash2, X } from 'lucide-react';
import {
  animClipSheetCols, animClipSheetRows,
  type AnimClipFrameData, type AnimClipSheetData,
} from 'esengine';
import { DirtyDot } from '@/components/DirtyDot';
import { GridField } from '@/components/GridField';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { AnimClipCommands } from '@/flipbook/AnimClipCommands';
import { ProjectStore } from '@/project/ProjectStore';
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

/** Loops the frame strip with per-frame durations (1/fps when a frame has none). */
function FlipbookPreview(props: {
  frames: AnimClipFrameData[];
  fps: number;
  thumb: (f: AnimClipFrameData) => CSSProperties;
}) {
  const { frames, fps, thumb } = props;
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (frames.length < 2) return;
    const durMs = (j: number) => Math.max(16, (frames[j].duration ?? 1 / fps) * 1000);
    let idx = 0;
    let live = true;
    let h: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!live) return;
      idx = (idx + 1) % frames.length;
      setI(idx);
      h = setTimeout(tick, durMs(idx));
    };
    h = setTimeout(tick, durMs(0));
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [frames, fps]);
  if (frames.length === 0) return null;
  return <span className="fb-thumb fb-preview" style={thumb(frames[Math.min(i, frames.length - 1)])} title={t('fb.preview')} />;
}

export function FlipbookEditor() {
  useSyncExternalStore(AnimClipDocument.subscribe, AnimClipDocument.getRevision);
  const asset = AnimClipDocument.asset;
  const meta = AnimClipDocument.meta;

  const sheet = asset?.sheet;
  const info = sheet ? ProjectStore.assetInfo(sheet.texture) : null;
  const texUrl = info ? `estella://project/${info.path}` : null;

  const [zoom, setZoom] = useState(2);
  // Live append stroke: ordered cells picked in one pointer gesture, one undo step.
  const [stroke, setStroke] = useState<number[] | null>(null);
  const strokeRef = useRef(stroke);
  strokeRef.current = stroke;
  const [dragFrame, setDragFrame] = useState<number | null>(null);

  if (!asset) {
    return (
      <div className="fb-empty">
        <p>{t('fb.noOpen')}</p>
        <p className="fb-hint">{t('fb.noOpenHint')}</p>
      </div>
    );
  }

  const fps = asset.fps ?? 12;
  const cols = sheet ? animClipSheetCols(sheet) : 0;
  const rows = sheet ? animClipSheetRows(sheet) : 0;
  const cellCount = cols * rows;

  const thumbFor = (f: AnimClipFrameData): CSSProperties => {
    if (sheet && texUrl && f.cell !== undefined) {
      return cellThumbStyle(texUrl, sheet, cols, Math.min(f.cell, Math.max(0, cellCount - 1)), THUMB);
    }
    // Legacy per-texture frame: show the whole referenced image.
    const fi = f.texture ? ProjectStore.assetInfo(f.texture) : null;
    return fi
      ? { width: THUMB, height: THUMB, backgroundImage: `url(estella://project/${fi.path})`, backgroundSize: 'contain' }
      : { width: THUMB, height: THUMB };
  };

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
    <div className="fb-editor">
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
        <GridField label={t('fb.field.fps')} value={fps} min={1} onCommit={(n) => AnimClipCommands.setFps(n)} />
        <label className="fb-field fb-loop">
          <input
            type="checkbox" checked={asset.loop ?? true}
            onChange={(e) => AnimClipCommands.setLoop(e.target.checked)}
          />
          <span>{t('fb.loop')}</span>
        </label>
        <span className="fb-sep" />
        <label className="fb-field">
          <span>{t('fb.field.zoom')}</span>
          <input type="range" min={1} max={8} step={1} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <span className="fb-grow" />
        <span className="fb-stat">
          {sheet ? `${cols}×${rows} · ` : ''}{t('fb.frameCount', { count: asset.frames.length })}
        </span>
        <button type="button" className="fb-save" onClick={() => void AnimClipCommands.save()} disabled={!meta.dirty}>
          <Save size={13} /> {t('fb.save')}{meta.dirty && <DirtyDot />}
        </button>
      </div>

      <div className="fb-frames">
        <FlipbookPreview frames={asset.frames} fps={fps} thumb={thumbFor} />
        {asset.frames.map((f, i) => {
          const invalid = f.cell !== undefined && f.cell >= cellCount;
          return (
            <span
              key={`${i}-${f.cell ?? f.texture}`}
              className={'fb-frame' + (invalid ? ' is-invalid' : '') + (dragFrame === i ? ' is-dragging' : '')}
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
              <span className="fb-thumb" style={thumbFor(f)} />
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

      {sheet && (
        <div className="fb-canvas" onPointerUp={commitStroke} onPointerLeave={commitStroke}>
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
