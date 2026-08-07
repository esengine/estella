// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  controls.tsx
 * @brief One control per field TYPE — vec2, enum, asset ref, gradient — and none
 *        per component: adding a component adds no code here.
 *
 * A control never reaches for SceneCommands. Writes arrive as callbacks the
 * caller built (`fieldWriter` in Details.tsx), so one control serves both the
 * undoable edit path and the live Game inspector that routes to the realm.
 */

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { AssetIcon } from '@/components/icons';
import { ColorControl, rgbaToHex8 } from '@/components/ColorControl';
import { NumField, useScrub, fmt, type ControlGesture } from '@/components/NumField';
import { Popover, usePopover } from '@/components/Popover';
import { SearchField } from '@/components/SearchField';
import { Select } from '@/components/Select';
import { useListbox } from '@/components/useListbox';
import { SceneModel } from '@/engine/SceneModel';
import { SceneStore } from '@/engine/SceneStore';
import { prettyLabel, hexToRgba, coerceEnumInput } from '@/engine/schema';
import { AssetRegistry } from '@/project/AssetRegistry';
import { revealAsset } from '@/project/assetReveal';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';
import { DimensionUnit, INVALID_ENTITY } from 'esengine';
import type {
  EnumOption, AssetType, GradientValue, GradientStop,
  CurveValue, CurveKey, DimensionValue, MapValue,
} from '@/types';

const AXES = ['x', 'y', 'z', 'w'];

// The gesture contract, scrub hook, and NumField are the shared numeric-input
// primitives (components/NumField.tsx); the inspector composes them below.

