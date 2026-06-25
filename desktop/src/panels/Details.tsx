// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Component as ComponentIcon,
  Copy,
  Filter,
  FolderOpen,
  Image as ImageIcon,
  MoreHorizontal,
  Move3d,
  Package,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AssetIcon, assetTint } from '@/components/icons';
import { Toasts } from '@/store/Toasts';
import { baseName, assetTypeOf, TYPE_CODE, IMAGE_RE } from '@/project/assetMeta';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import { useOutliner } from '@/outliner/OutlinerController';
import { isFolderUnder, folderName } from '@/outliner/folders';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery, buildEntityInfo, buildInspector } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands, toModelValue } from '@/engine/SceneCommands';
import { PlayInspect } from '@/engine/PlayInspect';
import type { SceneData } from 'esengine';
import { modelAddableComponentEntries, subscribeSchemas, getSchemaRevision, prettyLabel, hexToRgba } from '@/engine/schema';
import { ProjectStore } from '@/project/ProjectStore';
import { ContextMenu } from '@/components/Menu';
import { Popover, usePopover } from '@/components/Popover';
import { AddComponentMenu } from '@/components/AddComponentMenu';
import type { InspectorComponent, InspectorField, InspectorFieldValue, EntityId, NodeKind, EnumOption, AssetType, GradientValue, GradientStop, CurveValue, CurveKey } from '@/types';

const AXES = ['x', 'y', 'z'];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// Field-value equality for the "modified" (override) mark. Vectors compare
// element-wise; numbers tolerate float drift so a no-op edit doesn't read as one.
function fieldEqual(a: InspectorFieldValue, b: InspectorFieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((n, i) => Math.abs(n - (b[i] as number)) < 1e-6);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

/** Whether a field differs from its reset target (prefab base, else class default). */
function isModified(f: InspectorField): boolean {
  return f.defaultValue !== undefined && !fieldEqual(f.value, f.defaultValue);
}

// Component domain → header glyph, derived from the component name (the engine
// exposes no category metadata). The icon hue is neutral by design — set in CSS.
function componentIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/transform/.test(n)) return Move3d;
  if (/camera/.test(n)) return Camera;
  if (/sprite|render|mesh|image|text|spine/.test(n)) return ImageIcon;
  if (/rigidbody|physics|body/.test(n)) return Box;
  if (/collider|collision/.test(n)) return Square;
  if (/audio|sound/.test(n)) return Volume2;
  if (/script|controller|behaviour|behavior|\bai\b|logic/.test(n)) return Code2;
  return ComponentIcon;
}

const KIND_LABEL: Record<NodeKind, string> = {
  camera: 'Camera',
  sprite: 'Sprite',
  spine: 'Spine',
  physics: 'Physics',
  ui: 'UI',
  audio: 'Audio',
  group: 'Group',
  light: 'Light',
  empty: 'Entity',
};

// Each control reports gesture boundaries (onBegin/onEnd) so one focus→blur, one
// click, or one drag-scrub becomes a single undo step; onCommit applies live.
interface ControlGesture {
  onBegin?: () => void;
  onEnd?: () => void;
}

interface ScrubOpts extends ControlGesture {
  /** Units per pixel of drag (default 0.1); Shift = ÷10, Alt = ×10. */
  step?: number;
  min?: number;
  max?: number;
}

