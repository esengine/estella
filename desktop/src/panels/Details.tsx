import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, ChevronDown, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneCommands } from '@/engine/SceneCommands';
import { addableComponents } from '@/engine/schema';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import type { InspectorComponent, InspectorField, EntityId } from '@/types';

const AXES = ['x', 'y', 'z'];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// Each control reports gesture boundaries (onBegin/onEnd) so one focus→blur, one
// click, or one drag-scrub becomes a single undo step; onCommit applies live.
interface ControlGesture {
  onBegin?: () => void;
  onEnd?: () => void;
}

function NumField({
  value,
  suffix,
  onBegin,
  onEnd,
  onCommit,
}: ControlGesture & { value: number; suffix?: string; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // Drag-to-scrub (the UE5 numeric idiom): press + drag horizontally to nudge
  // the value; a press with no drag falls through to focusing the field to type.
  const scrub = useRef<{ x: number; base: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (editing || e.button !== 0) return;
    e.preventDefault(); // don't focus yet — let a press-without-drag focus on pointerup
    scrub.current = { x: e.clientX, base: value, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved) {
      if (Math.abs(dx) < 3) return; // movement threshold separates scrub from click
      s.moved = true;
      onBegin?.();
    }
    const step = e.shiftKey ? 0.01 : e.altKey ? 1 : 0.1; // Shift = fine, Alt = coarse
    onCommit(Math.round((s.base + dx * step) * 1000) / 1000);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const s = scrub.current;
    scrub.current = null;
    if (!s) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (s.moved) onEnd?.();
    else e.currentTarget.focus(); // a click → type
  };

  return (
    <span className="num-wrap">
      <input
        className="num num--solo num--scrub"
        value={editing ? text : fmt(value)}
        spellCheck={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
      {suffix && <span className="num__unit">{suffix}</span>}
    </span>
  );
}

function VecControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="vec">
      {value.map((n, i) => (
        <span key={i} className={`vec__axis vec__axis--${AXES[i]}`}>
          {AXES[i].toUpperCase()}
          <NumField
            value={n}
            onBegin={onBegin}
            onEnd={onEnd}
            onCommit={(v) => {
              const next = value.slice();
              next[i] = v;
              onChange(next);
            }}
          />
        </span>
      ))}
    </div>
  );
}

function BoolControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`switch${value ? ' is-on' : ''}`}
      role="switch"
      aria-checked={value}
      onClick={() => {
        onBegin?.();
        onChange(!value);
        onEnd?.();
      }}
    >
      <span className="switch__thumb" />
    </button>
  );
}

function StringControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  return (
    <input
      className="text-input"
      value={editing ? text : value}
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
  );
}

function ColorControl({
  value,
  onBegin,
  onEnd,
  onChange,
}: ControlGesture & { value: string; onChange: (v: string) => void }) {
  return (
    <span className="color">
      <input
        type="color"
        className="color__picker"
        value={value}
        onFocus={onBegin}
        onBlur={onEnd}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="color__hex mono">{value}</span>
    </span>
  );
}

function FieldRow({
  entity,
  comp,
  field,
}: {
  entity: EntityId;
  comp: string;
  field: InspectorField;
}) {
  // The gesture (focus→blur, one click, or a drag-scrub) coalesces into a single
  // undo step; SceneCommands owns the before/after capture and recording.
  const apply = (value: number | boolean | string | number[]) =>
    SceneCommands.setField(entity, comp, field.key, field.type, value as never);
  const begin = () => SceneCommands.beginGesture(`Edit ${field.label}`);
  const end = () => SceneCommands.endGesture();

  let control;
  switch (field.type) {
    case 'number':
      control = <NumField value={field.value as number} onBegin={begin} onEnd={end} onCommit={apply} />;
      break;
    case 'angle':
      control = (
        <NumField value={field.value as number} suffix="°" onBegin={begin} onEnd={end} onCommit={apply} />
      );
      break;
    case 'vec2':
    case 'vec3':
      control = (
        <VecControl value={field.value as number[]} onBegin={begin} onEnd={end} onChange={apply} />
      );
      break;
    case 'bool':
      control = (
        <BoolControl value={field.value as boolean} onBegin={begin} onEnd={end} onChange={apply} />
      );
      break;
    case 'color':
      control = (
        <ColorControl value={field.value as string} onBegin={begin} onEnd={end} onChange={apply} />
      );
      break;
    default:
      control = (
        <StringControl value={String(field.value)} onBegin={begin} onEnd={end} onChange={apply} />
      );
  }

  return (
    <label className="field">
      <span className="field__label">{field.label}</span>
      <span className="field__control">{control}</span>
    </label>
  );
}

