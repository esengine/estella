// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Box,
  Camera,
  Check,
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
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery, buildEntityInfo, buildInspector } from '@/engine/SceneQuery';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands, toModelValue } from '@/engine/SceneCommands';
import { PlayInspect } from '@/engine/PlayInspect';
import type { SceneData } from 'esengine';
import { modelAddableComponentEntries, subscribeSchemas, getSchemaRevision, prettyLabel } from '@/engine/schema';
import { ProjectStore } from '@/project/ProjectStore';
import { ContextMenu } from '@/components/Menu';
import { AddComponentMenu } from '@/components/AddComponentMenu';
import type { InspectorComponent, InspectorField, InspectorFieldValue, EntityId, NodeKind, EnumOption } from '@/types';

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

// A named-int dropdown (e.g. Camera projection, body type). The stored value is
// the option's int; an out-of-range value keeps a synthetic row so the select
// never silently misrepresents the model.
function EnumControl({
  value,
  options,
  mixed,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number; options: EnumOption[]; mixed?: boolean; onChange: (v: number) => void }) {
  const known = options.some((o) => o.value === value);
  return (
    <span className="field">
      <select
        value={mixed ? '' : String(value)}
        onChange={(e) => {
          onBegin?.();
          onChange(Number(e.target.value));
          onEnd?.();
        }}
      >
        {mixed && <option value="">—</option>}
        {!mixed && !known && <option value={String(value)}>{`(${value})`}</option>}
        {options.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {prettyLabel(o.label)}
          </option>
        ))}
      </select>
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

function ColorControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <label className="sw" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onFocus={onBegin}
          onBlur={onEnd}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        />
      </label>
      <span className="field">
        <input
          value={value}
          spellCheck={false}
          onFocus={onBegin}
          onBlur={onEnd}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </>
  );
}

// An asset-ref field: a drop target showing the bound asset (thumbnail + name).
// The trailing button clears when bound (×), or reads as the pick affordance.
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
  const info = ProjectStore.assetInfo(value);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const path = e.dataTransfer.getData('application/x-estella-asset') || e.dataTransfer.getData('text/plain');
    if (!path) return;
    onBegin?.();
    void ProjectStore.assetRefForPath(path, assetType).then((ref) => {
      if (ref) onChange(ref);
      onEnd?.();
    });
  };

  return (
    <div
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
      <button
        type="button"
        className="pk"
        title={info ? 'Clear' : 'Pick'}
        onClick={() => {
          if (!info) return;
          onBegin?.();
          onChange(0);
          onEnd?.();
        }}
      >
        {info ? <X size={11} strokeWidth={2} /> : <Search size={11} strokeWidth={2} />}
      </button>
    </div>
  );
}

// A field write override (the live "Game" inspector routes edits to the realm
// instead of the undoable SceneCommands path). When set, gestures are no-ops.
type FieldWrite = (key: string, type: InspectorField['type'], value: number | boolean | string | number[]) => void;

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
  const apply = (value: number | boolean | string | number[]) => {
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
    case 'color':
      control = <ColorControl value={field.value as string} onBegin={begin} onEnd={end} onChange={apply} />;
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
  const [advOpen, setAdvOpen] = useState(false);
  const primary = comp.fields.filter((f) => !f.advanced);
  const advanced = comp.fields.filter((f) => f.advanced);
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
            {primary.map((f) => (
              <FieldRow key={f.key} entities={entities} comp={comp.name} field={f} write={write} />
            ))}
            {advanced.length > 0 && (
              <>
                <div className={`subfold${advOpen ? ' open' : ''}`} onClick={() => setAdvOpen((o) => !o)}>
                  <ChevronRight size={9} strokeWidth={3} />
                  Advanced
                </div>
                <div className="subbody">
                  <div>
                    {advanced.map((f) => (
                      <FieldRow key={f.key} entities={entities} comp={comp.name} field={f} write={write} />
                    ))}
                  </div>
                </div>
              </>
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
  const ready = engine.status === 'ready' && selectedId != null;

  // Selection targets, primary (the active id) first. Edits fan out across all.
  const ids = useMemo(
    () => (selectedId == null ? [] : [selectedId, ...[...selectedIds].filter((i) => i !== selectedId)]),
    [selectedId, selectedIds],
  );
  const multi = ids.length > 1;
  // Apply a structural command to every selected entity. Field edits coalesce into
  // one undo step via the gesture; add/remove component record per entity.
  const fanOut = (action: (id: EntityId) => void) => ids.forEach(action);

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
              onClick: () => fanOut((id) => SceneCommands.removeComponent(id, compMenu.comp)),
            },
          ]}
          onClose={() => setCompMenu(null)}
        />
      )}
      {addOpen && modelEntity && (
        <AddComponentMenu
          entries={modelAddableComponentEntries(modelEntity)}
          onAdd={(name) => fanOut((id) => SceneCommands.addComponent(id, name))}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
