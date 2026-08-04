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
// onCancel aborts the open gesture — restoring EACH entity's own pre-edit value
// (not the primary's) and recording no undo step — so Escape truly cancels even
// on a mixed multi-selection.
export interface ControlGesture {
  onBegin?: () => void;
  onEnd?: () => void;
  onCancel?: () => void;
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
  step,
  min,
  max,
  onBegin,
  onEnd,
  onCancel,
  onCommit,
}: ControlGesture & { value: number; suffix?: string; mixed?: boolean; empty?: boolean; placeholder?: string; step?: number; min?: number; max?: number; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const startValue = useRef(value); // pre-edit value, for Escape-revert
  return (
    <span className="field">
      <input
        value={editing ? text : mixed || empty ? '' : fmt(value) + (suffix ?? '')}
        placeholder={mixed ? '—' : empty ? placeholder : undefined}
        spellCheck={false}
        onFocus={() => {
          startValue.current = value;
          setText(empty ? '' : fmt(value));
          setEditing(true);
          onBegin?.();
        }}
        onBlur={() => {
          setEditing(false);
          onEnd?.();
        }}
        onKeyDown={(e) => {
          // Arrow = ±step (Shift finer ÷10, Alt coarser ×10 — the useScrub modifiers);
          // Enter commits (blur → onEnd); Escape reverts the live-committed edit.
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            // Nudge by the field's own step (Shift ÷10 finer, Alt ×10 coarser) so a
            // bounded field (e.g. a 0..1 opacity with step 0.01) nudges usefully
            // instead of jumping by a hardcoded 1; clamp to the field's range.
            const base = step ?? 1;
            const delta = e.shiftKey ? base / 10 : e.altKey ? base * 10 : base;
            const cur = Number.isFinite(parseFloat(text)) ? parseFloat(text) : value;
            let next = Math.round((cur + (e.key === 'ArrowUp' ? delta : -delta)) * 1000) / 1000;
            if (min != null) next = Math.max(min, next);
            if (max != null) next = Math.min(max, next);
            setText(fmt(next));
            onCommit(next);
          } else if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            // Cancel: abort the gesture so each (possibly multi-selected) entity
            // snaps back to its OWN pre-edit value. Falling back to broadcasting
            // the primary's startValue would clobber the rest of a mixed selection.
            if (onCancel) onCancel();
            else onCommit(startValue.current);
            setText(fmt(startValue.current));
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isNaN(n)) return;
          // Typed values clamp like every other way into this field. They used not
          // to, so dragging a slider stopped at its max while typing into the box
          // beside it wrote straight past — the same field, two different rules.
          let next = n;
          if (min != null) next = Math.max(min, next);
          if (max != null) next = Math.min(max, next);
          onCommit(next);
        }}
      />
    </span>
  );
}
