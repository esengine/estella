// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Cog,
  Component as ComponentIcon,
  Copy,
  ClipboardPaste,
  Filter,
  Hexagon,
  FolderOpen,
  Image as ImageIcon,
  MoreHorizontal,
  Move3d,
  Package,
  Plus,
  RotateCcw,
  Save,
  Search,
  Square,
  SquarePen,
  Trash2,
  Upload,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AssetIcon } from '@/components/icons';
import { COMP_COLLIDER_SHAPE, type ColliderShapeKind } from '@/engine/colliderConvert';
import { AudioWavePreview } from '@/components/AudioWavePreview';
import { Toasts } from '@/store/Toasts';
import { baseName, assetTypeOf, IMAGE_RE } from '@/project/assetMeta';
import { revealAsset } from '@/project/assetReveal';
import { useSelection } from '@/store/selectionStore';
import { usePrefabConflicts } from '@/store/prefabConflicts';
import { useEditorStore } from '@/store/editorStore';
import { useControllerStore } from '@/store/controllerStore';
import { isGeared, controllerCurrentPage, readModelField, readGearBindings } from '@/controller/controllerModel';
import { useOutliner } from '@/outliner/OutlinerController';
import { isFolderUnder, folderName } from '@/outliner/folders';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery, buildEntityInfo, buildInspector } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { InspectorClipboard } from '@/engine/inspectorClipboard';
import { SceneCommands, toModelValue } from '@/engine/SceneCommands';
import { ENTITY_SOURCES, createFromSource } from '@/engine/entitySources';
import { PlayInspect } from '@/engine/PlayInspect';
import { DimensionUnit, AnchorAxis, detectAnchorAxes, UIPositionType, parseLocaleTable, EasingType, INVALID_ENTITY } from 'esengine';
import type { SceneData, InputMapAsset, ActionType, Binding, LocaleTableAsset, PluralCategory, GearValue, GearTween } from 'esengine';
import { modelAddableComponentEntries, subscribeSchemas, getSchemaRevision, prettyLabel, hexToRgba, dynamicEnumOptions, boxGroupsFor, isRequiredEmpty, type BoxGroupDef } from '@/engine/schema';
import * as imap from '@/project/inputMapDoc';
import * as ldoc from '@/project/localeTableDoc';
import { buildImporterComponent, applyImporterEdit } from '@/project/assetImporter';
import { findAssetUsages } from '@/project/assetUsages';
import { FindUsagesDialog } from '@/components/FindUsagesDialog';
import { ProjectStore } from '@/project/ProjectStore';
import { confirmDiscard, confirmDiscardDoc } from '@/project/discardGuard';
import { t } from '@/i18n';
import { MaterialDocument } from '@/material/MaterialDocument';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import {
  isMaterialAsset,
  resolveMaterialContext,
  buildMaterialComponents,
  makeMaterialWrite,
  projectMaterialToHandle,
  renderMaterialThumbnail,
  type MaterialContext,
} from '@/material/materialInspectorModel';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { buildAnimClipComponents, makeAnimClipWrite } from '@/flipbook/animClipInspectorModel';
import { ColorControl, rgbaToHex8 } from '@/components/ColorControl';
import { IconButton } from '@/components/IconButton';
import { EmptyState } from '@/components/EmptyState';
import { ContextMenu } from '@/components/Menu';
import { NumField, useScrub, fmt, type ControlGesture } from '@/components/NumField';
import { Popover, usePopover } from '@/components/Popover';
import { SearchField } from '@/components/SearchField';
import { Select } from '@/components/Select';
import { Segmented, type SegmentedOption } from '@/components/Segmented';
import { AddComponentMenu } from '@/components/AddComponentMenu';
import type { InspectorComponent, InspectorField, InspectorFieldValue, EntityId, NodeKind, EnumOption, AssetType, GradientValue, GradientStop, CurveValue, CurveKey, DimensionValue, InspectSource } from '@/types';

const AXES = ['x', 'y', 'z', 'w'];

