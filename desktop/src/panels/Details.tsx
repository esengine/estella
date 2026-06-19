import { useMemo, useState, useSyncExternalStore } from 'react';
import { Box, ChevronDown, MoreHorizontal, Plus } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { EngineHost } from '@/engine/EngineHost';
import { SceneStore } from '@/engine/SceneStore';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneCommands } from '@/engine/SceneCommands';
import type { InspectorComponent, InspectorField, EntityId } from '@/types';

const AXES = ['x', 'y', 'z'];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

// Each control reports gesture boundaries (onBegin/onEnd) so one focus→blur or
// one click becomes a single undo step; onCommit applies the value live.
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
  return (
    <span className="num-wrap">
      <input
        className="num num--solo"
        value={editing ? text : fmt(value)}
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
  // The gesture (focus→blur, or one click) coalesces into a single undo step;
  // SceneCommands owns the before/after capture and recording.
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

function ComponentSection({ entity, comp }: { entity: EntityId; comp: InspectorComponent }) {
  return (
    <section className="cblock">
      <header className="cblock__head">
        <ChevronDown size={13} strokeWidth={2} className="cblock__twist" />
        <input
          type="checkbox"
          className="cblock__enable"
          defaultChecked
          onClick={(e) => e.stopPropagation()}
        />
        <span className="cblock__name">{comp.label}</span>
        <button type="button" className="cblock__more" title="Component options">
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      </header>
      <div className="cblock__fields">
        {comp.fields.map((f) => (
          <FieldRow key={f.key} entity={entity} comp={comp.name} field={f} />
        ))}
      </div>
    </section>
  );
}

export function Details() {
  const engine = useSyncExternalStore(EngineHost.subscribe, EngineHost.getSnapshot);
  const revision = useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const selectedId = useEditorStore((s) => s.selectedId);
  const ready = engine.status === 'ready' && selectedId != null;

  const entity = useMemo(
    () => (ready ? SceneQuery.readEntity(selectedId!) : null),
    [ready, selectedId, revision],
  );
  const components = useMemo(
    () => (ready ? SceneQuery.readInspector(selectedId!) : []),
    [ready, selectedId, revision],
  );

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

      <div className="panel__body">
        {components.map((comp) => (
          <ComponentSection key={comp.name} entity={selectedId} comp={comp} />
        ))}

        <button type="button" className="add-component">
          <Plus size={15} strokeWidth={2} /> Add Component
        </button>
      </div>
    </div>
  );
}