// One vector component — the colored X/Y/Z tab IS the scrub handle.
function VecField({
  axis,
  value,
  mixed,
  onBegin,
  onEnd,
  onCancel,
  onCommit,
}: ControlGesture & { axis: string; value: number; mixed?: boolean; onCommit: (n: number) => void }) {
  const scrub = useScrub(value, onCommit, { onBegin, onEnd });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const startValue = useRef(value);
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
          startValue.current = value;
          setText(fmt(value));
          setEditing(true);
          onBegin?.();
        }}
        onBlur={() => {
          setEditing(false);
          onEnd?.();
        }}
        onKeyDown={(e) => {
          // Arrow = ±step (Shift ÷10, Alt ×10); Enter commits; Escape reverts.
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
            const cur = Number.isFinite(parseFloat(text)) ? parseFloat(text) : value;
            const next = Math.round((cur + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000;
            setText(fmt(next));
            onCommit(next);
          } else if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            // Cancel via the gesture layer so each entity in a mixed selection
            // reverts to its OWN value, not the primary's (see NumField).
            if (onCancel) onCancel();
            else onCommit(startValue.current);
            setText(fmt(startValue.current));
            e.currentTarget.blur();
          }
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

export function VecControl({
  value,
  mixed,
  mixedAxes,
  onBegin,
  onEnd,
  onCancel,
  onChange,
}: ControlGesture & { value: number[]; mixed?: boolean; mixedAxes?: boolean[]; onChange: (v: number[]) => void }) {
  return (
    <div className="vec">
      {value.map((n, i) => (
        <VecField
          key={i}
          axis={AXES[i]}
          value={n}
          // Per-axis mixed when the merge computed it (only the disagreeing axes
          // read `—`); else fall back to the whole-field flag.
          mixed={mixedAxes ? mixedAxes[i] : mixed}
          onBegin={onBegin}
          onEnd={onEnd}
          onCancel={onCancel}
          onCommit={(v) => {
            // Write ONLY the edited axis — NaN on the others tells the model write
            // to keep each (possibly multi-selected) entity's own value there,
            // instead of stamping the primary's whole vector onto the selection.
            const next = value.map(() => NaN);
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

// A four-edge box ({ left, top, right, bottom }) as four labelled wells — the padding
// analog of VecControl. Edges are L·T·R·B; each edit writes ONLY its edge (NaN on the
// others) so a single-edge change fanned across a multi-selection keeps the untouched
// edges of the non-primary entities (see toModelValue 'sides').
const SIDE_EDGES = ['l', 't', 'r', 'b'] as const;
export function SidesControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onCancel,
  onChange,
}: ControlGesture & { value: number[]; mixed?: boolean; onChange: (v: number[]) => void }) {
  return (
    <div className="vec sides">
      {SIDE_EDGES.map((edge, i) => (
        <VecField
          key={edge}
          axis={edge}
          value={value[i] ?? 0}
          mixed={mixed}
          onBegin={onBegin}
          onEnd={onEnd}
          onCancel={onCancel}
          onCommit={(v) => {
            const next = [NaN, NaN, NaN, NaN];
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

// A dropdown over an option set — a themed popover, not a native <select>, so the
// list matches the editor and searches when long. The stored value is the option's
// OWN value, which is an int for a C++ enum and a name for a choice read off an
// asset (an animation, an armature — see EnumOption).
//
// Only ordinal labels are prettified: "SpaceBetween" reads better as "Space
// Between", but a name IS the stored string and must be shown as written, or the
// list would offer "Stand" for a value spelled "stand". A value with no matching
// option still shows as itself (an animation the skeleton no longer declares is a
// thing to SEE, not a blank), and an empty one reads as "None".
export function EnumControl({
  value,
  options,
  open,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & {
  value: string | number;
  options: EnumOption[];
  /** Options are suggestions; typed values outside them are legal. See InspectorField.open. */
  open?: boolean;
  mixed?: boolean;
  onChange: (v: string | number) => void;
}) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  // What an open control is currently being typed into; null = showing its value.
  const [draft, setDraft] = useState<string | null>(null);
  const optLabel = (o: EnumOption): string => (typeof o.value === 'number' ? prettyLabel(o.label) : o.label);
  const cur = options.find((o) => o.value === value);
  const label = mixed ? '' : cur ? optLabel(cur) : String(value) || t('det.noneOption');
  // The open control's own input IS the filter, so it never grows a second one.
  const searchable = !open && options.length > 8;
  const ql = (open ? (draft ?? '') : q).trim().toLowerCase();
  const filtered = ql ? options.filter((o) => optLabel(o).toLowerCase().includes(ql)) : options;
  // What the draft would write, by the field's own rule (an option, its label, or
  // — open only — the text on its own terms).
  const drafted = open && draft !== null ? coerceEnumInput(draft, options, true) : null;
  // Show it as its own row only when it is NOT one of the options: those are in
  // the list already, and a duplicate row reads as a different choice.
  const typedValue = drafted !== null && !options.some((o) => o.value === drafted) ? drafted : null;
  const { triggerProps, listProps } = useListbox(pop.isOpen, { seedFocus: !searchable && !open });
  const close = () => {
    pop.close();
    setDraft(null);
    (open ? input : trigger).current?.focus();
    onEnd?.();
  };
  const commit = (v: string | number) => {
    onChange(v);
    close();
  };
  const toggle = () => {
    if (pop.isOpen) return close();
    setQ('');
    onBegin?.();
    pop.open((open ? input : trigger).current);
  };
  // Enter takes the typed value (or the sole remaining suggestion); Escape drops
  // the draft without writing. Blur commits, so a click elsewhere isn't a silent loss.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (drafted !== null) commit(drafted);
      else if (filtered.length === 1) commit(filtered[0].value);
      else close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  return (
    <span className="field dropdown">
      {open ? (
        <span className="dd-trigger dd-trigger--open">
          <input
            ref={input}
            className={`dd-input${mixed ? ' mixed' : ''}`}
            value={draft ?? (mixed ? '' : label)}
            placeholder={mixed ? '—' : undefined}
            spellCheck={false}
            onMouseDown={(e) => e.stopPropagation()}
            onFocus={() => {
              if (!pop.isOpen) {
                onBegin?.();
                pop.open(input.current);
              }
            }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => {
              // Clicking away commits what was typed rather than losing it; a draft
              // the field cannot hold is simply dropped back to the stored value.
              if (drafted !== null) onChange(drafted);
              setDraft(null);
            }}
          />
          <ChevronDown size={12} strokeWidth={2} onMouseDown={(e: React.MouseEvent) => e.preventDefault()} onClick={toggle} />
        </span>
      ) : (
        <button ref={trigger} type="button" className="dd-trigger" {...triggerProps} onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>
          <span className={`dd-val${mixed ? ' mixed' : ''}`}>{mixed ? '—' : label}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      )}
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 150)} onClose={close}>
          {searchable && (
            <SearchField flush className="dd-search" iconSize={12} autoFocus placeholder={t('ui.search')} value={q} onChange={setQ} />
          )}
          <div className="dd-list" {...listProps}>
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value && !mixed}
                className={`dd-opt${o.value === value && !mixed ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(o.value)}
              >
                <span className="dd-opt-label">{optLabel(o)}</span>
                {o.value === value && !mixed && <Check size={12} strokeWidth={2.4} />}
              </button>
            ))}
            {typedValue !== null && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="dd-opt dd-opt--literal"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(typedValue)}
              >
                <span className="dd-opt-label">{t('det.useLiteral', { value: String(typedValue) })}</span>
              </button>
            )}
            {filtered.length === 0 && typedValue === null && (
              <div className="empty-line empty-line--sm">{t('det.noMatch')}</div>
            )}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** True when an entity-ref source id means "unset" (nothing bound). Both engine
 *  invalid sentinels count; INVALID_ENTITY is 0, which is also why source id 0 is
 *  never offered as a target (a ref to it is indistinguishable from "unset"). */
const isUnsetEntity = (v: number): boolean => v === INVALID_ENTITY || v === 0xffffffff;

// A reference to ANOTHER scene entity (e.g. a joint's connectedBody): a picker of
// the scene's entities by name, storing the target's SOURCE id. Was a raw number
// input before. "None" writes the unset sentinel; the current target shows by name.
export function EntityControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number; mixed?: boolean; onChange: (v: number) => void }) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState('');
  // Track scene-model changes so the trigger label reflects a bound target's
  // CURRENT name (rename elsewhere) — not just a stale snapshot from the last open.
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  // The scene's entities (source id + name) — rebuilt each open so it's current.
  // Source id 0 (== INVALID_ENTITY) is excluded: a ref to it can't be told apart
  // from "unset", so it isn't a bindable target.
  const options = useMemo(
    () => (SceneModel.current?.entities ?? [])
      .filter((e) => e.id !== INVALID_ENTITY)
      .map((e) => ({ id: e.id, name: e.name || `#${e.id}` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pop.isOpen],
  );
  // Resolve the bound target against the LIVE model each render, so a rename shows
  // immediately and a ref to a since-deleted entity reads as missing (not a bare #id).
  const cur = (SceneModel.current?.entities ?? []).find((e) => e.id === value && !isUnsetEntity(e.id));
  const isDangling = !mixed && !isUnsetEntity(value) && !cur;
  const label = mixed
    ? '—'
    : isUnsetEntity(value)
      ? t('det.entityNone')
      : cur
        ? cur.name || `#${cur.id}`
        : t('det.entityMissing', { id: value });
  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter((o) => o.name.toLowerCase().includes(ql)) : options;
  const { triggerProps, listProps } = useListbox(pop.isOpen, { seedFocus: options.length <= 8 });
  const close = () => {
    pop.close();
    trigger.current?.focus();
    onEnd?.();
  };
  const toggle = () => {
    if (pop.isOpen) return close();
    setQ('');
    onBegin?.();
    pop.open(trigger.current);
  };
  const pick = (id: number) => {
    onChange(id);
    close();
  };
  return (
    <span className="field dropdown">
      <button ref={trigger} type="button" className="dd-trigger" {...triggerProps} onMouseDown={(e) => e.stopPropagation()} onClick={toggle}
        title={isDangling ? t('det.entityMissingTip') : undefined}>
        <span className={`dd-val${mixed || isUnsetEntity(value) || isDangling ? ' dd-none' : ''}`}>{mixed ? '—' : label}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 160)} onClose={close}>
          {options.length > 8 && (
            <SearchField flush className="dd-search" iconSize={12} autoFocus placeholder={t('ui.search')} value={q} onChange={setQ} />
          )}
          <div className="dd-list" {...listProps}>
            <button type="button" role="option" aria-selected={isUnsetEntity(value) && !mixed} className={`dd-opt${isUnsetEntity(value) && !mixed ? ' on' : ''}`} onClick={() => pick(INVALID_ENTITY)}>
              <span className="dd-opt-label dd-none">{t('det.entityNone')}</span>
              {isUnsetEntity(value) && !mixed && <Check size={12} strokeWidth={2.4} />}
            </button>
            {filtered.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={o.id === value && !mixed} className={`dd-opt${o.id === value && !mixed ? ' on' : ''}`} onClick={() => pick(o.id)}>
                <span className="dd-opt-label">{o.name}</span>
                {o.id === value && !mixed && <Check size={12} strokeWidth={2.4} />}
              </button>
            ))}
            {filtered.length === 0 && <div className="empty-line empty-line--sm">{t('det.noMatch')}</div>}
          </div>
        </Popover>
      )}
    </span>
  );
}

// An int bitmask, edited as a multi-select of its bits (e.g. Camera clear flags).
// The popover stays open across toggles; the whole burst is one undo step (the
// field's gesture coalesces). The summary reads "Color | Depth" or "None".
export function FlagsControl({
  value,
  options,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number; options: EnumOption[]; mixed?: boolean; onChange: (v: number) => void }) {
  const pop = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  // A flag IS a bit. These options come from a bitmask or a flag list, both of
  // which are numeric by construction — a named option could never be OR'd.
  const bits = options
    .map((o) => ({ ...o, value: Number(o.value) }))
    .filter((o) => o.value !== 0);
  const all = bits.reduce((m, o) => m | o.value, 0);
  const active = bits.filter((o) => (value & o.value) === o.value);
  const summary = mixed
    ? '—'
    : active.length === 0
      ? t('det.none')
      : active.length === bits.length && bits.length >= 4
        ? t('det.everything')
        : active.map((o) => prettyLabel(o.label)).join(' | ');
  const { triggerProps, listProps } = useListbox(pop.isOpen, { multi: true });
  const close = () => {
    pop.close();
    trigger.current?.focus();
    onEnd?.();
  };
  const toggle = () => {
    if (pop.isOpen) return close();
    onBegin?.();
    pop.open(trigger.current);
  };
  return (
    <span className="field dropdown">
      <button ref={trigger} type="button" className="dd-trigger" {...triggerProps} onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>
        <span className={`dd-val${mixed ? ' mixed' : ''}`}>{summary}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 160)} onClose={close}>
          {bits.length >= 6 && (
            <div className="dd-allnone">
              <button type="button" onClick={() => onChange(all)}>
                {t('det.everything')}
              </button>
              <button type="button" onClick={() => onChange(0)}>
                {t('det.nothing')}
              </button>
            </div>
          )}
          <div className="dd-list" {...listProps}>
            {bits.map((o) => {
              const on = !mixed && (value & o.value) === o.value;
              // From a MIXED selection the checkboxes all read empty, so a click sets
              // exactly that bit for everyone (unify → concrete, like BoolControl).
              // XORing the primary's mask instead would silently stamp its OTHER bits
              // onto the rest of the selection.
              return (
                <button key={o.value} type="button" role="option" aria-selected={on} className="dd-opt" onClick={() => onChange(mixed ? o.value : value ^ o.value)}>
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
export function SliderControl({
  value,
  min,
  max,
  step,
  unit,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  mixed?: boolean;
  onChange: (n: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const span = max - min;
  // A mixed multi-selection has no single value to point the fill/thumb at; show
  // an empty track (and `—` in the field) until a drag commits one value to all.
  const pct = mixed ? 0 : span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0;
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
        <NumField value={value} suffix={unit} mixed={mixed} step={step} min={min} max={max} onBegin={onBegin} onEnd={onEnd} onCommit={onChange} />
      </span>
    </>
  );
}

export function BoolControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: boolean; mixed?: boolean; onChange: (v: boolean) => void }) {
  const commit = () => {
    onBegin?.();
    // From a mixed state, the first toggle commits everyone to enabled.
    onChange(mixed ? true : !value);
    onEnd?.();
  };
  return (
    <span
      className={`toggle${value ? ' on' : ''}${mixed ? ' mixed' : ''}`}
      // `switch` has no tri-state — use `checkbox` when the multi-selection is
      // mixed so aria-checked="mixed" is valid (matches the component enable box).
      role={mixed ? 'checkbox' : 'switch'}
      aria-checked={mixed ? 'mixed' : value}
      tabIndex={0}
      onClick={commit}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

// A CSS-length: a number well that flex-fills beside a compact px/%/auto unit
// picker. The well is ALWAYS shown and editable — for `auto` it's blank with a
// ghost "auto" placeholder, and typing a value flips the unit to px (Yoga ignores
// an `auto` unit's number, so there's no value to type against otherwise). The
// picker must sit in its own `.field.dropdown` wrapper (like EnumControl) so it
// reads as a well and its width stays capped — a bare `variant="field"` Select is
// width:100% and would swallow the whole row, hiding the number field.
export function DimControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: DimensionValue; mixed?: boolean; onChange: (v: DimensionValue) => void }) {
  const isAuto = value.unit === DimensionUnit.Auto;
  const setUnit = (unit: number) => {
    onBegin?.();
    onChange({ value: value.value, unit });
    onEnd?.();
  };
  return (
    <div className="dim">
      <NumField
        value={value.value}
        mixed={mixed}
        empty={isAuto}
        placeholder={isAuto ? 'auto' : undefined}
        onBegin={onBegin}
        onEnd={onEnd}
        onCommit={(n) => onChange({ value: n, unit: isAuto ? DimensionUnit.Px : value.unit })}
      />
      <span className="field dropdown dim-unit">
        <Select
          variant="field"
          value={String(value.unit)}
          ariaLabel={t('det.unitAria')}
          options={[
            { value: String(DimensionUnit.Px), label: 'px' },
            { value: String(DimensionUnit.Percent), label: '%' },
            { value: String(DimensionUnit.Auto), label: 'auto' },
          ]}
          onChange={(v) => setUnit(Number(v))}
        />
      </span>
    </div>
  );
}

export function StringControl({
  value,
  mixed,
  onBegin,
  onEnd,
  onCancel,
  onChange,
}: ControlGesture & { value: string; mixed?: boolean; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const startValue = useRef(value); // pre-edit value, for Escape-revert
  return (
    <span className="field">
      <input
        value={editing ? text : mixed ? '' : value}
        placeholder={mixed ? '—' : undefined}
        spellCheck={false}
        onFocus={() => {
          startValue.current = value;
          setText(value);
          setEditing(true);
          onBegin?.();
        }}
        onBlur={() => {
          setEditing(false);
          onEnd?.();
        }}
        onKeyDown={(e) => {
          // Enter commits (blur → onEnd); Escape cancels — matching NumField so
          // text fields aren't the lone control with no revert path.
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            if (onCancel) onCancel();
            else onChange(startValue.current);
            setText(startValue.current);
            e.currentTarget.blur();
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
    </span>
  );
}

// The color field (swatch + hex + HSV/alpha picker) is the shared ColorControl
// (components/ColorControl.tsx); the gradient editor below composes it.

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

// A key→value string-map editor (Marker.properties): one row per pair (editable key +
// value + delete), plus an add button. Arbitrary Tiled-style custom properties. Each edit
// rebuilds the whole map through the standard field write door (one undo step per change).
export function MapControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: MapValue; onChange: (v: MapValue) => void }) {
  const entries = Object.entries(value);
  const commit = (next: MapValue) => { onBegin?.(); onChange(next); onEnd?.(); };
  const rename = (oldKey: string, raw: string) => {
    const newKey = raw.trim();
    // No-op on unchanged / blank / colliding keys (the input reverts on re-render).
    if (newKey === oldKey || newKey === '' || newKey in value) return;
    const next: MapValue = {};
    for (const [k, v] of Object.entries(value)) next[k === oldKey ? newKey : k] = v;
    commit(next);
  };
  const setVal = (k: string, v: string) => { if (value[k] !== v) commit({ ...value, [k]: v }); };
  const remove = (k: string) => { const next = { ...value }; delete next[k]; commit(next); };
  const add = () => {
    let key = 'key';
    for (let n = 2; key in value; n++) key = `key${n}`;
    commit({ ...value, [key]: '' });
  };
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') { e.currentTarget.value = e.currentTarget.defaultValue; e.currentTarget.blur(); }
  };
  return (
    <div className="map-field">
      {entries.map(([k, v]) => (
        <div key={k} className="map-row">
          <input
            className="map-key" defaultValue={k} aria-label={t('det.mapKey')} placeholder={t('det.mapKey')}
            onKeyDown={blurOnEnter} onBlur={(e) => rename(k, e.target.value)}
          />
          <input
            className="map-val" defaultValue={v} aria-label={t('det.mapValue')} placeholder={t('det.mapValue')}
            onKeyDown={blurOnEnter} onBlur={(e) => setVal(k, e.target.value)}
          />
          <button type="button" className="map-del" title={t('det.mapRemove')} onClick={() => remove(k)}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="map-add" onClick={add}>
        <Plus size={12} /> {t('det.mapAdd')}
      </button>
    </div>
  );
}

// A color-over-life gradient editor: a preview bar with draggable stops; click the
// bar to add a stop, select one to edit its color (the themed picker) or delete it.
// Empty ⇒ the particle falls back to start/end + easing (the runtime bake skips it).
export function GradientControl({
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
            title={t('det.removeStop')}
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
export function CurveControl({
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
            title={t('det.removeKey')}
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
export function AssetControl({
  value,
  assetType,
  mixed,
  readOnly,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & {
  value: string | number;
  assetType?: string;
  mixed?: boolean;
  /** Display-only (the live "Game" inspector): asset identity is not live-tunable
   *  — a picked ref would land in a World slot that holds a realm-local handle. */
  readOnly?: boolean;
  onChange: (v: string | number) => void;
}) {
  const [over, setOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = usePopover();
  const [q, setQ] = useState('');
  const info = AssetRegistry.assetInfo(value);
  // Handle-valued slots clear to 0; path-valued slots (spine skeleton/atlas)
  // are string component fields, so "no asset" is the empty string.
  const empty = assetType === 'spine-skeleton' || assetType === 'spine-atlas' ? '' : 0;

  const setRefFromPath = (path: string) => {
    // Reject a wrong-typed drop (the picker popover already filters; this guards the
    // drag-drop hole so a font can't land in a texture slot).
    if (!AssetRegistry.assetTypeAllowed(assetType, path)) {
      Toasts.push(t('det.wrongAssetType', { type: assetType ?? '' }), 'error');
      return;
    }
    onBegin?.();
    void AssetRegistry.assetRefForPath(path, assetType).then((ref) => {
      if (ref) onChange(ref);
      onEnd?.();
    });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (readOnly) return;
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
    ? AssetRegistry.listAssets(assetType).filter((a) => !ql || a.name.toLowerCase().includes(ql))
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
      <button
        type="button"
        className="loc"
        title={info ? t('det.locateInBrowser', { path: info.path }) : undefined}
        disabled={!info}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => info && revealAsset(info.path)}
      >
        <span className="th">
          {!mixed && isImageAsset(assetType as AssetType) && info ? (
            <img src={`estella://project/${info.path}`} alt="" draggable={false} />
          ) : (
            <Box size={11} strokeWidth={1.7} />
          )}
        </span>
        {/* Multi-select disagreement: "—", not the first entity's asset. */}
        <span className={`an${mixed ? ' dd-none' : ''}`}>{mixed ? '—' : info ? info.name : t('det.none')}</span>
      </button>
      {!readOnly && (
        <button type="button" className="pk" title={t('det.pickAsset')} onMouseDown={(e) => e.stopPropagation()} onClick={openPick}>
          <Search size={11} strokeWidth={2} />
        </button>
      )}
      {!readOnly && info && (
        <button
          type="button"
          className="pk"
          title={t('det.clear')}
          onClick={() => {
            onBegin?.();
            onChange(empty);
            onEnd?.();
          }}
        >
          <X size={11} strokeWidth={2} />
        </button>
      )}
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 240)} onClose={close}>
          <SearchField flush className="dd-search" iconSize={12} autoFocus placeholder={t('det.searchAssets')} value={q} onChange={setQ} />
          <div className="asset-grid">
            <button type="button" className={`asset-opt${!info ? ' on' : ''}`} onClick={() => pick(empty)}>
              <span className="th">
                <X size={13} strokeWidth={2} />
              </span>
              <span className="an">{t('det.none')}</span>
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
            {assets.length === 0 && <div className="empty-line empty-line--sm">{t('det.noMatchingAssets')}</div>}
          </div>
        </Popover>
      )}
    </div>
  );
}