function ComponentSection({
  entity,
  comp,
  collapsed,
  onToggle,
  onMore,
}: {
  entity: EntityId;
  comp: InspectorComponent;
  collapsed: boolean;
  onToggle: () => void;
  onMore: (e: React.MouseEvent, name: string) => void;
}) {
  return (
    <section className="cblock">
      <header className="cblock__head" onClick={onToggle}>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={`cblock__twist${collapsed ? ' is-collapsed' : ''}`}
        />
        <span className="cblock__name">{comp.label}</span>
        <button
          type="button"
          className="cblock__more"
          title="Component options"
          onClick={(e) => {
            e.stopPropagation();
            onMore(e, comp.name);
          }}
        >
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      </header>
      {!collapsed && (
        <div className="cblock__fields">
          {comp.fields.map((f) => (
            <FieldRow key={f.key} entity={entity} comp={comp.name} field={f} />
          ))}
        </div>
      )}
    </section>
  );
}

export function Details() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const revision = useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const selectedId = useEditorStore((s) => s.selectedId);
  const ready = engine.status === 'ready' && selectedId != null;

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [compMenu, setCompMenu] = useState<{ x: number; y: number; comp: string } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
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
    () => (ready ? SceneQuery.readInspector(selectedId!) : []),
    [ready, selectedId, revision],
  );

  // Inspector search: keep components whose name matches (all fields), or that
  // have any matching field (only the matches), like UE5's Details filter.
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

  if (!entity || selectedId == null) {
    return (
      <div className="panel">
        <div className="empty">
          <Box size={26} strokeWidth={1.4} />
          <p>Select an entity to inspect its components.</p>
        </div>
      </div>
    );
  }

  const world = EngineHost.world;
  const addItems: MenuItem[] =
    addMenu && world
      ? (() => {
          const list = addableComponents(world, selectedId);
          return list.length
            ? list.map((c) => ({ label: c.label, onClick: () => SceneCommands.addComponent(selectedId, c.name) }))
            : [{ label: 'All components added', onClick: () => {}, disabled: true }];
        })()
      : [];

  return (
    <div className="panel">
      <div className="inspector-head">
        <input
          key={selectedId}
          className="inspector-head__name"
          defaultValue={entity.name}
          spellCheck={false}
          onBlur={(e) => SceneCommands.renameEntity(selectedId, e.target.value)}
        />
        <span className="inspector-head__id mono">#{selectedId}</span>
      </div>

      <div className="inspector-search">
        <Search size={13} strokeWidth={1.9} />
        <input
          className="inspector-search__input"
          placeholder="Search components"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="panel__body">
        {visible.map((comp) => (
          <ComponentSection
            key={comp.name}
            entity={selectedId}
            comp={comp}
            collapsed={collapsed.has(comp.name)}
            onToggle={() => toggle(comp.name)}
            onMore={(e, name) => setCompMenu({ x: e.clientX, y: e.clientY, comp: name })}
          />
        ))}
        {query && visible.length === 0 && (
          <p className="inspector-note">No components match “{query}”.</p>
        )}

        <button
          type="button"
          className="add-component"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAddMenu({ x: r.left, y: r.bottom + 2 });
          }}
        >
          <Plus size={15} strokeWidth={2} /> Add Component
        </button>
      </div>

      {compMenu && (
        <ContextMenu
          x={compMenu.x}
          y={compMenu.y}
          items={[
            { label: 'Remove Component', onClick: () => SceneCommands.removeComponent(selectedId, compMenu.comp) },
          ]}
          onClose={() => setCompMenu(null)}
        />
      )}
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} items={addItems} onClose={() => setAddMenu(null)} />}
    </div>
  );
}
