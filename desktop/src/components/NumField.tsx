// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NumField.tsx
 * @brief   The shared numeric input + drag-scrub gesture. The field itself is a
 *          plain click-to-type box (live-commit while typing); the scrub
 *          affordance lives on whatever LABEL the caller attaches `useScrub` to
 *          (the inspector's property label / colored axis tab), so the two stay
 *          composable. Styling is the `.field` well in theme/controls.css.
 */
import { useRef, useState } from 'react';

/** Numbers render with float noise rounded away (3 decimal places). */
export const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// Each control reports gesture boundaries (onBegin/onEnd) so one focus→blur, one
// click, or one drag-scrub becomes a single undo step; onCommit applies live.
export interface ControlGesture {
  onBegin?: () => void;
  onEnd?: () => void;
}

export interface ScrubOpts extends ControlGesture {
  /** Units per pixel of drag (default 0.1); Shift = ÷10, Alt = ×10. */
  step?: number;
  min?: number;
  max?: number;
}

// Drag-to-scrub. The affordance lives on the property LABEL (scalars) or the
// colored axis TAB (vectors) — NOT the input — so the field stays a plain
// click-to-type box. Press + drag horizontally to nudge; a press under the 3px
// threshold is ignored. The result clamps to [min,max] when the field is ranged.
export function useScrub(value: number, onCommit: (n: number) => void, opts: ScrubOpts = {}) {
  const scrub = useRef<{ x: number; base: number; moved: boolean } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      scrub.current = { x: e.clientX, base: value, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = scrub.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (!s.moved) {
        if (Math.abs(dx) < 3) return;
        s.moved = true;
        opts.onBegin?.();
      }
      const base = opts.step ?? 0.1;
      const step = e.shiftKey ? base / 10 : e.altKey ? base * 10 : base;
      let next = Math.round((s.base + dx * step) * 1000) / 1000;
      if (opts.min != null) next = Math.max(opts.min, next);
      if (opts.max != null) next = Math.min(opts.max, next);
      onCommit(next);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = scrub.current;
      scrub.current = null;
      if (!s) return;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (s.moved) opts.onEnd?.();
    },
  };
}

// Plain click-to-type numeric input. `suffix` (e.g. °) shows in the resting value;
// `mixed` (multi-select disagreement) shows a "—" placeholder until typed over.
// `empty` shows a blank field with `placeholder` ghost text (e.g. an `auto`
// dimension) but stays editable — typing commits a value.
export function NumField({
  value,
  suffix,
  mixed,
  empty,
  placeholder,
  onBegin,
  onEnd,
  onCommit,
}: ControlGesture & { value: number; suffix?: string; mixed?: boolean; empty?: boolean; placeholder?: string; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <span className="field">
      <input
        value={editing ? text : mixed || empty ? '' : fmt(value) + (suffix ?? '')}
        placeholder={mixed ? '—' : empty ? placeholder : undefined}
        spellCheck={false}
        onFocus={() => {
          setText(empty ? '' : fmt(value));
          setEditing(true);
          onBegin?.();
        }}
        onBlur={() => {
          setEditing(false);
          onEnd?.();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onCommit(n);
        }}
      />
    </span>
  );
}
