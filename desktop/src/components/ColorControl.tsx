// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ColorControl.tsx
 * @brief   The shared color field — a swatch + hex box opening a themed HSV +
 *          alpha picker (`.sw`/`.cp-*`, theme/inspector.css). The value is
 *          `#rrggbbaa`, so alpha is editable (the native <input type=color>
 *          can't). Local HSV state preserves hue while dragging at zero
 *          saturation/value; the whole picker session is one undo step (begin
 *          on open, end on close). The hex box accepts 6- or 8-digit input.
 */
import { useRef, useState } from 'react';
import { hexToRgba } from '@/engine/schema';
import type { ControlGesture } from './NumField';
import { Popover, usePopover } from './Popover';

// — Color math (0..1 channels) —
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const hch = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');
export const rgbaToHex8 = (r: number, g: number, b: number, a: number) => `#${hch(r)}${hch(g)}${hch(b)}${hch(a)}`;
const rgbCss = (r: number, g: number, b: number) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const seq: [number, number, number][] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
  return seq[((i % 6) + 6) % 6];
}

// A drag track: pointer down/move within `ref` reports the normalized [0..1]
// position (x, y). Used by the color picker's SV square, hue and alpha bars.
function useDragTrack(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const handle = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onMove(clamp01(r.width ? (clientX - r.left) / r.width : 0), clamp01(r.height ? (clientY - r.top) / r.height : 0));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      active.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      handle(e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (active.current) handle(e.clientX, e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      active.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
  };
}

export function ColorControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; mixed?: boolean; onChange: (v: string) => void }) {
  const pop = usePopover();
  const sw = useRef<HTMLButtonElement>(null);
  const { r, g, b, a } = hexToRgba(value);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(r, g, b));
  const [alpha, setAlpha] = useState(a);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  const emit = (h: number, s: number, v: number, al: number) => {
    const [rr, gg, bb] = hsvToRgb(h, s, v);
    onChange(rgbaToHex8(rr, gg, bb, al));
  };
  // Typed hex (6- or 8-digit): echo it raw, and on a valid value sync the picker
  // cursors + commit. A hex box reuses the open popover's gesture (no double-begin).
  const focusHex = () => {
    setText(value);
    setEditing(true);
    if (!pop.isOpen) onBegin?.();
  };
  const blurHex = () => {
    setEditing(false);
    if (!pop.isOpen) onEnd?.();
  };
  const typeHex = (raw: string) => {
    setText(raw);
    if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw.trim())) {
      const c = hexToRgba(raw);
      setHsv(rgbToHsv(c.r, c.g, c.b));
      setAlpha(c.a);
      onChange(rgbaToHex8(c.r, c.g, c.b, c.a));
    }
  };
  const open = () => {
    const c = hexToRgba(value);
    setHsv(rgbToHsv(c.r, c.g, c.b));
    setAlpha(c.a);
    setText(value);
    onBegin?.();
    pop.open(sw.current);
  };
  const close = () => {
    pop.close();
    onEnd?.();
  };

  const sv = useDragTrack((x, y) => {
    const next: [number, number, number] = [hsv[0], x, 1 - y];
    setHsv(next);
    emit(next[0], next[1], next[2], alpha);
  });
  const hue = useDragTrack((x) => {
    const next: [number, number, number] = [x, hsv[1], hsv[2]];
    setHsv(next);
    emit(next[0], next[1], next[2], alpha);
  });
  const alp = useDragTrack((x) => {
    setAlpha(x);
    emit(hsv[0], hsv[1], hsv[2], x);
  });
  const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1); // pure hue for the SV backdrop
  const [cr, cg, cb] = hsvToRgb(hsv[0], hsv[1], hsv[2]);

  return (
    <>
      <button ref={sw} type="button" className="sw" onMouseDown={(e) => e.stopPropagation()} onClick={open}>
        {/* Multi-select with differing colors: a striped swatch + "—" hex, so a nudge
            doesn't silently overwrite every entity with the first one's color. */}
        <span
          className="sw-fill"
          style={mixed
            ? { background: 'repeating-linear-gradient(45deg,#5a5a5a 0 5px,#3a3a3a 5px 10px)' }
            : { background: rgbCss(r, g, b), opacity: a }}
        />
      </button>
      <span className="field">
        <input value={editing ? text : mixed ? '' : value} placeholder={mixed ? '—' : undefined} spellCheck={false} onFocus={focusHex} onBlur={blurHex} onChange={(e) => typeHex(e.target.value)} />
      </span>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={200} onClose={close}>
          <div className="cp">
            <div className="cp-sv" {...sv} style={{ background: rgbCss(hr, hg, hb) }}>
              <div className="cp-sv-white" />
              <div className="cp-sv-black" />
              <div className="cp-dot" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
            </div>
            <div className="cp-hue" {...hue}>
              <div className="cp-bar-dot" style={{ left: `${hsv[0] * 100}%` }} />
            </div>
            <div className="cp-alpha" {...alp}>
              <div className="cp-alpha-fill" style={{ background: `linear-gradient(90deg, transparent, ${rgbCss(cr, cg, cb)})` }} />
              <div className="cp-bar-dot" style={{ left: `${alpha * 100}%` }} />
            </div>
            <input
              className="cp-hex"
              value={editing ? text : value}
              spellCheck={false}
              onFocus={focusHex}
              onBlur={blurHex}
              onChange={(e) => typeHex(e.target.value)}
            />
          </div>
        </Popover>
      )}
    </>
  );
}
