// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SequencerCurve.tsx
 * @brief   Curve editor view for the Sequencer (docs/REARCH_ANIMATION.md P3).
 *
 * Best-architecture point: the curves are drawn by sampling the SAME runtime
 * evaluator (`evaluateChannel`) the playback/preview uses — so the displayed curve
 * is exactly what plays (WYSIWYG), with no parallel curve math. Editing a key's
 * value/time or its in/out tangent handles writes the very keyframe fields the
 * hermite evaluator reads, so the curve and the animation can never diverge.
 *
 * Lines render in one stretched SVG (non-scaling stroke); interactive points and
 * tangent handles are DOM elements (crisp, easy hit-testing) — mirroring how the
 * dope sheet renders keys as DOM.
 */

import { useRef, useState } from 'react';
import { evaluateChannel, type TimelineAsset, type Keyframe } from 'esengine';
import { TimelineCommands } from '@/timeline/TimelineCommands';
import { useSequencerStore } from '@/store/sequencerStore';
import { findChannel, timeToPct, type SeqRow } from '@/timeline/timelineView';

const PAD_T = 8;
const PAD_B = 8;
const SAMPLES = 100;
const PALETTE = ['var(--ax-x)', 'var(--ax-y)', 'var(--acc-hi)', '#c9a14e', '#9b8fc0', '#7faf9c'];

interface CurveChannel {
  row: SeqRow;
  keyframes: Keyframe[];
  color: string;
}

export function SequencerCurve({
  asset,
  rows,
  duration,
  selectedKey,
  timeFromClientX,
  snapTime,
}: {
  asset: TimelineAsset;
  rows: SeqRow[];
  duration: number;
  selectedKey: string | null;
  timeFromClientX: (clientX: number) => number;
  snapTime: (t: number) => number;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ rowId: string; fromTime: number; time: number; value: number } | null>(null);

  const channels: CurveChannel[] = [];
  rows.forEach((row) => {
    if (row.kind !== 'channel' || !row.ref) return;
    const ch = findChannel(asset, row.ref);
    if (ch && ch.keyframes.length) channels.push({ row, keyframes: ch.keyframes, color: PALETTE[channels.length % PALETTE.length] });
  });

  // Shared value space (auto-fit to all visible keyframes, padded).
  let min = Infinity;
  let max = -Infinity;
  for (const c of channels) for (const k of c.keyframes) {
    if (k.value < min) min = k.value;
    if (k.value > max) max = k.value;
  }
  if (!isFinite(min)) { min = 0; max = 1; }
  if (max - min < 1e-6) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  const range = max - min;

  const valueToYPct = (v: number) => PAD_T + (1 - (v - min) / range) * (100 - PAD_T - PAD_B);
  const valueFromClientY = (clientY: number): number => {
    const r = areaRef.current?.getBoundingClientRect();
    if (!r) return 0;
    const pct = ((clientY - r.top) / r.height) * 100;
    const norm = 1 - (pct - PAD_T) / (100 - PAD_T - PAD_B);
    return min + norm * range;
  };

  const onPointDown = (e: React.PointerEvent, row: SeqRow, kf: Keyframe) => {
    e.stopPropagation();
    useSequencerStore.getState().setPlaying(false);
    useSequencerStore.getState().selectKey(`${row.id}@${kf.time}`);
    const sx = e.clientX, sy = e.clientY;
    let moved = false, curT = kf.time, curV = kf.value;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      moved = true;
      curT = snapTime(timeFromClientX(ev.clientX));
      curV = valueFromClientY(ev.clientY);
      setDrag({ rowId: row.id, fromTime: kf.time, time: curT, value: curV });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (moved && row.ref) {
        TimelineCommands.editKey(row.ref, kf.time, curT, curV);
        useSequencerStore.getState().selectKey(`${row.id}@${curT}`);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drag a tangent handle of the selected key → set in/out slope.
  const onHandleDown = (e: React.PointerEvent, row: SeqRow, kf: Keyframe, side: 'in' | 'out') => {
    e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const t = timeFromClientX(ev.clientX);
      const v = valueFromClientY(ev.clientY);
      const dt = side === 'out' ? t - kf.time : kf.time - t;
      if (Math.abs(dt) < 1e-4 || !row.ref) return;
      const slope = side === 'out' ? (v - kf.value) / dt : (kf.value - v) / dt;
      TimelineCommands.setKeyTangents(
        row.ref,
        kf.time,
        side === 'in' ? slope : kf.inTangent,
        side === 'out' ? slope : kf.outTangent,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const HL = duration * 0.08; // tangent-handle length, in seconds

  return (
    <div className="seq-curve" ref={areaRef}>
      <div className="seq-curve__axis">
        <span style={{ top: `${valueToYPct(max - pad)}%` }}>{(max - pad).toFixed(1)}</span>
        <span style={{ top: `${valueToYPct((min + max) / 2)}%` }}>{((min + max) / 2).toFixed(1)}</span>
        <span style={{ top: `${valueToYPct(min + pad)}%` }}>{(min + pad).toFixed(1)}</span>
      </div>

      <svg className="seq-curve__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {channels.map((c) => {
          let d = '';
          for (let i = 0; i <= SAMPLES; i++) {
            const t = (i / SAMPLES) * duration;
            const x = timeToPct(t, duration);
            const y = valueToYPct(evaluateChannel({ property: '', keyframes: c.keyframes }, t));
            d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
          }
          return <path key={c.row.id} d={d} fill="none" style={{ stroke: c.color }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>

      {channels.map((c) =>
        c.keyframes.map((kf) => {
          const isDrag = drag?.rowId === c.row.id && Math.abs(drag.fromTime - kf.time) < 1e-4;
          const t = isDrag ? drag!.time : kf.time;
          const v = isDrag ? drag!.value : kf.value;
          const selected = selectedKey === `${c.row.id}@${kf.time}`;
          return (
            <div key={`${c.row.id}/${kf.time}`}>
              {selected && !isDrag && (
                <>
                  <Handle x={timeToPct(kf.time - HL, duration)} y={valueToYPct(kf.value - kf.inTangent * HL)} color={c.color} onDown={(e) => onHandleDown(e, c.row, kf, 'in')} />
                  <Handle x={timeToPct(kf.time + HL, duration)} y={valueToYPct(kf.value + kf.outTangent * HL)} color={c.color} onDown={(e) => onHandleDown(e, c.row, kf, 'out')} />
                </>
              )}
              <div
                className={`seq-cpt${selected ? ' sel' : ''}`}
                style={{ left: `${timeToPct(t, duration)}%`, top: `${valueToYPct(v)}%`, borderColor: c.color }}
                title={`${c.row.label} = ${v.toFixed(2)}`}
                onPointerDown={(e) => onPointDown(e, c.row, kf)}
              />
            </div>
          );
        }),
      )}
    </div>
  );
}

function Handle({ x, y, color, onDown }: { x: number; y: number; color: string; onDown: (e: React.PointerEvent) => void }) {
  return (
    <div className="seq-chandle" style={{ left: `${x}%`, top: `${y}%`, background: color }} onPointerDown={onDown} />
  );
}
