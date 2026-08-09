// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NineSliceEditor.tsx
 * @brief   Drag the 9-slice border straight on the sprite, in the asset
 *          inspector — the visual half of the four `sliceBorder.*` numbers.
 *
 * The border is import-time data (a texture's `.meta`), so this writes through
 * the SAME `FieldWrite` door the numeric fields use: the numbers, the dirty dot
 * and Save all keep working, and there is no second path into the `.meta`. The
 * control is a derived VIEW of those four fields, never its own state — the one
 * exception being the edge currently under the pointer, which is transient
 * interaction state.
 *
 * Geometry (letterbox fit, box↔texture conversion, the clamping that keeps a
 * centre slice alive) lives in `project/nineSlice.ts` as pure functions.
 */
import { useEffect, useRef, useState } from 'react';
import { useElementSize } from '@/components/useElementSize';
import { t } from '@/i18n';
import type { FieldWrite } from '@/types';
import {
  SLICE_EDGES, borderFromImporter, clampBorder, edgeFromPointer, fitRect,
  guidePosition, hasBorder, isHorizontalEdge, pickEdge,
  type SliceEdge,
} from '@/project/nineSlice';

/** Box height — tall enough to aim a guide at, short enough that Import
 *  Settings still open above the fold. */
const BOX_H = 168;

const EDGE_LABEL = {
  left: 'det.sliceLeft',
  right: 'det.sliceRight',
  top: 'det.sliceTop',
  bottom: 'det.sliceBottom',
} as const;

export function NineSliceEditor({ path, importer, write }: {
  path: string;
  importer: Record<string, unknown> | null;
  write: FieldWrite;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [tex, setTex] = useState<{ w: number; h: number } | null>(null);
  // The drawn box is width-fluid (the inspector column), so measure it.
  const box = useElementSize(boxRef);
  const [drag, setDrag] = useState<SliceEdge | null>(null);
  const [hover, setHover] = useState<SliceEdge | null>(null);

  // The texture's natural size — the units the border is expressed in.
  useEffect(() => {
    let alive = true;
    setTex(null);
    const img = new Image();
    img.onload = () => alive && setTex({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `estella://project/${path}`;
    return () => { alive = false; };
  }, [path]);


  const texW = tex?.w ?? 0;
  const texH = tex?.h ?? 0;
  // Values straight from the `.meta`, clamped for display: a hand-edited block
  // can hold a border that would collapse the centre slice.
  const border = clampBorder(borderFromImporter(importer), texW, texH);
  const fit = fitRect(texW, texH, box.w, box.h);

  const pointerIn = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (fit.scale <= 0) return;
    const edge = pickEdge(pointerIn(e), border, fit, texW, texH);
    if (!edge) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(edge);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (fit.scale <= 0) return;
    const at = pointerIn(e);
    if (!drag) {
      setHover(pickEdge(at, border, fit, texW, texH));
      return;
    }
    const next = edgeFromPointer(drag, at, fit, border, texW, texH);
    if (next !== border[drag]) write(`sliceBorder.${drag}`, 'number', next);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDrag(null);
  };

  const active = drag ?? hover;
  const guides = fit.scale > 0
    ? SLICE_EDGES.map((edge) => ({ edge, at: guidePosition(edge, border, fit, texW, texH) }))
    : [];

  return (
    <div className="nse">
      <div
        ref={boxRef}
        className={`nse-box${drag ? ' is-dragging' : ''}`}
        style={{ height: BOX_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !drag && setHover(null)}
        title={t('det.sliceDragTip')}
      >
        {tex && (
          <img
            className="nse-img"
            src={`estella://project/${path}`}
            alt=""
            draggable={false}
            style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
          />
        )}
        {/* The centre slice — the region that stretches. Shading it is what makes
            the border read as a 3x3 at a glance. */}
        {fit.scale > 0 && hasBorder(border) && (
          <div
            className="nse-center"
            style={{
              left: guidePosition('left', border, fit, texW, texH),
              top: guidePosition('top', border, fit, texW, texH),
              width: Math.max(0, guidePosition('right', border, fit, texW, texH) - guidePosition('left', border, fit, texW, texH)),
              height: Math.max(0, guidePosition('bottom', border, fit, texW, texH) - guidePosition('top', border, fit, texW, texH)),
            }}
          />
        )}
        {guides.map(({ edge, at }) => (
          <div
            key={edge}
            className={`nse-guide ${isHorizontalEdge(edge) ? 'v' : 'h'}${active === edge ? ' is-active' : ''}`}
            style={isHorizontalEdge(edge) ? { left: at } : { top: at }}
          />
        ))}
        {!tex && <div className="nse-empty">{t('det.sliceNoImage')}</div>}
      </div>
      <div className="nse-read">
        {SLICE_EDGES.map((edge) => (
          <span key={edge} className={`nse-val${active === edge ? ' is-active' : ''}`}>
            <em>{t(EDGE_LABEL[edge])}</em>
            {border[edge]}
          </span>
        ))}
        {tex && <span className="nse-dim">{texW} × {texH}</span>}
      </div>
    </div>
  );
}