// Field-value equality for the "modified" (override) mark. Vectors compare
// element-wise; numbers tolerate float drift so a no-op edit doesn't read as one.
function fieldEqual(a: InspectorFieldValue, b: InspectorFieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((n, i) => Math.abs(n - (b[i] as number)) < 1e-6);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

/** The union of components addable to ANY entity in a multi-selection — a component
 *  is offered if at least one selected entity lacks it (Add applies per-entity). */
function unionAddableComponents(ids: readonly number[]): ReturnType<typeof modelAddableComponentEntries> {
  const byName = new Map<string, ReturnType<typeof modelAddableComponentEntries>[number]>();
  for (const id of ids) {
    const e = SceneModel.entityBySource(id);
    if (!e) continue;
    for (const entry of modelAddableComponentEntries(e)) if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
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
  camera: t('det.kindCamera'),
  sprite: t('det.kindSprite'),
  spine: t('det.kindSpine'),
  physics: t('det.kindPhysics'),
  ui: t('det.kindUi'),
  audio: t('det.kindAudio'),
  group: t('det.kindGroup'),
  light: t('det.kindLight'),
  empty: t('det.kindEntity'),
};

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
  onBegin,
  onEnd,
  onCancel,
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

// A named-int dropdown (e.g. Camera projection, body type) — a themed popover, not
// a native <select>, so the list matches the editor and searches when long. The
// stored value is the option's int; an unknown value shows a "(n)" placeholder.
export function EnumControl({
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
            <SearchField flush className="dd-search" iconSize={12} autoFocus placeholder={t('ui.search')} value={q} onChange={setQ} />
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
            {filtered.length === 0 && <div className="empty-line empty-line--sm">{t('det.noMatch')}</div>}
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
  const pick = (id: number) => {
    onChange(id);
    close();
  };
  return (
    <span className="field dropdown">
      <button ref={trigger} type="button" className="dd-trigger" onMouseDown={(e) => e.stopPropagation()} onClick={toggle}
        title={isDangling ? t('det.entityMissingTip') : undefined}>
        <span className={`dd-val${mixed || isUnsetEntity(value) || isDangling ? ' dd-none' : ''}`}>{mixed ? '—' : label}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} width={Math.max(pop.anchor.width, 160)} onClose={close}>
          {options.length > 8 && (
            <SearchField flush className="dd-search" iconSize={12} autoFocus placeholder={t('ui.search')} value={q} onChange={setQ} />
          )}
          <div className="dd-list">
            <button type="button" className={`dd-opt${isUnsetEntity(value) && !mixed ? ' on' : ''}`} onClick={() => pick(INVALID_ENTITY)}>
              <span className="dd-opt-label dd-none">{t('det.entityNone')}</span>
              {isUnsetEntity(value) && !mixed && <Check size={12} strokeWidth={2.4} />}
            </button>
            {filtered.map((o) => (
              <button key={o.id} type="button" className={`dd-opt${o.id === value && !mixed ? ' on' : ''}`} onClick={() => pick(o.id)}>
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
      ? t('det.none')
      : active.length === bits.length && bits.length >= 4
        ? t('det.everything')
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
                {t('det.everything')}
              </button>
              <button type="button" onClick={() => onChange(0)}>
                {t('det.nothing')}
              </button>
            </div>
          )}
          <div className="dd-list">
            {bits.map((o) => {
              const on = !mixed && (value & o.value) === o.value;
              // From a MIXED selection the checkboxes all read empty, so a click sets
              // exactly that bit for everyone (unify → concrete, like BoolControl).
              // XORing the primary's mask instead would silently stamp its OTHER bits
              // onto the rest of the selection.
              return (
                <button key={o.value} type="button" className="dd-opt" onClick={() => onChange(mixed ? o.value : value ^ o.value)}>
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
        <NumField value={value} suffix={unit} mixed={mixed} onBegin={onBegin} onEnd={onEnd} onCommit={onChange} />
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
      role="switch"
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

function StringControl({
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
  const info = ProjectStore.assetInfo(value);
  // Handle-valued slots clear to 0; path-valued slots (spine skeleton/atlas)
  // are string component fields, so "no asset" is the empty string.
  const empty = assetType === 'spine-skeleton' || assetType === 'spine-atlas' ? '' : 0;

  const setRefFromPath = (path: string) => {
    // Reject a wrong-typed drop (the picker popover already filters; this guards the
    // drag-drop hole so a font can't land in a texture slot).
    if (!ProjectStore.assetTypeAllowed(assetType, path)) {
      Toasts.push(t('det.wrongAssetType', { type: assetType ?? '' }), 'error');
      return;
    }
    onBegin?.();
    void ProjectStore.assetRefForPath(path, assetType).then((ref) => {
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
      <button
        type="button"
        className="loc"
        title={info ? t('det.locateInBrowser', { path: info.path }) : undefined}
        disabled={!info}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => info && revealAsset(info.path)}
      >
        <span className="th">
          {!mixed && assetType === 'texture' && info ? (
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

// A field write override (the live "Game" inspector routes edits to the realm
// instead of the undoable SceneCommands path). When set, gestures are no-ops.
type FieldWrite = (key: string, type: InspectorField['type'], value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue) => void;

// The write primitives for one field, shared by FieldRow and the compound
// BoxSidesControl so both commit through the identical door: an edit fans out to
// every selected entity (the open gesture coalesces them into one undo step) and
// clamps to the field's range; the live "Game" inspector routes to the realm
// instead, where gestures are no-ops.
function fieldWriter(entities: EntityId[], comp: string, field: InspectorField, write?: FieldWrite) {
  const ranged = field.min != null || field.max != null;
  const apply = (value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue) => {
    let v = value;
    if (ranged && typeof v === 'number') {
      if (field.min != null) v = Math.max(field.min, v);
      if (field.max != null) v = Math.min(field.max, v);
    }
    if (write) return write(field.key, field.type, v);
    for (const e of entities) SceneCommands.setField(e, comp, field.key, field.type, v as never);
  };
  const begin = () => (write ? undefined : SceneCommands.beginGesture(`Edit ${field.label}`));
  const end = () => (write ? undefined : SceneCommands.endGesture());
  // Escape: abort the gesture so each entity reverts to its own captured value.
  // Asset-editor writes (no scene gesture) have nothing to abort.
  const cancel = () => (write ? undefined : SceneCommands.abortGesture());
  return { apply, begin, end, cancel };
}

// Curated page-change easings for the gear popover, name → EasingType value.
const GEAR_EASINGS = [
  'Linear', 'EaseOutQuad', 'EaseInOutQuad', 'EaseOutCubic',
  'EaseInOutCubic', 'EaseOutBack', 'EaseOutElastic', 'EaseOutBounce',
] as const;
type GearEasingName = (typeof GEAR_EASINGS)[number];

/**
 * Settings for one bound gear: page-change transition (duration 0 = snap, else
 * duration + easing tween) and the unbind action — opened from a bound gear dot
 * so unbinding is a deliberate second step, not a destructive dot toggle.
 */
function GearPopover({ anchor, onClose, entity, controller, component, property }: {
  anchor: DOMRect;
  onClose: () => void;
  entity: EntityId;
  controller: string;
  component: string;
  property: string;
}) {
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const binding = readGearBindings(entity).find(
    (b) => b.controller === controller && b.component === component && b.property === property);
  const tween = binding?.tween;
  const duration = tween?.duration ?? 0;
  const [durText, setDurText] = useState(String(duration));

  if (!binding) return null;

  const setTween = (next?: GearTween) =>
    SceneCommands.setGearTween(entity, controller, component, property, next);
  const commitDuration = () => {
    const d = Math.max(0, parseFloat(durText) || 0);
    setDurText(String(d));
    if (d === duration) return;
    setTween(d > 0 ? { easing: tween?.easing ?? EasingType.EaseOutQuad, duration: d } : undefined);
  };
  const easingName: GearEasingName =
    GEAR_EASINGS.find((n) => EasingType[n] === (tween?.easing ?? EasingType.Linear)) ?? 'Linear';

  return (
    <Popover anchor={anchor} width={210} onClose={onClose} className="gear-pop">
      <div className="gear-pop-title">{controller} · {component}.{property}</div>
      <div className="gear-pop-row">
        <span className="gear-pop-label">{t('ctrl.gearDuration')}</span>
        <input
          type="number"
          className="gear-pop-num"
          min={0}
          step={0.05}
          value={durText}
          onChange={(e) => setDurText(e.target.value)}
          onBlur={commitDuration}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDuration(); }}
        />
      </div>
      <div className="gear-pop-row">
        <span className="gear-pop-label">{t('ctrl.gearEasing')}</span>
        <Select<GearEasingName>
          value={easingName}
          options={GEAR_EASINGS.map((n) => ({ value: n }))}
          onChange={(n) => setTween({ easing: EasingType[n], duration: duration > 0 ? duration : 0.15 })}
          className="gear-pop-select"
          ariaLabel={t('ctrl.gearEasing')}
        />
      </div>
      <button
        type="button"
        className="gear-pop-remove"
        onClick={() => {
          SceneCommands.removeGearBinding(entity, controller, component, property);
          onClose();
        }}
      >
        {t('ctrl.gearUnbind')}
      </button>
    </Popover>
  );
}

/**
 * Gear dot for one (component, field) — only for a single authored entity that
 * resolves the active controller. Clicking an unbound dot binds the field
 * (seeding the current page with its value); clicking a bound dot opens the gear
 * popover (transition tween + unbind) instead of destructively toggling. While
 * recording, bound dots go red — "edits here land in the current page". Returns
 * the rendered dot (+ popover) or null, so both FieldRow and the component
 * header's promoted enable-checkbox share one implementation.
 */
function useGearDot(entities: EntityId[], comp: string, key: string, write?: FieldWrite): ReactNode {
  const activeController = useControllerStore((s) => s.activeController);
  const recording = useControllerStore((s) => s.recording);
  const gearPop = usePopover();
  const gearEntity = entities[0];
  const gearPage = entities.length === 1 && !write && activeController != null
    ? controllerCurrentPage(gearEntity, activeController)
    : null;
  const gearable = gearPage != null && activeController != null;
  const geared = gearable && isGeared(gearEntity, activeController, comp, key);
  if (!gearable || activeController == null || gearPage == null) return null;

  const onGearClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (geared) {
      gearPop.open(e.currentTarget);
    } else {
      const value = readModelField(gearEntity, comp, key);
      if (value === undefined) return;
      SceneCommands.addGearBinding(gearEntity, {
        controller: activeController,
        component: comp,
        property: key,
        pages: { [gearPage]: value as GearValue },
      });
    }
  };

  return (
    <>
      <button
        type="button"
        className={`prop-gear${geared ? ' on' : ''}${geared && recording ? ' rec' : ''}`}
        tabIndex={-1}
        title={geared ? t('ctrl.gearSettings') : t('ctrl.gearBind')}
        onClick={onGearClick}
      >
        <Cog size={11} strokeWidth={2} />
      </button>
      {gearPop.anchor && (
        <GearPopover
          anchor={gearPop.anchor}
          onClose={gearPop.close}
          entity={gearEntity}
          controller={activeController}
          component={comp}
          property={key}
        />
      )}
    </>
  );
}

function FieldRow({ entities, comp, field, write }: { entities: EntityId[]; comp: string; field: InspectorField; write?: FieldWrite }) {
  const mixed = field.mixed === true;
  const { apply, begin, end, cancel } = fieldWriter(entities, comp, field, write);
  const gearDot = useGearDot(entities, comp, field.key, write);

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

  // A string field whose choices depend on the entity's runtime state (e.g. a spine
  // animation/skin name) or on project content (an i18n key with its translated
  // preview) renders as a dropdown of the live options, falling back to the text
  // field when none are available (no skeleton loaded / no locale tables yet).
  const dynOpts =
    field.type === 'select'
      ? (field.selectOptions ?? []).map((o) => ({ value: o }))
      : !mixed && !write && field.type === 'string'
        ? dynamicEnumOptions(comp, field.key, entities[0])
        : null;
  let control;
  if (dynOpts) {
    const cur = String(field.value);
    control = (
      <span className="field dropdown">
        <Select
          variant="field"
          value={cur}
          ariaLabel={field.key}
          options={[
            ...(dynOpts.some((o) => o.value === cur) ? [] : [{ value: cur, label: cur || t('det.noneOption') }]),
            ...dynOpts,
          ]}
          onChange={(v) => {
            begin();
            apply(v);
            end();
          }}
        />
      </span>
    );
  } else
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
            mixed={mixed}
            onBegin={begin}
            onEnd={end}
            onChange={apply}
          />
        ) : (
          <NumField value={field.value as number} suffix={field.unit} mixed={mixed} step={field.step} min={field.min} max={field.max} onBegin={begin} onEnd={end} onCancel={cancel} onCommit={apply} />
        );
      break;
    case 'angle':
      control = <NumField value={field.value as number} suffix="°" mixed={mixed} step={field.step} onBegin={begin} onEnd={end} onCancel={cancel} onCommit={apply} />;
      break;
    case 'vec2':
    case 'vec3':
    case 'vec4':
      control = <VecControl value={field.value as number[]} mixed={mixed} onBegin={begin} onEnd={end} onCancel={cancel} onChange={apply} />;
      break;
    case 'dimension':
      control = <DimControl value={field.value as DimensionValue} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
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
    case 'entity':
      control = <EntityControl value={field.value as number} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
      break;
    case 'color':
      control = <ColorControl value={field.value as string} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />;
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
          mixed={mixed}
          readOnly={!!write}
          onBegin={begin}
          onEnd={end}
          onChange={apply}
        />
      );
      break;
    default:
      control = <StringControl value={String(field.value)} mixed={mixed} onBegin={begin} onEnd={end} onCancel={cancel} onChange={apply} />;
  }

  const modified = !mixed && isModified(field);
  const reset = () => {
    if (field.defaultValue === undefined) return;
    begin();
    apply(field.defaultValue);
    end();
  };

  // Right-click a property → Copy / Paste its value (the live "Game" inspector has no
  // undoable write door, so it's disabled there).
  const [fctx, setFctx] = useState<{ x: number; y: number } | null>(null);
  const pasteValue = InspectorClipboard.fieldValue(field.type);
  const doPaste = () => {
    if (pasteValue == null) return;
    begin();
    apply(pasteValue as never);
    end();
  };

  // A required field left empty (no asset / blank string) — flagged, not blocked
  // (soft). ONE predicate with the surface's getDiagnostics sweep, so automation
  // gates on exactly what this red flag shows.
  const invalid = !!field.required && isRequiredEmpty(field.value);

  return (
    <div
      className={`prop${modified ? ' modified' : ''}${mixed ? ' mixed' : ''}${invalid ? ' invalid' : ''}`}
      onContextMenu={
        write
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setFctx({ x: e.clientX, y: e.clientY });
            }
      }
    >
      <span
        className={`prop-label${isScalar ? ' scrub' : ''}`}
        title={field.tooltip}
        {...(isScalar ? labelScrub : {})}
      >
        {field.label}
      </span>
      <div className="prop-value">
        {control}
        {gearDot}
      </div>
      <button
        type="button"
        className={`prop-reset${modified ? ' show' : ''}`}
        tabIndex={-1}
        title={t('det.resetToDefault')}
        onClick={modified ? reset : undefined}
      >
        <RotateCcw size={11} strokeWidth={2} />
      </button>
      {fctx && (
        <ContextMenu
          x={fctx.x}
          y={fctx.y}
          onClose={() => setFctx(null)}
          items={[
            {
              label: t('det.copy'),
              icon: <Copy size={13} strokeWidth={1.9} />,
              disabled: mixed,
              onClick: () => InspectorClipboard.copyField(comp, field.key, field.type, field.value),
            },
            {
              label: t('det.paste'),
              icon: <ClipboardPaste size={13} strokeWidth={1.9} />,
              disabled: pasteValue == null,
              onClick: doPaste,
            },
            {
              label: t('det.resetToDefault'),
              icon: <RotateCcw size={13} strokeWidth={1.9} />,
              disabled: !modified,
              onClick: reset,
            },
          ]}
        />
      )}
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

/** Give a boxless Text a UI layout box: ensure a Canvas (create one if the scene has
 *  none), then add a sized UINode + reparent under it so align/verticalAlign resolve
 *  within a box instead of anchoring to the origin. */
async function addTextLayoutBox(sourceId: EntityId): Promise<void> {
  let canvas = SceneCommands.findCanvas();
  if (canvas == null) {
    const src = ENTITY_SOURCES.find((s) => s.id === 'canvas');
    canvas = src ? await createFromSource(src, { parent: null }) : null;
  }
  if (canvas != null) SceneCommands.attachUINodeBox(sourceId, canvas, 240, 80);
}

/** The one-click "Add layout box" action for a boxless Text (no UINode), else undefined. */
function textBoxAction(comp: InspectorComponent, sourceId: EntityId): { label: string; title: string; run: () => void } | undefined {
  if (comp.name !== 'Text') return undefined;
  const e = SceneModel.entityBySource(sourceId);
  if (!e || e.components.some((c) => c.type === 'UINode')) return undefined;
  return {
    label: t('det.addLayoutBox'),
    title: t('det.addLayoutBoxTip'),
    run: () => void addTextLayoutBox(sourceId),
  };
}

/** Whether a UI element sits under a Canvas (the UI layout root) — walks ancestors. */
function hasCanvasAncestor(sourceId: EntityId): boolean {
  for (let p = SceneModel.entityBySource(sourceId)?.parent; p != null; p = SceneModel.entityBySource(p)?.parent) {
    if (SceneModel.entityBySource(p)?.components.some((c) => c.type === 'Canvas')) return true;
  }
  return false;
}

/** Ensure a Canvas exists (create one if the scene has none) and place `sourceIds` under it. */
async function placeUnderCanvas(sourceIds: EntityId[]): Promise<void> {
  let canvas = SceneCommands.findCanvas();
  if (canvas == null) {
    const src = ENTITY_SOURCES.find((s) => s.id === 'canvas');
    canvas = src ? await createFromSource(src, { parent: null }) : null;
  }
  if (canvas == null) return;
  for (const id of sourceIds) if (id !== canvas) SceneCommands.setParent(id, canvas);
}

/** The one-click "Place under a Canvas" action for a UINode with no Canvas ancestor —
 *  a UI element with no Canvas can't lay out or be moved — else undefined. */
function uiNodeCanvasAction(ids: EntityId[], comp: InspectorComponent): { label: string; title: string; run: () => void } | undefined {
  if (comp.name !== 'UINode') return undefined;
  const orphans = ids.filter((id) => !hasCanvasAncestor(id));
  if (orphans.length === 0) return undefined;
  return {
    label: t('det.placeUnderCanvas'),
    title: t('det.placeUnderCanvasTip'),
    run: () => void placeUnderCanvas(orphans),
  };
}

const ANCHOR_H = { [AnchorAxis.Start]: t('det.anchorLeft'), [AnchorAxis.Center]: t('det.anchorCenter'), [AnchorAxis.End]: t('det.anchorRight'), [AnchorAxis.Stretch]: t('det.anchorStretchH') };
const ANCHOR_V = { [AnchorAxis.Start]: t('det.anchorTop'), [AnchorAxis.Center]: t('det.anchorMiddle'), [AnchorAxis.End]: t('det.anchorBottom'), [AnchorAxis.Stretch]: t('det.anchorStretchV') };
const anchorTitle = (h: AnchorAxis, v: AnchorAxis) =>
  h === AnchorAxis.Stretch && v === AnchorAxis.Stretch ? t('det.anchorStretch') : `${ANCHOR_V[v]} · ${ANCHOR_H[h]}`;

// The widget rect (in a 24×24 cell viewBox) a preset draws: a small rounded box for
// a pinned corner/edge/centre, stretched along a Stretch axis, filling the frame
// when both axes stretch — the element shown inside its parent (the cell).
function anchorWidgetRect(h: AnchorAxis, v: AnchorAxis) {
  const axis = (mode: AnchorAxis, crossStretch: boolean) => {
    if (mode === AnchorAxis.Stretch) return { p: 3.5, s: 17 };
    const s = crossStretch ? 6 : 9; // a thin bar's cross-section vs a box's side
    const c = mode === AnchorAxis.Start ? 7 : mode === AnchorAxis.End ? 17 : 12;
    return { p: c - s / 2, s };
  };
  const hx = axis(h, v === AnchorAxis.Stretch);
  const vy = axis(v, h === AnchorAxis.Stretch);
  return { x: hx.p, y: vy.p, w: hx.s, h: vy.s };
}

const H_ANCHOR_OPTS = [
  { value: String(AnchorAxis.Start), label: t('det.anchorLeft') },
  { value: String(AnchorAxis.Center), label: t('det.anchorCenter') },
  { value: String(AnchorAxis.End), label: t('det.anchorRight') },
  { value: String(AnchorAxis.Stretch), label: t('det.anchorStretch') },
];
const V_ANCHOR_OPTS = [
  { value: String(AnchorAxis.Start), label: t('det.anchorTop') },
  { value: String(AnchorAxis.Center), label: t('det.anchorMiddle') },
  { value: String(AnchorAxis.End), label: t('det.anchorBottom') },
  { value: String(AnchorAxis.Stretch), label: t('det.anchorStretch') },
];

const POSITION_MODE_OPTS = [
  { value: String(UIPositionType.Relative), label: t('det.inLayout') },
  { value: String(UIPositionType.Absolute), label: t('det.absolute') },
];
// alignSelf enum: 0 Auto · 1 Start · 2 Center · 3 End · 4 Stretch (matches the SDK).
const ALIGN_SELF_OPTS = [
  { value: '0', label: t('det.alignAuto') },
  { value: '1', label: t('det.alignStart') },
  { value: '2', label: t('det.alignCenter') },
  { value: '3', label: t('det.alignEnd') },
  { value: '4', label: t('det.alignStretch') },
];

/** The UINode fields the Layout block owns, so the generic field flow skips them —
 *  which set depends on the positioning MODE (an anchor/inset belongs to Absolute,
 *  the flex knobs to flow). Mirrors how box cards claim their edge fields. */
function uiLayoutOwnedFields(absolute: boolean): ReadonlySet<string> {
  const base = ['position', 'alignSelf'];
  // Flow: offsets are meaningless (inset only applies to Absolute). Absolute: the
  // flex-item knobs don't participate (the node is out of flow).
  return new Set(absolute ? [...base, 'flexGrow', 'flexShrink', 'flexBasis'] : [...base, 'insetLeft', 'insetRight', 'insetTop', 'insetBottom']);
}

/** The anchor 9-preset picker for an ABSOLUTE UINode: a live preview + two labelled
 *  Horizontal/Vertical pickers (Left/Center/Right/Stretch × Top/Middle/Bottom/Stretch).
 *  Each axis is an independent choice, written alone so the other axis keeps its
 *  state, read back per-axis via detectAnchorAxes. */
function AnchorPicker({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const dim = (key: string) => {
    const v = comp.fields.find((f) => f.key === key)?.value as { value: number; unit: number } | undefined;
    return v ?? { value: 0, unit: DimensionUnit.Auto };
  };
  const node = {
    position: UIPositionType.Absolute,
    insetLeft: dim('insetLeft'), insetRight: dim('insetRight'),
    insetTop: dim('insetTop'), insetBottom: dim('insetBottom'),
    marginLeft: dim('marginLeft'), marginRight: dim('marginRight'),
    marginTop: dim('marginTop'), marginBottom: dim('marginBottom'),
    width: dim('width'), height: dim('height'),
  } as Parameters<typeof detectAnchorAxes>[0];
  // Each axis classifies independently, so a box with one hand-tuned axis still
  // shows (and keeps) the clean one; writing an axis touches ONLY that axis.
  const axes = detectAnchorAxes(node);
  const clean = axes.h !== null && axes.v !== null;
  const r = anchorWidgetRect(axes.h ?? AnchorAxis.Center, axes.v ?? AnchorAxis.Center);
  return (
    <>
      <div className="anchor-head">
        <span className="anchor-t">{t('det.anchor')}</span>
        <em className="anchor-cur">{clean ? anchorTitle(axes.h!, axes.v!) : t('det.anchorCustom')}</em>
      </div>
      <div className="anchor-body">
        <div className={`anchor-preview${clean ? '' : ' custom'}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect className="anchor-frame" x="2.5" y="2.5" width="19" height="19" rx="3" ry="3" />
            <rect className="anchor-widget" x={r.x} y={r.y} width={r.w} height={r.h} rx="2" ry="2" />
          </svg>
        </div>
        <div className="anchor-axes">
          <label className="anchor-axis">
            <span>{t('det.horizontal')}</span>
            <Segmented
              grow
              ariaLabel={t('det.horizontalAnchorAria')}
              value={axes.h !== null ? String(axes.h) : ''}
              options={H_ANCHOR_OPTS}
              onChange={(val) => SceneCommands.setUINodeAnchor(entities, { h: Number(val) })}
            />
          </label>
          <label className="anchor-axis">
            <span>{t('det.vertical')}</span>
            <Segmented
              grow
              ariaLabel={t('det.verticalAnchorAria')}
              value={axes.v !== null ? String(axes.v) : ''}
              options={V_ANCHOR_OPTS}
              onChange={(val) => SceneCommands.setUINodeAnchor(entities, { v: Number(val) })}
            />
          </label>
        </div>
      </div>
    </>
  );
}

/** The flow-layout controls for a RELATIVE (In-Layout) UINode: its parent's flex
 *  layout decides the placement, so the only per-node control is the cross-axis
 *  Align Self (the flow analog of a 1-axis anchor). Grow/shrink/basis live in the
 *  field flow below. */
function FlowLayoutControls({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const field = comp.fields.find((f) => f.key === 'alignSelf');
  const value = field?.mixed ? '' : String(Number(field?.value ?? 0));
  const set = (val: string) => {
    SceneCommands.beginGesture('Align Self');
    for (const id of entities) SceneCommands.setField(id, 'UINode', 'alignSelf', 'enum', Number(val));
    SceneCommands.endGesture();
  };
  return (
    <>
      <div className="anchor-body">
        <div className="anchor-axes">
          <label className="anchor-axis">
            <span>{t('det.alignSelf')}</span>
            <Segmented grow ariaLabel={t('det.alignSelfAria')} value={value} options={ALIGN_SELF_OPTS} onChange={set} />
          </label>
        </div>
      </div>
      <div className="anchor-hint">{t('det.flowHint')}</div>
    </>
  );
}

/** The UINode positioning block: an explicit In-Layout ↔ Absolute mode switch, then
 *  the controls that actually apply in that mode — the anchor presets for Absolute,
 *  Align Self for flow. Anchors are an absolute-positioning concept, so a flow node
 *  never shows a meaningless "Custom" anchor; it shows how it sits in its parent's
 *  flex layout instead. The mode switch writes `position` (flipping to Absolute bakes
 *  the current on-screen box into px insets — see SceneCommands.setField). */
// The convertible collider shapes, shown as a segmented switch on the collider card's
// header. Converting preserves material / sensor / filter and re-derives geometry (see
// SceneCommands.convertCollider) — you can start with a box and turn it into a slope
// polygon without losing what you set.
const COLLIDER_SHAPE_OPTIONS: SegmentedOption<ColliderShapeKind>[] = [
  { value: 'box', label: t('det.shapeBox'), icon: <Square size={11} />, title: t('det.shapeBox') },
  { value: 'circle', label: t('det.shapeCircle'), icon: <Circle size={11} />, title: t('det.shapeCircle') },
  { value: 'polygon', label: t('det.shapePolygon'), icon: <Hexagon size={11} />, title: t('det.shapePolygon') },
];

// Shape switch for a box/circle/polygon collider card — click another shape to convert
// the collider on every selected entity (one undo step). Null for non-convertible cards.
function ColliderShapeControl({ entities, current }: { entities: EntityId[]; current: string }) {
  const kind = COMP_COLLIDER_SHAPE[current];
  if (!kind) return null;
  return (
    <div className="collider-shape">
      <span className="collider-shape-lbl">{t('det.colliderShape')}</span>
      <Segmented
        value={kind}
        options={COLLIDER_SHAPE_OPTIONS}
        ariaLabel={t('det.colliderShape')}
        grow
        onChange={(to) => { if (to !== kind) SceneCommands.convertColliderMany(entities, to); }}
      />
    </div>
  );
}

function UILayoutControl({ entities, comp }: { entities: EntityId[]; comp: InspectorComponent }) {
  const posField = comp.fields.find((f) => f.key === 'position');
  const absolute = Number(posField?.value ?? 0) === UIPositionType.Absolute;
  const setMode = (val: string) => {
    SceneCommands.beginGesture('UI Position Mode');
    for (const id of entities) SceneCommands.setField(id, 'UINode', 'position', 'enum', Number(val));
    SceneCommands.endGesture();
  };
  return (
    <div className="anchor-block">
      <div className="ui-mode-row">
        <span className="anchor-t">{t('det.position')}</span>
        <Segmented
          grow
          ariaLabel={t('det.positionModeAria')}
          value={posField?.mixed ? '' : String(absolute ? UIPositionType.Absolute : UIPositionType.Relative)}
          options={POSITION_MODE_OPTS}
          onChange={setMode}
        />
      </div>
      {absolute ? <AnchorPicker entities={entities} comp={comp} /> : <FlowLayoutControls entities={entities} comp={comp} />}
    </div>
  );
}

// One side of a box-model group: a lettered edge (L/R/T/B) + its Dimension well.
// It commits through `fieldWriter` — the same door as FieldRow — so undo, mixed,
// and reset behave identically; right-click keeps the per-field Copy/Paste/Reset.
function BoxSide({
  entities,
  comp,
  field,
  write,
  abbr,
}: {
  entities: EntityId[];
  comp: string;
  field: InspectorField;
  write?: FieldWrite;
  abbr: string;
}) {
  const mixed = field.mixed === true;
  const modified = !mixed && isModified(field);
  const { apply, begin, end } = fieldWriter(entities, comp, field, write);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const pasteValue = InspectorClipboard.fieldValue(field.type);
  const reset = () => {
    if (field.defaultValue === undefined) return;
    begin();
    apply(field.defaultValue);
    end();
  };
  return (
    <label
      className={`box-side${modified ? ' modified' : ''}${mixed ? ' mixed' : ''}`}
      title={field.tooltip ?? field.label}
      onContextMenu={
        write
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtx({ x: e.clientX, y: e.clientY });
            }
      }
    >
      <span className="box-side-k">{abbr}</span>
      <DimControl value={field.value as DimensionValue} mixed={mixed} onBegin={begin} onEnd={end} onChange={apply} />
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: t('det.copy'), icon: <Copy size={13} strokeWidth={1.9} />, disabled: mixed, onClick: () => InspectorClipboard.copyField(comp, field.key, field.type, field.value) },
            { label: t('det.paste'), icon: <ClipboardPaste size={13} strokeWidth={1.9} />, disabled: pasteValue == null, onClick: () => { if (pasteValue == null) return; begin(); apply(pasteValue as never); end(); } },
            { label: t('ui.reset'), icon: <RotateCcw size={13} strokeWidth={1.9} />, disabled: !modified, onClick: reset },
          ]}
        />
      )}
    </label>
  );
}

/** A four-edge box (margin / offsets) as one spatial card: L·R on the top row,
 *  T·B below, each a full Dimension well — a compact, scannable stand-in for four
 *  near-identical property rows. Every side still writes through the shared field
 *  door, so it stays part of the reflected inspector, not a fork of it. */
function BoxSidesControl({
  entities,
  comp,
  write,
  group,
  fields,
}: {
  entities: EntityId[];
  comp: string;
  write?: FieldWrite;
  group: BoxGroupDef;
  fields: InspectorField[];
}) {
  const byKey = (key: string) => fields.find((f) => f.key === key);
  const sides: [string, string][] = [
    ['L', group.left],
    ['R', group.right],
    ['T', group.top],
    ['B', group.bottom],
  ];
  return (
    <div className="box-sides">
      <span className="box-caption">{group.label}</span>
      <div className="box-grid">
        {sides.map(([abbr, key]) => {
          const field = byKey(key);
          return field ? <BoxSide key={key} entities={entities} comp={comp} field={field} write={write} abbr={abbr} /> : null;
        })}
      </div>
    </div>
  );
}

function ComponentSection({
  entities,
  comp,
  collapsed,
  onToggle,
  onMore,
  write,
  action,
  extra,
  hideFields,
}: {
  entities: EntityId[];
  comp: InspectorComponent;
  collapsed: boolean;
  onToggle: () => void;
  onMore?: (e: React.MouseEvent, name: string) => void;
  write?: FieldWrite;
  action?: { label: string; title: string; run: () => void };
  extra?: React.ReactNode;
  /** Field keys the `extra` block owns (e.g. UINode's Layout section), skipped by
   *  the generic field flow so they aren't edited in two places. */
  hideFields?: ReadonlySet<string>;
}) {
  const Icon = componentIcon(comp.name);
  const overridden = comp.fields.some(isModified);
  // Categories default open, the Advanced fold defaults closed.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const isOpen = (name: string) => openFolds[name] ?? name !== ADVANCED_FOLD;
  const toggleFold = (name: string) => setOpenFolds((s) => ({ ...s, [name]: !isOpen(name) }));

  // Edge fields that fold into a spatial box (margin/offsets) are pulled out of the
  // normal flow and rendered as a compound card below the plain rows — but only
  // when all four sides are present in the reflection.
  const boxGroups = boxGroupsFor(comp.name).filter(
    (g) =>
      [g.left, g.right, g.top, g.bottom].every((k) => comp.fields.some((f) => f.key === k)) &&
      // A box card the extra block owns (all four sides hidden) drops out entirely.
      ![g.left, g.right, g.top, g.bottom].every((k) => hideFields?.has(k)),
  );
  const boxKeys = new Set(boxGroups.flatMap((g) => [g.left, g.right, g.top, g.bottom]));

  // Bucket fields: a box side is claimed by its card; else a category wins (grouped
  // under its header); else advanced (the Advanced fold); else ungrouped at the top.
  const ungrouped: InspectorField[] = [];
  const advancedFields: InspectorField[] = [];
  const groups = new Map<string, InspectorField[]>();
  for (const f of comp.fields) {
    if (hideFields?.has(f.key)) continue; // owned by the extra block (UINode Layout)
    if (boxKeys.has(f.key)) continue;
    if (f.category) (groups.get(f.category) ?? groups.set(f.category, []).get(f.category)!).push(f);
    else if (f.advanced) advancedFields.push(f);
    else ungrouped.push(f);
  }
  const row = (f: InspectorField) => <FieldRow key={f.key} entities={entities} comp={comp.name} field={f} write={write} />;
  const enable = comp.enable;
  // The promoted enable field is hidden from the body, so it gets its gear dot
  // here — page-driven show/hide is the most common boolean gear.
  const enableGear = useGearDot(entities, comp.name, enable?.key ?? 'enabled', write);
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
          title={enable ? (enable.value ? t('det.disableComponent') : t('det.enableComponent')) : undefined}
          onClick={enable ? toggleEnable : (e) => e.stopPropagation()}
        >
          {on && <Check size={9} strokeWidth={3.2} />}
        </span>
        {enable && enableGear}
        <span className="comp-icon">
          <Icon size={13} strokeWidth={1.9} />
        </span>
        <span className="comp-name">{comp.label}</span>
        {onMore && (
          <button
            type="button"
            className="comp-menu"
            title={t('det.componentOptions')}
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
          {comp.notice && <div className="comp-notice">{comp.notice}</div>}
          {action && (
            <button type="button" className="comp-action" title={action.title} onClick={action.run}>
              {action.label}
            </button>
          )}
          {extra}
          <div className="comp-fields">
            {ungrouped.map(row)}
            {boxGroups.map((g) => (
              <BoxSidesControl key={g.label} entities={entities} comp={comp.name} write={write} group={g} fields={comp.fields} />
            ))}
            {[...groups].map(([cat, fields]) => (
              <Fold key={cat} label={cat} open={isOpen(cat)} onToggle={() => toggleFold(cat)}>
                {fields.map(row)}
              </Fold>
            ))}
            {advancedFields.length > 0 && (
              <Fold label={t('det.advanced')} open={isOpen(ADVANCED_FOLD)} onToggle={() => toggleFold(ADVANCED_FOLD)}>
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
      <div className="game-live">{t('det.playingLive')}</div>
      {selection == null || !info ? (
        <div className="empty">
          <p>{t('det.gameSelectHint')}</p>
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
                action={textBoxAction(comp, selection)}
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

// Material view of the unified inspector — a `.esmaterial` selected in the content browser is
// edited right here, by the same ComponentSection/FieldRow machinery as an entity's components
// (Parameters + Render State), driven by the shader's reflection. There is no bespoke material
// panel: edits flow through the live MaterialDocument (one undo step each, viewport preview) and
// Save writes the JSON back. An instance edits only its overrides; Reset reverts to inherited.
function MaterialAssetInspector({ path }: { path: string }) {
  const revision = useSyncExternalStore(MaterialDocument.subscribe, MaterialDocument.getRevision);
  const [ctx, setCtx] = useState<MaterialContext | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  // Load the selected material into the singleton document when the selection changes, and bind
  // the running handle the scene's sprites use (0 when it's not in the current scene).
  useEffect(() => {
    let alive = true;
    void (async () => {
      // Selection round-trip back to the file already open (possibly dirty —
      // the cleanup below kept it): rebind the handle, never reload from disk.
      if (MaterialDocument.isOpen && MaterialDocument.filePath === path) {
        MaterialDocument.setLiveHandle(ProjectStore.materialHandle(path));
        return;
      }
      if (!(await confirmDiscardDoc(MaterialDocument.dirty, t('discard.openAsset', { name: baseName(path) }))) || !alive) return;
      const text = await window.estella.fs.read(path);
      if (!alive) return;
      MaterialDocument.openJson(JSON.parse(text), path);
      MaterialDocument.setLiveHandle(ProjectStore.materialHandle(path));
    })().catch(() => {});
    return () => {
      alive = false;
      // A dirty document stays open on select-away so the DirtyRegistry guards
      // still see the unsaved edits (closing here would discard them silently).
      if (!MaterialDocument.dirty) MaterialDocument.close();
    };
  }, [path]);

  const asset = MaterialDocument.asset;
  const filePath = MaterialDocument.filePath;
  const loaded = !!asset && filePath === path;

  // Reflect the (root) shader + collect inherited params only when the shader binding changes.
  useEffect(() => {
    if (!loaded || !asset || !filePath) {
      setCtx(null);
      return;
    }
    let alive = true;
    void resolveMaterialContext(asset, filePath).then((c) => {
      if (alive) setCtx(c);
    });
    return () => {
      alive = false;
    };
  }, [loaded, asset?.shader, asset?.instanceOf, filePath]);

  const thumbRef = useRef<HTMLCanvasElement>(null);
  // Live preview: re-project the document onto the running handle on every edit/undo/redo, then
  // refresh the offscreen "material ball" thumbnail from that same handle (WYSIWYG).
  useEffect(() => {
    if (loaded && asset && ctx) {
      projectMaterialToHandle(asset, ctx, MaterialDocument.liveHandle);
      void renderMaterialThumbnail(MaterialDocument.liveHandle, thumbRef.current);
    }
  }, [revision, ctx, loaded]);

  if (!loaded || !asset) {
    return (
      <div className="insp">
        <div className="insp-empty" style={{ flex: 1 }}>
          <div className="et">{t('det.loadingMaterial')}</div>
        </div>
      </div>
    );
  }

  const isInstance = asset.instanceOf != null;
  const dirty = MaterialDocument.dirty;
  const components = ctx ? buildMaterialComponents(asset, ctx) : [];
  const write = ctx ? makeMaterialWrite(ctx) : undefined;

  const save = async () => {
    try {
      await window.estella.fs.write(path, JSON.stringify(asset, null, 2) + '\n');
      MaterialDocument.markSaved();
      Toasts.push(t('det.materialSaved'), 'info', 1400);
    } catch (e) {
      Toasts.push(t('det.materialSaveFailed', { error: String(e) }), 'error');
    }
  };

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{baseName(path)}</div>
          <button type="button" className="primary" disabled={!dirty} onClick={() => void save()} title={t('det.saveMaterialTip')}>
            <Save size={13} strokeWidth={1.9} /> {t('det.save')}
          </button>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('det.material')}</span>
            {isInstance ? t('det.instance') : ctx?.reflection.domain ?? 'Unlit2D'}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>
      {MaterialDocument.liveHandle > 0 && (
        <div className="mat-preview">
          <canvas ref={thumbRef} className="mat-thumb" width={96} height={96} />
        </div>
      )}
      <div className="mat-sync">
        {MaterialDocument.liveHandle
          ? t('det.livePreview')
          : t('det.notInScene')}
      </div>
      <div className="insp-body">
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={collapsed.has(comp.name)}
            onToggle={() => toggle(comp.name)}
            write={write}
          />
        ))}
        {ctx && components.length === 1 && (
          <div className="mat-hint">{t('det.noShaderParams')}</div>
        )}
      </div>
    </div>
  );
}

// Asset view of the unified inspector — shown when an asset (not an entity) is
// selected (in the content browser). A material is edited inline (reflection-driven
const BINDING_KINDS: Array<{ kind: Binding['kind']; label: string }> = [
  { kind: 'key', label: t('det.bindKey') },
  { kind: 'keys1d', label: t('det.bindKeys1d') },
  { kind: 'keys2d', label: t('det.bindKeys2d') },
  { kind: 'mouse', label: t('det.bindMouse') },
  { kind: 'gpButton', label: t('det.bindGpButton') },
  { kind: 'gpAxis', label: t('det.bindGpAxis') },
  { kind: 'stick', label: t('det.bindStick') },
];

function defaultBinding(kind: Binding['kind']): Binding {
  switch (kind) {
    case 'keys1d': return { kind: 'keys1d', neg: 'KeyA', pos: 'KeyD' };
    case 'keys2d': return { kind: 'keys2d', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
    case 'mouse': return { kind: 'mouse', button: 0 };
    case 'gpButton': return { kind: 'gpButton', button: 0 };
    case 'gpAxis': return { kind: 'gpAxis', axis: 0 };
    case 'stick': return { kind: 'stick', stick: 'left' };
    default: return { kind: 'key', code: 'Space' };
  }
}

function BindingRow({ binding, onChange, onRemove }: { binding: Binding; onChange: (b: Binding) => void; onRemove: () => void }) {
  const b = binding as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...(b as object), ...patch } as unknown as Binding);
  const txt = (k: string, ph: string) => (
    <input className="im-in" value={String(b[k] ?? '')} placeholder={ph} onChange={(e) => set({ [k]: e.target.value })} />
  );
  const num = (k: string) => (
    <input className="im-in num" type="number" value={Number(b[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value) || 0 })} />
  );
  let fields: React.ReactNode = null;
  switch (binding.kind) {
    case 'key': fields = txt('code', t('det.bindCodePh')); break;
    case 'keys1d': fields = <>{txt('neg', '−')}{txt('pos', '+')}</>; break;
    case 'keys2d': fields = <>{txt('up', t('det.bindUp'))}{txt('down', t('det.bindDown'))}{txt('left', t('det.bindLeft'))}{txt('right', t('det.bindRight'))}</>; break;
    case 'mouse': case 'gpButton': fields = num('button'); break;
    case 'gpAxis': fields = num('axis'); break;
    case 'stick':
      fields = (
        <Select
          className="im-in"
          ariaLabel={t('det.stickAria')}
          value={b.stick === 'right' ? 'right' : 'left'}
          options={[
            { value: 'left', label: t('det.bindLeft') },
            { value: 'right', label: t('det.bindRight') },
          ]}
          onChange={(v) => set({ stick: v })}
        />
      );
      break;
  }
  return (
    <div className="im-binding">
      <Select
        className="im-in kind"
        ariaLabel={t('det.bindingKindAria')}
        value={binding.kind}
        options={BINDING_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(v) => onChange(defaultBinding(v))}
      />
      {fields}
      <button type="button" className="im-x" onClick={onRemove} title={t('det.removeBinding')}>×</button>
    </div>
  );
}

// The .inputmap editor, embedded in the unified inspector (no separate panel): edits
// the SAME JSON the runtime's loadInputMapAsset reads. Saves on every edit.
function InputMapAssetInspector({ path }: { path: string }) {
  const [map, setMap] = useState<InputMapAsset | null>(null);
  useEffect(() => {
    let alive = true;
    void window.estella.fs
      .read(path)
      .then((t) => {
        if (!alive) return;
        try {
          setMap(JSON.parse(t) as InputMapAsset);
        } catch {
          setMap(imap.blankInputMap());
        }
      })
      .catch(() => alive && setMap(imap.blankInputMap()));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!map) return <div className="insp"><div className="empty-line">{t('det.loading')}</div></div>;

  const commit = (next: InputMapAsset) => {
    setMap(next);
    void window.estella.fs.write(path, JSON.stringify(next, null, 2) + '\n');
  };
  const uniqueName = () => {
    let n = 'NewAction';
    for (let i = 2; map.actions[n]; i++) n = `NewAction${i}`;
    return n;
  };
  const actions = Object.entries(map.actions);

  return (
    <div className="insp input-map">
      <div className="im-head">
        <span>{t('det.inputActions')}</span>
        <button type="button" className="im-add" onClick={() => commit(imap.addAction(map, uniqueName()))}>{t('det.addAction')}</button>
      </div>
      {actions.length === 0 && <div className="empty-line">{t('det.noActions')}</div>}
      {actions.map(([name, def]) => (
        <div className="im-action" key={name}>
          <div className="im-action-head">
            <input
              className="im-name"
              key={name}
              defaultValue={name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== name) commit(imap.renameAction(map, name, e.target.value));
              }}
            />
            <Select
              className="im-in"
              ariaLabel={t('det.actionTypeAria')}
              value={def.type}
              options={[
                { value: 'button', label: t('det.actButton') },
                { value: 'axis', label: t('det.actAxis') },
                { value: 'axis2d', label: t('det.actAxis2d') },
              ]}
              onChange={(v) => commit(imap.setActionType(map, name, v as ActionType))}
            />
            <button type="button" className="im-x" onClick={() => commit(imap.removeAction(map, name))} title={t('det.removeAction')}>×</button>
          </div>
          {def.bindings.map((bnd, i) => (
            <BindingRow
              key={i}
              binding={bnd}
              onChange={(nb) => commit(imap.setBinding(map, name, i, nb))}
              onRemove={() => commit(imap.removeBinding(map, name, i))}
            />
          ))}
          <button type="button" className="im-addb" onClick={() => commit(imap.addBinding(map, name, defaultBinding('key')))}>{t('det.addBinding')}</button>
        </div>
      ))}
    </div>
  );
}

// The .eslocale editor, embedded in the unified inspector (the input-map
// precedent): edits the SAME JSON the runtime's LocaleAssetLoader reads, saving
// on every edit. The project's OTHER tables provide a dimmed reference
// translation per key plus a missing-key backfill list — the translator's
// actual workflow. A syntax error shows read-only guidance instead of an
// editor whose first save would clobber the file.
function LocaleTableAssetInspector({ path }: { path: string }) {
  const [table, setTable] = useState<LocaleTableAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // key → (locale → text) across the project's other .eslocale tables.
  const [siblings, setSiblings] = useState<Map<string, Map<string, string>> | null>(null);

  useEffect(() => {
    let alive = true;
    setTable(null);
    setLoadError(null);
    void window.estella.fs
      .read(path)
      .then((text) => {
        if (!alive) return;
        try {
          setTable(parseLocaleTable(text, path));
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    let alive = true;
    setSiblings(null);
    void (async () => {
      const map = new Map<string, Map<string, string>>();
      for (const asset of ProjectStore.listAssets('locale')) {
        if (asset.path === path) continue;
        try {
          const sib = parseLocaleTable(await window.estella.fs.read(asset.path), asset.path);
          for (const [key, entry] of Object.entries(sib.entries)) {
            let byLocale = map.get(key);
            if (!byLocale) {
              byLocale = new Map();
              map.set(key, byLocale);
            }
            byLocale.set(sib.locale, typeof entry === 'string' ? entry : entry.other);
          }
        } catch {
          /* malformed sibling — selecting IT surfaces the error */
        }
      }
      if (alive) setSiblings(map);
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (loadError) {
    return (
      <div className="insp">
        <div className="comp-notice" style={{ margin: 8 }}>{t('det.localeParseError')}</div>
        <div className="lt-error" title={loadError}>{loadError}</div>
      </div>
    );
  }
  if (!table) return <div className="insp"><div className="empty-line">{t('det.loading')}</div></div>;

  const commit = (next: LocaleTableAsset) => {
    setTable(next);
    void window.estella.fs.write(path, ldoc.serializeLocaleTable(next));
  };
  const uniqueKey = () => {
    let n = 'new.key';
    for (let i = 2; table.entries[n] !== undefined; i++) n = `new.key${i}`;
    return n;
  };
  const blurOnEnter = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };
  // Reference language for a key: 'en' when this table isn't en, else the
  // first other locale that carries it.
  const refFor = (key: string): { tag: string; text: string } | null => {
    const byLocale = siblings?.get(key);
    if (!byLocale || byLocale.size === 0) return null;
    const tag = table.locale !== 'en' && byLocale.has('en')
      ? 'en'
      : ([...byLocale.keys()].find((l) => l !== table.locale) ?? [...byLocale.keys()][0]);
    return { tag, text: byLocale.get(tag)! };
  };
  const missing = siblings ? [...siblings.keys()].filter((k) => table.entries[k] === undefined).sort() : [];
  const entries = Object.entries(table.entries);

  const textField = (fieldKey: string, value: string, write: (v: string) => void) => (
    <span className="field">
      <input
        key={fieldKey}
        defaultValue={value}
        spellCheck={false}
        onBlur={(e) => write(e.target.value)}
        onKeyDown={blurOnEnter}
      />
    </span>
  );

  return (
    <div className="insp">
      <div className="insp-body">
        <LocaleSection
          title={t('det.localeStrings')}
          badge={String(entries.length)}
          action={
            <button
              type="button"
              className="comp-menu lt-headbtn"
              title={t('det.addKey')}
              onClick={(e) => {
                e.stopPropagation();
                commit(ldoc.addEntry(table, uniqueKey()));
              }}
            >
              <Plus size={13} strokeWidth={2} />
            </button>
          }
        >
          <div className="prop">
            <span className="prop-label">{t('det.localeTag')}</span>
            <span className="prop-value">{textField(table.locale, table.locale, (v) => {
              if (v.trim() && v !== table.locale) commit(ldoc.setLocaleTag(table, v));
            })}</span>
            <span />
          </div>
          {entries.length === 0 && <div className="empty-line">{t('det.noStrings')}</div>}
          {entries.map(([key, entry]) => {
            const ref = refFor(key);
            const plural = typeof entry !== 'string';
            const keyInput = (
              <input
                className="lt-key"
                key={key}
                defaultValue={key}
                spellCheck={false}
                title={key}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== key) commit(ldoc.renameEntry(table, key, e.target.value));
                }}
                onKeyDown={blurOnEnter}
              />
            );
            const pluralToggle = (
              <button
                type="button"
                className="lt-act"
                title={plural ? t('det.toSingle') : t('det.toPlural')}
                onClick={() => commit(plural ? ldoc.toSingle(table, key) : ldoc.toPlural(table, key))}
              >
                {plural ? '1' : 'N'}
              </button>
            );
            const remove = (
              <button type="button" className="lt-x" title={t('det.removeEntry')} onClick={() => commit(ldoc.removeEntry(table, key))}>
                <X size={12} strokeWidth={2} />
              </button>
            );
            return (
              <div key={key}>
                {!plural ? (
                  <div className="prop">
                    {keyInput}
                    <span className="prop-value">
                      {textField(`${key}:s`, entry, (v) => commit(ldoc.setEntryText(table, key, v)))}
                      {pluralToggle}
                    </span>
                    {remove}
                  </div>
                ) : (
                  <>
                    <div className="prop">
                      {keyInput}
                      <span className="prop-value">
                        {ldoc.absentPluralForms(entry).length > 0 && (
                          <span className="field dropdown">
                            <Select
                              variant="field"
                              ariaLabel={t('det.pluralFormAria')}
                              value=""
                              options={[
                                { value: '', label: t('det.addForm') },
                                ...ldoc.absentPluralForms(entry).map((c) => ({ value: c, label: c })),
                              ]}
                              onChange={(v) => v && commit(ldoc.setPluralForm(table, key, v as PluralCategory, ''))}
                            />
                          </span>
                        )}
                        {pluralToggle}
                      </span>
                      {remove}
                    </div>
                    {ldoc.PLURAL_CATEGORIES.filter((c) => entry[c] !== undefined).map((c) => (
                      <div className="prop" key={c}>
                        <span className="prop-label lt-formlabel">{c}</span>
                        <span className="prop-value">
                          {textField(`${key}:${c}`, entry[c] ?? '', (v) => commit(ldoc.setPluralForm(table, key, c, v)))}
                        </span>
                        {c !== 'other' ? (
                          <button type="button" className="lt-x" title={t('det.removeForm')} onClick={() => commit(ldoc.removePluralForm(table, key, c))}>
                            <X size={12} strokeWidth={2} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                  </>
                )}
                {ref && (
                  <div className="lt-refrow">
                    <span className="lt-ref" title={`${ref.tag} · ${ref.text}`}>{ref.tag} · {ref.text}</span>
                  </div>
                )}
              </div>
            );
          })}
        </LocaleSection>
        {missing.length > 0 && (
          <LocaleSection title={t('det.missingKeys')} badge={String(missing.length)}>
            {missing.map((k) => {
              const ref = refFor(k);
              return (
                <div className="prop" key={k}>
                  <span className="lt-miss-key" title={k}>{k}</span>
                  <span className="prop-value">
                    {ref && <span className="lt-miss-ref" title={ref.text}>{ref.tag} · {ref.text}</span>}
                  </span>
                  <button type="button" className="lt-addk" title={t('det.addMissingKey')} onClick={() => commit(ldoc.addEntry(table, k))}>
                    <Plus size={12} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </LocaleSection>
        )}
      </div>
    </div>
  );
}

// A collapsible Details section speaking the component-header language — the
// locale editor's structural chrome (title + count badge + an always-visible
// header action), sharing .comp/.prop styling with the entity inspector.
function LocaleSection({ title, badge, action, children }: {
  title: string; badge: string; action?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`comp${open ? ' open' : ''}`}>
      <div className="comp-head" onClick={() => setOpen((o) => !o)}>
        <span className="comp-arrow"><ChevronRight size={13} strokeWidth={2} /></span>
        <span className="comp-name">{title}</span>
        <span className="comp-badge">{badge}</span>
        {action}
      </div>
      <div className="comp-body">
        <div className="cinner">
          <div className="comp-fields">{children}</div>
        </div>
      </div>
    </div>
  );
}

// rows); other assets show their fs metadata + the image/type glyph preview.
function AssetInspector({ path }: { path: string }) {
  const type = assetTypeOf(baseName(path));
  if (isMaterialAsset(path)) {
    return <MaterialAssetInspector path={path} />;
  }
  if (type === 'animclip') {
    return <AnimClipAssetInspector path={path} />;
  }
  if (type === 'inputmap') {
    return <InputMapAssetInspector path={path} />;
  }
  if (type === 'locale') {
    return <LocaleTableAssetInspector path={path} />;
  }
  return <GenericAssetInspector path={path} />;
}

// The .esanim inspector: the open flipbook's fps/loop (+ sheet grid) rendered
// through the same ComponentSection engine as entities and materials. Passive —
// the Flipbook panel owns the AnimClipDocument lifecycle, so this only reflects it
// when the selected clip IS the open one, else falls back to import settings.
function AnimClipAssetInspector({ path }: { path: string }) {
  useSyncExternalStore(AnimClipDocument.subscribe, AnimClipDocument.getRevision);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });

  const asset = AnimClipDocument.asset;
  const loaded = !!asset && AnimClipDocument.filePath === path;
  if (!loaded || !asset) return <GenericAssetInspector path={path} />;

  const components = buildAnimClipComponents(asset);
  const write = makeAnimClipWrite();
  const dirty = AnimClipDocument.dirty;

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{baseName(path)}</div>
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('fb.animClip')}</span>
            {t('fb.frameCount', { count: asset.frames.length })}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>
      <div className="insp-body">
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={collapsed.has(comp.name)}
            onToggle={() => toggle(comp.name)}
            write={write}
          />
        ))}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="cb-mr">
      <span className="k">{k}</span>
      <span className="v" style={mono ? undefined : { fontFamily: 'inherit' }} title={v}>
        {v}
      </span>
    </div>
  );
}

// The asset inspector for every type without a bespoke editor. Renders read-only
// metadata plus, for types with an importer schema, editable Import Settings
// (written to the `.meta` sidecar) through the shared ComponentSection engine.
function GenericAssetInspector({ path }: { path: string }) {
  const name = baseName(path);
  const type = assetTypeOf(name);
  const isImage = IMAGE_RE.test(name);

  const [importer, setImporter] = useState<Record<string, unknown> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stat, setStat] = useState<{ size: number; mtimeMs: number } | null>(null);
  const [dims, setDims] = useState<string | null>(null);
  const [refCount, setRefCount] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [usagesOpen, setUsagesOpen] = useState(false);

  // Load the `.meta` importer block on (re)selection.
  useEffect(() => {
    let alive = true;
    setImporter(null);
    setDirty(false);
    void window.estella.fs
      .read(path + '.meta')
      .then((t) => alive && setImporter(((JSON.parse(t).importer as Record<string, unknown>) ?? {})))
      .catch(() => alive && setImporter({}));
    return () => {
      alive = false;
    };
  }, [path]);

  // Metadata: disk stat, image dimensions, and how many assets reference this one.
  useEffect(() => {
    let alive = true;
    setStat(null);
    setDims(null);
    setRefCount(null);
    void window.estella?.fs?.stat(path).then((s) => alive && setStat(s)).catch(() => {});
    if (isImage) {
      const img = new Image();
      img.onload = () => alive && setDims(`${img.naturalWidth} × ${img.naturalHeight}`);
      img.src = `estella://project/${path}`;
    }
    // Same collector as Find Usages, but off the cached asset index (this fires
    // on every selection — a full disk walk per click just for a badge is waste);
    // fsWatch keeps the cache fresh, and the dialog itself stays authoritative.
    void findAssetUsages(path, { preferCache: true })
      .then((u) => alive && setRefCount(u.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, isImage]);

  const assetRef = ProjectStore.assetRef(path);
  const comp = importer ? buildImporterComponent(type, importer) : null;
  const write: FieldWrite = (key, _t, value) => {
    setImporter((cur) => (cur ? applyImporterEdit(cur, key, value as InspectorFieldValue) : cur));
    setDirty(true);
    DirtyRegistry.bump();
  };

  const save = async () => {
    try {
      const meta = JSON.parse(await window.estella.fs.read(path + '.meta'));
      meta.importer = importerRef.current;
      await window.estella.fs.write(path + '.meta', JSON.stringify(meta, null, 2) + '\n');
      setDirty(false);
      DirtyRegistry.bump();
      await ProjectStore.refreshAssets();
      // Push filter/wrap to the live gl handle so the edit viewport updates now
      // (no scene reload); a no-op for types/assets without a live texture.
      if (type === 'texture' || type === 'sprite') ProjectStore.applyLiveTextureSettings(path);
      Toasts.push(t('det.importSaved'), 'info', 1400);
    } catch (e) {
      Toasts.push(t('det.importSaveFailed', { error: String(e) }), 'error');
    }
  };

  // Unsaved import-settings edits join the aggregate dirty state while this
  // inspector is mounted (quit-save writes them; deselecting still discards, as
  // before). Latest-refs so the registered closures never go stale.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const importerRef = useRef(importer);
  importerRef.current = importer;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () =>
      DirtyRegistry.register({
        id: `importer:${path}`,
        isDirty: () => dirtyRef.current,
        save: () => saveRef.current(),
      }),
    [path],
  );

  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{name}</div>
          {comp && (
            <button
              type="button"
              className="primary"
              disabled={!dirty}
              onClick={() => void save()}
              title={t('det.saveImportTip')}
            >
              <Save size={13} strokeWidth={1.9} /> {t('det.save')}
            </button>
          )}
        </div>
        <div className="ent-meta">
          <span className="pill">
            <span className="pk">{t('det.type')}</span>
            {type}
          </span>
          {dirty && <span className="pill">{t('det.unsaved')}</span>}
        </div>
      </div>

      <div className="insp-body">
        {/* A compact preview for a quick visual ID — kept short so the editable
            Import Settings sit above the fold (the reason to open an asset). */}
        {type === 'audio' ? (
          <AudioWavePreview path={path} />
        ) : type === 'video' ? (
          <div className="cb-prev" style={{ height: 160 }}>
            <video
              src={`estella://project/${path}`}
              controls
              muted
              loop
              playsInline
              style={{ maxWidth: '100%', maxHeight: 160, display: 'block', margin: '0 auto' }}
            />
          </div>
        ) : (
          <div className="cb-prev" style={{ height: 108 }}>
            <div className="pv">
              {isImage ? (
                <img src={`estella://project/${path}`} alt="" draggable={false} />
              ) : (
                <AssetIcon type={type} size={44} />
              )}
            </div>
          </div>
        )}

        {/* Editable import settings first (the reason to select an asset), then
            read-only metadata. */}
        {comp ? (
          <ComponentSection
            entities={[]}
            comp={{ ...comp, label: t('det.importSettings') }}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            write={write}
          />
        ) : (
          <div className="insp-empty" style={{ padding: '14px 12px' }}>
            <div className="es">{t('det.noImportSettings')}</div>
          </div>
        )}

        <div className="cb-meta" style={{ padding: '8px 10px 0' }}>
          <MetaRow k={t('det.metaPath')} v={path} mono />
          {dims && <MetaRow k={t('det.metaDimensions')} v={dims} />}
          {stat && <MetaRow k={t('det.metaSize')} v={formatBytes(stat.size)} />}
          {stat && <MetaRow k={t('det.metaModified')} v={new Date(stat.mtimeMs).toLocaleString()} />}
          {assetRef && <MetaRow k={t('det.metaUuid')} v={assetRef} mono />}
          {refCount != null && (
            // The count opens Find Usages — the number alone answers nothing.
            <button
              type="button"
              className="cb-mr cb-mr-link"
              title={t('det.findUsagesTip')}
              onClick={() => setUsagesOpen(true)}
            >
              <span className="k">{t('det.metaReferences')}</span>
              <span className="v" style={{ fontFamily: 'inherit' }}>{refCount}</span>
            </button>
          )}
        </div>
      </div>
      {usagesOpen && <FindUsagesDialog path={path} onClose={() => setUsagesOpen(false)} />}

      <div className="cb-act">
        {type === 'scene' && (
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (await confirmDiscard(t('discard.openScene', { name: baseName(path) }))) void ProjectStore.openScene(path);
            }}
          >
            <FolderOpen size={13} strokeWidth={1.85} /> {t('det.openScene')}
          </button>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(path);
            Toasts.push(t('det.copiedPath'), 'info', 1600);
          }}
        >
          <Copy size={13} strokeWidth={1.85} /> {t('det.copyPath')}
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
            <span className="pk">{t('det.folder')}</span>
            {path}
          </span>
          <span className="pill">
            <span className="pk">{t('det.items')}</span>
            {count}
          </span>
        </div>
      </div>
      <div className="insp-empty" style={{ flex: 1 }}>
        <div className="ei">
          <FolderOpen size={22} strokeWidth={1.4} />
        </div>
        <div className="et">{count === 1 ? t('det.folderOneEntity') : t('det.folderEntities', { count })}</div>
        <div className="es">{t('det.folderHint')}</div>
      </div>
    </div>
  );
}

// A generic editor-pushed inspection source (an open timeline's clip settings,
// a track, a slice…) rendered through the same ComponentSection engine as
// entities and materials. Lives on the source's own subscribe/getRevision;
// edits route through source.write. The one shared inspector, no bespoke panel.
function SourceInspector({ source }: { source: InspectSource }) {
  useSyncExternalStore(source.subscribe, source.getRevision);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  const components = source.build();
  return (
    <div className="insp">
      <div className="ent-head">
        <div className="ent-row1">
          <div className="ent-name">{source.title}</div>
        </div>
      </div>
      <div className="insp-body">
        {components.map((comp) => (
          <ComponentSection
            key={comp.name}
            entities={[]}
            comp={comp}
            collapsed={collapsed.has(comp.name)}
            onToggle={() => toggle(comp.name)}
            write={source.write}
          />
        ))}
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
  const inspectSource = useSelection((s) => s.inspectSource);
  const selectedFolder = useOutliner((s) => s.selectedFolder);
  const conflictsByInstance = usePrefabConflicts((s) => s.byInstance);
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

  // An explicit sub-object inspection source (a keyframe, a track…) overrides the
  // entity/asset inspector; a non-override source is the fallback further below.
  if (inspectSource?.override) {
    return <SourceInspector source={inspectSource} />;
  }
  // Unified inspector: an asset selection (mutually exclusive with entities)
  // renders the asset view in this same panel.
  if (selectedAsset) {
    return <AssetInspector path={selectedAsset} />;
  }
  // A selected outliner folder (no entity/asset selected) shows the folder view.
  if (selectedFolder != null && selectedId == null) {
    return <FolderInspector path={selectedFolder} />;
  }

  // Editor-context inspection source (e.g. the open timeline's clip settings) is
  // the fallback — shown only when nothing else is selected, never overriding one.
  if (selectedId == null && inspectSource) {
    return <SourceInspector source={inspectSource} />;
  }

  if (!entity || selectedId == null) {
    return (
      <div className="insp">
        <EmptyState icon={Box} title={t('det.noSelection')} hint={t('det.noSelectionHint')} />
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
  // Stale overrides the loader dropped from THIS instance on load (keyed by root).
  const staleOverrides = prefabTag
    ? conflictsByInstance.get(prefabTag.instanceRoot) ?? []
    : [];

  return (
    <div className="insp">
      <div className="phead insp-head">
        <SearchField placeholder={t('ui.search')} value={query} onChange={setQuery} />
        <IconButton
          size="lg"
          variant="outline"
          active={filtOn}
          title={t('det.filterProps')}
          onClick={() => setFiltOn((v) => !v)}
        >
          <Filter size={14} strokeWidth={1.9} />
        </IconButton>
      </div>

      <div className="ent-head">
        <div className="ent-row1">
          {multi ? (
            <div className="ent-name ent-multi">{t('det.entitiesSelected', { count: ids.length })}</div>
          ) : (
            <input
              key={selectedId}
              className="ent-name"
              defaultValue={entity.name}
              spellCheck={false}
              onKeyDown={(e) => {
                // Match the Outliner rename: Enter commits (blur → onBlur writes),
                // Escape reverts to the current name and blurs without committing.
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') {
                  e.currentTarget.value = entity.name;
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => SceneCommands.renameEntity(selectedId, e.target.value)}
            />
          )}
        </div>
        <div className="ent-meta">
          {multi ? (
            <span className="pill">
              <span className="pk">{t('det.editing')}</span>
              {t('det.editingShared', { count: ids.length })}
            </span>
          ) : (
            <>
              <span className="pill">
                <span className="pk">{t('det.type')}</span>
                {KIND_LABEL[entity.kind]}
              </span>
              <span className="pill">
                <span className="pk">{t('det.id')}</span>
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
            <span className="pacts">
              <button
                type="button"
                title={t('det.prefabEditTip')}
                onClick={() => void ProjectStore.editPrefabOfInstance(selectedId)}
              >
                <SquarePen size={12} strokeWidth={1.9} /> {t('det.prefabEdit')}
              </button>
              <button
                type="button"
                title={t('det.prefabSelectTip')}
                onClick={() => {
                  const info = prefabRef ? ProjectStore.assetInfo(prefabRef) : null;
                  if (info) useSelection.getState().selectAsset(info.path);
                }}
              >
                <FolderOpen size={12} strokeWidth={1.9} /> {t('det.prefabSelect')}
              </button>
              <button
                type="button"
                title={t('det.prefabApplyTip')}
                onClick={() => void ProjectStore.applyPrefabInstance(selectedId)}
              >
                <Upload size={12} strokeWidth={1.9} /> {t('det.prefabApply')}
              </button>
              <button
                type="button"
                title={t('det.prefabRevertTip')}
                onClick={() => void ProjectStore.revertPrefabInstance(selectedId)}
              >
                <RotateCcw size={12} strokeWidth={1.9} /> {t('det.prefabRevert')}
              </button>
            </span>
          </div>
        )}
        {staleOverrides.length > 0 && !multi && (
          <div className="prefab-conflicts" title={staleOverrides.map((s) => s.reason).join('\n')}>
            <span className="pc-icon"><AlertTriangle size={13} strokeWidth={1.9} /></span>
            <span className="pc-text">{t('det.staleOverrides', { count: staleOverrides.length })}</span>
            <button type="button" className="pc-fix" title={t('det.staleRepairTip')} onClick={() => void ProjectStore.save()}>
              {t('det.staleRepair')}
            </button>
          </div>
        )}
      </div>

      <div className="insp-addrow">
        <button type="button" className="insp-add" title={t('det.addComponent')} onClick={() => setAddOpen(true)}>
          <Plus size={13} strokeWidth={2.4} />
          {t('det.addComponent')}
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
            action={uiNodeCanvasAction(ids, comp)}
            extra={
              comp.name === 'UINode'
                ? <UILayoutControl entities={ids} comp={comp} />
                : COMP_COLLIDER_SHAPE[comp.name]
                  ? <ColliderShapeControl entities={ids} current={comp.name} />
                  : undefined
            }
            hideFields={
              comp.name === 'UINode'
                ? uiLayoutOwnedFields(
                    Number(comp.fields.find((f) => f.key === 'position')?.value ?? 0) === UIPositionType.Absolute,
                  )
                : undefined
            }
          />
        ))}
        {query && visible.length === 0 && (
          <div className="empty-line">{t('det.noComponentsMatch', { query })}</div>
        )}
      </div>

      {compMenu && (
        <ContextMenu
          x={compMenu.x}
          y={compMenu.y}
          items={(() => {
            const comp = compMenu.comp;
            const data = SceneModel.entityBySource(ids[0])?.components.find((c) => c.type === comp)?.data as
              | Record<string, unknown>
              | undefined;
            const pasteData = InspectorClipboard.componentData(comp);
            return [
              {
                label: t('det.copyValues'),
                icon: <Copy size={13} strokeWidth={1.9} />,
                disabled: !data,
                onClick: () => {
                  if (data) InspectorClipboard.copyComponent(comp, data);
                },
              },
              {
                label: t('det.pasteValues'),
                icon: <ClipboardPaste size={13} strokeWidth={1.9} />,
                disabled: !pasteData,
                onClick: () => {
                  if (pasteData) SceneCommands.pasteComponentValuesMany(ids, comp, pasteData);
                },
              },
              {
                label: t('det.resetDefaults'),
                icon: <RotateCcw size={13} strokeWidth={1.9} />,
                onClick: () => SceneCommands.resetComponentMany(ids, comp),
              },
              { sep: true },
              {
                label: ids.length > 1 ? t('det.removeComponentN', { count: ids.length }) : t('det.removeComponent'),
                danger: true,
                icon: <Trash2 size={13} strokeWidth={1.9} />,
                onClick: () => SceneCommands.removeComponentMany(ids, comp),
              },
            ];
          })()}
          onClose={() => setCompMenu(null)}
        />
      )}
      {addOpen && modelEntity && (
        <AddComponentMenu
          // Multi-select: offer any component addable to AT LEAST ONE selected entity
          // (the union), since Add applies to every entity that lacks it. Using only
          // the primary's addable set hid components the primary already had.
          entries={multi ? unionAddableComponents(ids) : modelAddableComponentEntries(modelEntity)}
          onAdd={(name) => SceneCommands.addComponentMany(ids, name)}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