// Drag-to-scrub. The affordance lives on the property LABEL (scalars) or the
// colored axis TAB (vectors) — NOT the input — so the field stays a plain
// click-to-type box. Press + drag horizontally to nudge; a press under the 3px
// threshold is ignored. The result clamps to [min,max] when the field is ranged.
function useScrub(value: number, onCommit: (n: number) => void, opts: ScrubOpts = {}) {
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
function NumField({
  value,
  suffix,
  mixed,
  onBegin,
  onEnd,
  onCommit,
}: ControlGesture & { value: number; suffix?: string; mixed?: boolean; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <span className="field">
      <input
        value={editing ? text : mixed ? '' : fmt(value) + (suffix ?? '')}
        placeholder={mixed ? '—' : undefined}
        spellCheck={false}
        onFocus={() => {
          setText(fmt(value));
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

// One vector component — the colored X/Y/Z tab IS the scrub handle.
function VecField({
  axis,
  value,
  mixed,
  onBegin,
  onEnd,
  onCommit,
}: ControlGesture & { axis: string; value: number; mixed?: boolean; onCommit: (n: number) => void }) {
  const scrub = useScrub(value, onCommit, { onBegin, onEnd });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <span className="vfield">
      <i className={`ax ${axis}`} {...scrub}>
        {axis.toUpperCase()}
      </i>
      <input
        value={editing ? text : mixed ? '' : fmt(value)}
        placeholder={mixed ? '—' : undefined}
        spellCheck={false}
        onFocus={() => {
          setText(fmt(value));
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

function VecControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number[]; mixed?: boolean; onChange: (v: number[]) => void }) {
  return (
    <div className="vec">
      {value.map((n, i) => (
        <VecField
          key={i}
          axis={AXES[i]}
          value={n}
          mixed={mixed}
          onBegin={onBegin}
          onEnd={onEnd}
          onCommit={(v) => {
            const next = value.slice();
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

// A named-int dropdown (e.g. Camera projection, body type) — a themed popover, not
// a native <select>, so the list matches the editor and searches when long. The
// stored value is the option's int; an unknown value shows a "(n)" placeholder.
function EnumControl({
  value,
  options,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number; options: EnumOption[]; mixed?: boolean; onChange: (v: number) => void }) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState('');
  const cur = options.find((o) => o.value === value);
  const label = mixed ? '' : cur ? prettyLabel(cur.label) : `(${value})`;
  const searchable = options.length > 8;
  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter((o) => prettyLabel(o.label).toLowerCase().includes(ql)) : options;
  const close = () => {
    pop.close();
    onEnd?.();
  };
  const toggle = () => {
    if (pop.isOpen) return close();
    setQ('');
    onBegin?.();
    pop.open(trigger.current);
  };
  return (
    <span className="field dropdown">
      <button ref={trigger} type="button" className="dd-trigger" onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>
        <span className={`dd-val${mixed ? ' mixed' : ''}`}>{mixed ? '—' : label}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 150)} onClose={close}>
          {searchable && (
            <div className="dd-search">
              <Search size={12} strokeWidth={2} />
              <input autoFocus placeholder="Search" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="dd-list">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`dd-opt${o.value === value && !mixed ? ' on' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <span className="dd-opt-label">{prettyLabel(o.label)}</span>
                {o.value === value && !mixed && <Check size={12} strokeWidth={2.4} />}
              </button>
            ))}
            {filtered.length === 0 && <div className="dd-empty">No match</div>}
          </div>
        </Popover>
      )}
    </span>
  );
}

// An int bitmask, edited as a multi-select of its bits (e.g. Camera clear flags).
// The popover stays open across toggles; the whole burst is one undo step (the
// field's gesture coalesces). The summary reads "Color | Depth" or "None".
function FlagsControl({
  value,
  options,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number; options: EnumOption[]; mixed?: boolean; onChange: (v: number) => void }) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const bits = options.filter((o) => o.value !== 0);
  const all = bits.reduce((m, o) => m | o.value, 0);
  const active = bits.filter((o) => (value & o.value) === o.value);
  const summary = mixed
    ? '—'
    : active.length === 0
      ? 'None'
      : active.length === bits.length && bits.length >= 4
        ? 'Everything'
        : active.map((o) => prettyLabel(o.label)).join(' | ');
  const close = () => {
    pop.close();
    onEnd?.();
  };
  const toggle = () => {
    if (pop.isOpen) return close();
    onBegin?.();
    pop.open(trigger.current);
  };
  return (
    <span className="field dropdown">
      <button ref={trigger} type="button" className="dd-trigger" onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>
        <span className={`dd-val${mixed ? ' mixed' : ''}`}>{summary}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 160)} onClose={close}>
          {bits.length >= 6 && (
            <div className="dd-allnone">
              <button type="button" onClick={() => onChange(all)}>
                Everything
              </button>
              <button type="button" onClick={() => onChange(0)}>
                Nothing
              </button>
            </div>
          )}
          <div className="dd-list">
            {bits.map((o) => {
              const on = !mixed && (value & o.value) === o.value;
              return (
                <button key={o.value} type="button" className="dd-opt" onClick={() => onChange(value ^ o.value)}>
                  <span className={`fchk${on ? ' on' : ''}`}>{on && <Check size={10} strokeWidth={3.2} />}</span>
                  <span className="dd-opt-label">{prettyLabel(o.label)}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </span>
  );
}

// A bounded number: a draggable track (the .slider widget) paired with a compact
// exact-entry box. Both snap to `step` and clamp to [min,max].
function SliderControl({
  value,
  min,
  max,
  step,
  unit,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0;
  const setFromX = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
    let v = min + t * span;
    if (step) v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, Math.round(v * 1000) / 1000)));
  };
  return (
    <>
      <div
        ref={track}
        className="slider"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onBegin?.();
          setFromX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) setFromX(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          onEnd?.();
        }}
      >
        <span className="fill" style={{ width: `${pct * 100}%` }} />
        <span className="thumb" style={{ left: `${pct * 100}%` }} />
      </div>
      <span className="snum">
        <NumField value={value} suffix={unit} onBegin={onBegin} onEnd={onEnd} onCommit={onChange} />
      </span>
    </>
  );
}

function BoolControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: boolean; mixed?: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      className={`toggle${value ? ' on' : ''}${mixed ? ' mixed' : ''}`}
      role="switch"
      aria-checked={mixed ? 'mixed' : value}
      onClick={() => {
        onBegin?.();
        // From a mixed state, the first click commits everyone to enabled.
        onChange(mixed ? true : !value);
        onEnd?.();
      }}
    />
  );
}

function StringControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; mixed?: boolean; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <span className="field">
      <input
        value={editing ? text : mixed ? '' : value}
        placeholder={mixed ? '—' : undefined}
        spellCheck={false}
        onFocus={() => {
          setText(value);
          setEditing(true);
          onBegin?.();
        }}
        onBlur={() => {
          setEditing(false);
          onEnd?.();
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
    </span>
  );
}

// — Color math (0..1 channels) —
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const hch = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');
const rgbaToHex8 = (r: number, g: number, b: number, a: number) => `#${hch(r)}${hch(g)}${hch(b)}${hch(a)}`;
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

// A themed HSV + alpha color picker. The field value is `#rrggbbaa`, so alpha is
// editable (the native <input type=color> can't). Local HSV state preserves hue
// while dragging at zero saturation/value; the whole picker session is one undo
// step (begin on open, end on close). The hex box accepts 6- or 8-digit input.
function ColorControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; onChange: (v: string) => void }) {
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
        <span className="sw-fill" style={{ background: rgbCss(r, g, b), opacity: a }} />
      </button>
      <span className="field">
        <input value={editing ? text : value} spellCheck={false} onFocus={focusHex} onBlur={blurHex} onChange={(e) => typeHex(e.target.value)} />
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

const rgbaCss = (c: { r: number; g: number; b: number; a: number }) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

// Interpolate a gradient's color at t (matches the runtime bake), for new stops.
function sampleStops(stops: GradientStop[], t: number): GradientStop['color'] {
  if (stops.length === 0) return { r: 1, g: 1, b: 1, a: 1 };
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return { ...sorted[0].color };
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return { ...last.color };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t - a.t > 1e-6 ? (t - a.t) / (b.t - a.t) : 0;
      return {
        r: a.color.r + (b.color.r - a.color.r) * f,
        g: a.color.g + (b.color.g - a.color.g) * f,
        b: a.color.b + (b.color.b - a.color.b) * f,
        a: a.color.a + (b.color.a - a.color.a) * f,
      };
    }
  }
  return { ...last.color };
}

// A color-over-life gradient editor: a preview bar with draggable stops; click the
// bar to add a stop, select one to edit its color (the themed picker) or delete it.
// Empty ⇒ the particle falls back to start/end + easing (the runtime bake skips it).
function GradientControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: GradientValue; onChange: (v: GradientValue) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [sel, setSel] = useState(0);
  const stops = value.stops ?? [];
  const ordered = [...stops].sort((a, b) => a.t - b.t);
  const css = stops.length
    ? `linear-gradient(90deg, ${ordered.map((s) => `${rgbaCss(s.color)} ${Math.round(s.t * 100)}%`).join(', ')})`
    : 'var(--inset)';

  const commit = (next: GradientStop[]) => onChange({ stops: next });
  const tFromX = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r && r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
  };
  const selColor = stops[sel]?.color;

  return (
    <div className="grad">
      <div
        ref={bar}
        className="grad-bar"
        onPointerDown={(e) => {
          if (e.target !== bar.current && !(e.target as HTMLElement).classList.contains('grad-fill')) return;
          const t = tFromX(e.clientX);
          onBegin?.();
          const next = [...stops, { t, color: sampleStops(stops, t) }];
          commit(next);
          setSel(next.length - 1);
          onEnd?.();
        }}
      >
        <span className="grad-fill" style={{ background: css }} />
        {stops.map((s, i) => (
          <span
            key={i}
            className={`grad-stop${i === sel ? ' on' : ''}`}
            style={{ left: `${s.t * 100}%`, background: rgbaCss(s.color) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(i);
              drag.current = i;
              onBegin?.();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current !== i) return;
              commit(stops.map((st, j) => (j === i ? { ...st, t: tFromX(e.clientX) } : st)));
            }}
            onPointerUp={(e) => {
              if (drag.current !== i) return;
              drag.current = null;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              onEnd?.();
            }}
          />
        ))}
      </div>
      {selColor && (
        <div className="grad-edit">
          <ColorControl
            value={rgbaToHex8(selColor.r, selColor.g, selColor.b, selColor.a)}
            onBegin={onBegin}
            onEnd={onEnd}
            onChange={(hex) => {
              const c = hexToRgba(hex);
              commit(stops.map((st, j) => (j === sel ? { ...st, color: c } : st)));
            }}
          />
          <button
            type="button"
            className="grad-del"
            title="Remove stop"
            onClick={() => {
              onBegin?.();
              commit(stops.filter((_, j) => j !== sel));
              setSel(0);
              onEnd?.();
            }}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

// A scalar over-life curve editor (size-over-life = a multiplier × start size):
// draggable keys on a [0,1]×[0,1] graph, click to add, select to delete. Piecewise
// linear (matches the runtime bake). Empty ⇒ the particle falls back to start/end.
function CurveControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: CurveValue; onChange: (v: CurveValue) => void }) {
  const graph = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [sel, setSel] = useState(0);
  const keys = value.keys ?? [];
  const ordered = [...keys].sort((a, b) => a.t - b.t);
  const line = ordered.map((k) => `${k.t * 100},${(1 - Math.max(0, Math.min(1, k.v))) * 100}`).join(' ');
  const posFromEvent = (e: React.PointerEvent) => {
    const r = graph.current?.getBoundingClientRect();
    if (!r) return { t: 0, v: 0 };
    return { t: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) };
  };
  const commit = (next: CurveKey[]) => onChange({ keys: next });

  return (
    <div className="curve">
      <div
        ref={graph}
        className="curve-graph"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).classList.contains('curve-pt')) return;
          const p = posFromEvent(e);
          onBegin?.();
          const next = [...keys, { t: p.t, v: p.v }];
          commit(next);
          setSel(next.length - 1);
          onEnd?.();
        }}
      >
        <svg className="curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {keys.length > 0 && <polyline className="curve-line" points={line} vectorEffect="non-scaling-stroke" />}
        </svg>
        {keys.map((k, i) => (
          <span
            key={i}
            className={`curve-pt${i === sel ? ' on' : ''}`}
            style={{ left: `${k.t * 100}%`, top: `${(1 - Math.max(0, Math.min(1, k.v))) * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(i);
              drag.current = i;
              onBegin?.();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current !== i) return;
              const p = posFromEvent(e);
              commit(keys.map((kk, j) => (j === i ? { t: p.t, v: p.v } : kk)));
            }}
            onPointerUp={(e) => {
              if (drag.current !== i) return;
              drag.current = null;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              onEnd?.();
            }}
          />
        ))}
      </div>
      {keys[sel] && (
        <div className="curve-edit">
          <span className="curve-kv">t {fmt(keys[sel].t)}</span>
          <span className="curve-kv">× {fmt(keys[sel].v)}</span>
          <button
            type="button"
            className="grad-del"
            title="Remove key"
            onClick={() => {
              onBegin?.();
              commit(keys.filter((_, j) => j !== sel));
              setSel(0);
              onEnd?.();
            }}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

const isImageAsset = (t: AssetType): boolean => t === 'texture' || t === 'sprite';

// An asset-ref field: a drop target showing the bound asset, PLUS a pick popover
// (search + thumbnail grid of the project's matching assets) on the lens button —
// so a ref can be set without dragging from the Content Browser. Clear with ×.
function AssetControl({
  value,
  assetType,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & {
  value: string | number;
  assetType?: string;
  onChange: (v: string | number) => void;
}) {
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = usePopover();
  const [q, setQ] = useState('');
  const info = ProjectStore.assetInfo(value);

  const setRefFromPath = (path: string) => {
    onBegin?.();
    void ProjectStore.assetRefForPath(path, assetType).then((ref) => {
      if (ref) onChange(ref);
      onEnd?.();
    });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const path = e.dataTransfer.getData('application/x-estella-asset') || e.dataTransfer.getData('text/plain');
    if (path) setRefFromPath(path);
  };

  const openPick = () => {
    setQ('');
    onBegin?.();
    pop.open(box.current);
  };
  const close = () => {
    pop.close();
    onEnd?.();
  };
  const pick = (ref: string | number) => {
    onChange(ref);
    close();
  };
  const ql = q.trim().toLowerCase();
  const assets = pop.isOpen
    ? ProjectStore.listAssets(assetType).filter((a) => !ql || a.name.toLowerCase().includes(ql))
    : [];

  return (
    <div
      ref={box}
      className={`assetref${over ? ' is-over' : ''}`}
      title={info?.path}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span className="th">
        {assetType === 'texture' && info ? (
          <img src={`estella://project/${info.path}`} alt="" draggable={false} />
        ) : (
          <Box size={11} strokeWidth={1.7} />
        )}
      </span>
      <span className="an">{info ? info.name : 'None'}</span>
      <button type="button" className="pk" title="Pick asset" onMouseDown={(e) => e.stopPropagation()} onClick={openPick}>
        <Search size={11} strokeWidth={2} />
      </button>
      {info && (
        <button
          type="button"
          className="pk"
          title="Clear"
          onClick={() => {
            onBegin?.();
            onChange(0);
            onEnd?.();
          }}
        >
          <X size={11} strokeWidth={2} />
        </button>
      )}
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 240)} onClose={close}>
          <div className="dd-search">
            <Search size={12} strokeWidth={2} />
            <input autoFocus placeholder="Search assets" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="asset-grid">
            <button type="button" className={`asset-opt${value === 0 || !info ? ' on' : ''}`} onClick={() => pick(0)}>
              <span className="th">
                <X size={13} strokeWidth={2} />
              </span>
              <span className="an">None</span>
            </button>
            {assets.map((a) => (
              <button key={a.ref} type="button" className={`asset-opt${a.ref === value ? ' on' : ''}`} title={a.path} onClick={() => pick(a.ref)}>
                <span className="th">
                  {isImageAsset(a.type) ? (
                    <img src={`estella://project/${a.path}`} alt="" draggable={false} />
                  ) : (
                    <AssetIcon type={a.type} size={18} />
                  )}
                </span>
                <span className="an">{a.name}</span>
              </button>
            ))}
            {assets.length === 0 && <div className="dd-empty">No matching assets</div>}
          </div>
        </Popover>
      )}
    </div>
  );
}

// A field write override (the live "Game" inspector routes edits to the realm
// instead of the undoable SceneCommands path). When set, gestures are no-ops.
type FieldWrite = (key: string, type: InspectorField['type'], value: number | boolean | string | number[] | GradientValue | CurveValue) => void;

function FieldRow({ entities, comp, field, write }: { entities: EntityId[]; comp: string; field: InspectorField; write?: FieldWrite }) {
  const ranged = field.min != null || field.max != null;
  const mixed = field.mixed === true;
  const clamp = (n: number) => {
    let v = n;
    if (field.min != null) v = Math.max(field.min, v);
    if (field.max != null) v = Math.min(field.max, v);
    return v;
  };
  // An edit fans out to every selected entity (the open gesture coalesces them
  // into one undo step); the live "Game" inspector routes to the realm instead.
  const apply = (value: number | boolean | string | number[] | GradientValue | CurveValue) => {
    const v = ranged && typeof value === 'number' ? clamp(value) : value;
    if (write) return write(field.key, field.type, v);
    for (const e of entities) SceneCommands.setField(e, comp, field.key, field.type, v as never);
  };
  const begin = () => (write ? undefined : SceneCommands.beginGesture(`Edit ${field.label}`));
  const end = () => (write ? undefined : SceneCommands.endGesture());

  // Plain numbers + angles scrub from the label; vectors from their axis tabs; a
  // slider owns its own drag so its label stays inert.
  const isScalar = (field.type === 'number' && !field.slider) || field.type === 'angle';
  const labelScrub = useScrub(isScalar ? (field.value as number) : 0, apply, {
    onBegin: begin,
    onEnd: end,
    step: field.step,
    min: field.min,
    max: field.max,
  });

  let control;
  switch (field.type) {
    case 'number':
      control =
        field.slider && field.min != null && field.max != null ? (
          <SliderControl
            value={field.value as number}
            min={field.min}
            max={field.max}
            step={field.step}
            unit={field.unit}
            onBegin={begin}
            onEnd={end}
            onChange={apply}
          />
        ) : (
          <NumField value={field.value as number} suffix={field.unit} mixed={mixed} onBegin={begin} onEnd={end} onCommit={apply} />
        );
      break;
    case 'angle':
      control = <NumField value={field.value as number} suffix="°" mixed={mixed} onBegin={begin} onEnd={end} onCommit={apply} />;
      break;
    case 'vec2':
    case 'vec3':
      control = <VecControl value={field.value as number[]} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'bool':
      control = <BoolControl value={field.value as boolean} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'enum':
      control = (
        <EnumControl
          value={field.value as number}
          options={field.options ?? []}
          mixed={mixed}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    case 'flags':
      control = (
        <FlagsControl
          value={field.value as number}
          options={field.options ?? []}
          mixed={mixed}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    case 'color':
      control = <ColorControl value={field.value as string} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'gradient':
      control = <GradientControl value={field.value as GradientValue} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'curve':
      control = <CurveControl value={field.value as CurveValue} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'asset':
      control = (
        <AssetControl
          value={field.value as string | number}
          assetType={field.assetType}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    default:
      control = <StringControl value={String(field.value)} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
  }

  const modified = !mixed && isModified(field);
  const reset = () => {
    if (field.defaultValue === undefined) return;
    begin();
    apply(field.defaultValue);
    end();
  };

  return (
    <div className={`prop${modified ? ' modified' : ''}${mixed ? ' mixed' : ''}`}>
      <span className={`prop-label${isScalar ? ' scrub' : ''}`} {...(isScalar ? labelScrub : {})}>
        {field.label}
      </span>
      <div className="prop-value">{control}</div>
      <button
        type="button"
        className={`prop-reset${modified ? ' show' : ''}`}
        tabIndex={-1}
        title="Reset to default"
        onClick={modified ? reset : undefined}
      >
        <RotateCcw size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

// A collapsible sub-section inside a component (a property category, or Advanced).
// Children stay mounted so the grid-rows height transition animates both ways.
function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className={`subfold${open ? ' open' : ''}`} onClick={onToggle}>
        <ChevronRight size={9} strokeWidth={3} />
        {label}
      </div>
      <div className="subbody">
        <div>{children}</div>
      </div>
    </>
  );
}

const ADVANCED_FOLD = '__advanced__';

function ComponentSection({
  entities,
  comp,
  collapsed,
  onToggle,
  onMore,
  write,
}: {
  entities: EntityId[];
  comp: InspectorComponent;
  collapsed: boolean;
  onToggle: () => void;
  onMore?: (e: React.MouseEvent, name: string) => void;
  write?: FieldWrite;
}) {
  const Icon = componentIcon(comp.name);
  const overridden = comp.fields.some(isModified);
  // Categories default open, the Advanced fold defaults closed.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const isOpen = (name: string) => openFolds[name] ?? name !== ADVANCED_FOLD;
  const toggleFold = (name: string) => setOpenFolds((s) => ({ ...s, [name]: !isOpen(name) }));

  // Bucket fields: a category wins (grouped under its header); else advanced (the
  // Advanced fold); else ungrouped at the top.
  const ungrouped: InspectorField[] = [];
  const advancedFields: InspectorField[] = [];
  const groups = new Map<string, InspectorField[]>();
  for (const f of comp.fields) {
    if (f.category) (groups.get(f.category) ?? groups.set(f.category, []).get(f.category)!).push(f);
    else if (f.advanced) advancedFields.push(f);
    else ungrouped.push(f);
  }
  const row = (f: InspectorField) => <FieldRow key={f.key} entities={entities} comp={comp.name} field={f} write={write} />;
  const enable = comp.enable;
  const on = !enable || enable.value;
  // The header checkbox toggles the component's enable field across the whole
  // selection (one undo step), or is a static "always on" for components that
  // can't be disabled (e.g. Transform). From a mixed state, the first click enables all.
  const toggleEnable = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!enable) return;
    const next = enable.mixed ? true : !enable.value;
    if (write) {
      write(enable.key, 'bool', next);
      return;
    }
    SceneCommands.beginGesture(`Toggle ${comp.label}`);
    for (const id of entities) SceneCommands.setField(id, comp.name, enable.key, 'bool', next);
    SceneCommands.endGesture();
  };
  return (
    <section className={`comp${collapsed ? '' : ' open'}${overridden ? ' override' : ''}${enable && !on ? ' disabled' : ''}`}>
      <header className="comp-head" onClick={onToggle}>
        <span className="comp-arrow">
          <ChevronRight size={9} strokeWidth={3} />
        </span>
        <span
          className={`comp-chk${on ? ' on' : ''}${enable?.mixed ? ' mixed' : ''}`}
          role={enable ? 'checkbox' : undefined}
          aria-checked={enable ? (enable.mixed ? 'mixed' : enable.value) : undefined}
          title={enable ? (enable.value ? 'Disable component' : 'Enable component') : undefined}
          onClick={enable ? toggleEnable : (e) => e.stopPropagation()}
        >
          {on && <Check size={9} strokeWidth={3.2} />}
        </span>
        <span className="comp-icon">
          <Icon size={13} strokeWidth={1.9} />
        </span>
        <span className="comp-name">{comp.label}</span>
        {onMore && (
          <button
            type="button"
            className="comp-menu"
            title="Component options"
            onClick={(e) => {
              e.stopPropagation();
              onMore(e, comp.name);
            }}
          >
            <MoreHorizontal size={13} strokeWidth={2} />
          </button>
        )}
      </header>
      <div className="comp-body">
        <div className="cinner">
          <div className="comp-fields">
            {ungrouped.map(row)}
            {[...groups].map(([cat, fields]) => (
              <Fold key={cat} label={cat} open={isOpen(cat)} onToggle={() => toggleFold(cat)}>
                {fields.map(row)}
              </Fold>
            ))}
            {advancedFields.length > 0 && (
              <Fold label="Advanced" open={isOpen(ADVANCED_FOLD)} onToggle={() => toggleFold(ADVANCED_FOLD)}>
                {advancedFields.map(row)}
              </Fold>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// The live "Game" inspector (UE5 PIE Details): reads the running realm snapshot +
// routes edits to the realm (live, reverts on Stop). Structure is read-only here
// (no add/remove/rename of the running game) — just live value debugging.
function GameDetails() {
  const { selectedEntity, selection } = useSyncExternalStore(PlayInspect.subscribe, PlayInspect.getSnapshot);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  // The shallow tree snapshot strips component data; Details reads the selected
  // entity's FULL data, fetched alongside the tree. Wrap it as a one-entity
  // SceneData so the shared view-model builders apply unchanged.
  const selData = selectedEntity ? ({ entities: [selectedEntity] } as SceneData) : null;
  const info = selection != null ? buildEntityInfo(selData, selection) : null;
  const inspector = selection != null ? buildInspector(selData, selection) : [];
  const compData = (name: string): Record<string, unknown> =>
    (selectedEntity?.components.find((c) => c.type === name)?.data as Record<string, unknown>) ?? {};

  return (
    <div className="insp">
      <div className="game-live">● Playing — live values (revert on Stop)</div>
      {selection == null || !info ? (
        <div className="empty">
          <p>Select a running entity in the Outliner to inspect + tweak it live.</p>
        </div>
      ) : (
        <>
          <div className="ent-head">
            <span className="ent-name">{info.name}</span>
            <span className="ent-meta">
              <span className="pill">{info.kind}</span>
              <span className="pill">#{selection}</span>
            </span>
          </div>
          <div className="insp-body">
            {inspector.map((comp) => (
              <ComponentSection
                key={comp.name}
                entities={[selection]}
                comp={comp}
                collapsed={collapsed.has(comp.name)}
                onToggle={() => toggle(comp.name)}
                write={(key, type, value) =>
                  PlayInspect.setField(selection, comp.name, key, toModelValue(compData(comp.name), type, key, value as never))
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Asset view of the unified inspector — shown when an asset (not an entity) is
// selected (in the content browser). Only fields the fs layer provides; the
// preview is the image itself or the type glyph.
function AssetInspector({ path }: { path: string }) {
  const name = baseName(path);
  const type = assetTypeOf(name);
  const isImage = IMAGE_RE.test(name);
  return (
    <div className="insp">
      <div className="cb-detail-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div className="cb-prev">
          <div className="pv">
            {isImage ? (
              <img src={`estella://project/${path}`} alt="" draggable={false} />
            ) : (
              <AssetIcon type={type} size={48} />
            )}
          </div>
        </div>
        <div className="cb-dt">
          <div className="an">
            {name}
            {TYPE_CODE[type] && (
              <span className="tg" style={{ background: assetTint(type) }}>
                {TYPE_CODE[type]}
              </span>
            )}
          </div>
          <div className="ap">{path}</div>
          <div className="cb-meta">
            <div className="cb-mr">
              <span className="k">Type</span>
              <span className="v">{type}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="cb-act">
        {type === 'scene' && (
          <button type="button" className="primary" onClick={() => void ProjectStore.openScene(path)}>
            <FolderOpen size={13} strokeWidth={1.85} /> Open Scene
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(path);
            Toasts.push('Copied path', 'info', 1600);
          }}
        >
          <Copy size={13} strokeWidth={1.85} /> Copy Path
        </button>
      </div>
    </div>
  );
}

// A selected outliner folder (folders aren't entities — no components): just its
// name, path, and how many entities it organizes (recursive).
function FolderInspector({ path }: { path: string }) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getStructureRevision);
  const entities = SceneModel.current?.entities ?? [];
  const count = entities.reduce((n, e) => (isFolderUnder(SceneModel.folderOf(e.id), path) ? n + 1 : n), 0);
  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{folderName(path)}</div>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">Folder</span>
            {path}
          </span>
          <span className="pill">
            <span className="pk">Items</span>
            {count}
          </span>
        </div>
      </div>
      <div className="insp-empty" style={{ flex: 1 }}>
        <div className="ei">
          <FolderOpen size={22} strokeWidth={1.4} />
        </div>
        <div className="et">{count === 1 ? '1 entity' : `${count} entities`} in this folder</div>
        <div className="es">Folders organize the outliner; they aren't part of the scene.</div>
      </div>
    </div>
  );
}

// Dispatcher: the live game inspector during PIE, the edit inspector otherwise.
export function Details() {
  const inspectWorld = useEditorStore((s) => s.inspectWorld);
  return inspectWorld === 'game' ? <GameDetails /> : <EditorDetails />;
}

function EditorDetails() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const revision = useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  // Re-render when a project component's schema changes (live edit of its source).
  useSyncExternalStore(subscribeSchemas, getSchemaRevision);
  const selectedId = useSelection((s) => s.selectedId);
  const selectedIds = useSelection((s) => s.selectedIds);
  const selectedAsset = useSelection((s) => s.selectedAsset);
  const selectedFolder = useOutliner((s) => s.selectedFolder);
  const ready = engine.status === 'ready' && selectedId != null;

  // Selection targets, primary (the active id) first. Edits fan out across all.
  const ids = useMemo(
    () => (selectedId == null ? [] : [selectedId, ...[...selectedIds].filter((i) => i !== selectedId)]),
    [selectedId, selectedIds],
  );
  const multi = ids.length > 1;

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [compMenu, setCompMenu] = useState<{ x: number; y: number; comp: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filtOn, setFiltOn] = useState(false);
  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const entity = useMemo(
    () => (ready ? SceneQuery.readEntity(selectedId!) : null),
    [ready, selectedId, revision],
  );
  const components = useMemo(
    () => (ready ? SceneQuery.readMultiInspector(ids) : []),
    [ready, ids, revision],
  );

  // Inspector search: keep components whose name matches (all fields), or that
  // have any matching field (only the matches) — the Details filter behaviour.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return components;
    const out: InspectorComponent[] = [];
    for (const c of components) {
      if (c.label.toLowerCase().includes(q)) {
        out.push(c);
        continue;
      }
      const fields = c.fields.filter((f) => f.label.toLowerCase().includes(q));
      if (fields.length) out.push({ ...c, fields });
    }
    return out;
  }, [components, query]);

  // Unified inspector: an asset selection (mutually exclusive with entities)
  // renders the asset view in this same panel.
  if (selectedAsset) {
    return <AssetInspector path={selectedAsset} />;
  }
  // A selected outliner folder (no entity/asset selected) shows the folder view.
  if (selectedFolder != null && selectedId == null) {
    return <FolderInspector path={selectedFolder} />;
  }

  if (!entity || selectedId == null) {
    return (
      <div className="insp">
        <div className="insp-empty">
          <div className="ei">
            <Box size={22} strokeWidth={1.4} />
          </div>
          <div className="et">No selection</div>
          <div className="es">Select an entity in the scene, or an asset in the Content Browser.</div>
        </div>
      </div>
    );
  }

  const modelEntity = SceneModel.entityBySource(selectedId);

  // Prefab-instance identity (real tag data): the `prefab` ref lives on the
  // instance root, so non-root members resolve it by walking up to their root.
  const prefabTag = SceneModel.prefabTag(selectedId);
  const prefabRef = prefabTag
    ? prefabTag.prefab ?? SceneModel.prefabTag(prefabTag.instanceRoot)?.prefab
    : undefined;
  const prefabName = prefabRef ? ProjectStore.assetInfo(prefabRef)?.name ?? null : null;

  return (
    <div className="insp">
      <div className="insp-head">
        <div className="search">
          <Search size={13} strokeWidth={1.9} />
          <input
            placeholder="Search"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`filt-btn${filtOn ? ' on' : ''}`}
          title="Filter properties"
          onClick={() => setFiltOn((v) => !v)}
        >
          <Filter size={14} strokeWidth={1.9} />
        </button>
      </div>

      <div className="ent-head">
        <div className="ent-row1">
          {multi ? (
            <div className="ent-name ent-multi">{ids.length} entities selected</div>
          ) : (
            <input
              key={selectedId}
              className="ent-name"
              defaultValue={entity.name}
              spellCheck={false}
              onBlur={(e) => SceneCommands.renameEntity(selectedId, e.target.value)}
            />
          )}
        </div>
        <div className="ent-meta">
          {multi ? (
            <span className="pill">
              <span className="pk">Editing</span>
              {ids.length} entities · shared components
            </span>
          ) : (
            <>
              <span className="pill">
                <span className="pk">Type</span>
                {KIND_LABEL[entity.kind]}
              </span>
              <span className="pill">
                <span className="pk">ID</span>
                {selectedId}
              </span>
            </>
          )}
        </div>
        {prefabName && !multi && (
          <div className="prefab-bar" title={prefabRef}>
            <span className="pic">
              <Package size={13} strokeWidth={1.8} />
            </span>
            <span className="pn">{prefabName}</span>
          </div>
        )}
      </div>

      <div className="insp-addrow">
        <button type="button" className="insp-add" title="Add Component" onClick={() => setAddOpen(true)}>
          <Plus size={13} strokeWidth={2.4} />
          Add Component
        </button>
      </div>

      <div className="insp-body">
        {visible.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={ids}
            comp={comp}
            collapsed={collapsed.has(comp.name)}
            onToggle={() => toggle(comp.name)}
            onMore={(e, name) => setCompMenu({ x: e.clientX, y: e.clientY, comp: name })}
          />
        ))}
        {query && visible.length === 0 && (
          <div className="filter-empty">No components match “{query}”.</div>
        )}
      </div>

      {compMenu && (
        <ContextMenu
          x={compMenu.x}
          y={compMenu.y}
          items={[
            {
              label: ids.length > 1 ? `Remove Component (${ids.length})` : 'Remove Component',
              danger: true,
              icon: <Trash2 size={13} strokeWidth={1.9} />,
              onClick: () => SceneCommands.removeComponentMany(ids, compMenu.comp),
            },
          ]}
          onClose={() => setCompMenu(null)}
        />
      )}
      {addOpen && modelEntity && (
        <AddComponentMenu
          entries={modelAddableComponentEntries(modelEntity)}
          onAdd={(name) => SceneCommands.addComponentMany(ids, name)}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
