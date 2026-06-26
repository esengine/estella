// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SettingsDialog.tsx — the settings window (the design's `.set-*`), driven
 *        entirely by the settings registry + store. The dialog knows nothing about
 *        individual settings: it renders nav from registered sections and rows from
 *        registered descriptors, picking a control by `type`. Search filters across
 *        sections; a reset arrow shows when a value differs from its default.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Settings as SettingsIcon, Search, X, RotateCcw } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSettings } from '@/store/settingsStore';
import { settingsRegistry } from '@/settings/registry';
import { eventToChord, formatKeybinding } from '@/commands/keybinding';
import type { Setting, NumberSetting, KeybindingSetting, StringListSetting } from '@/settings/types';

// A bound list setting's getter returns a fresh array each call; useShallow below
// keeps the read referentially stable (else useSyncExternalStore loops). A shared
// empty fallback avoids a fresh `[]` when a value is unset.
const EMPTY_LIST: readonly string[] = [];

const CATEGORY_LABEL: Record<string, string> = {
  editor: 'Editor',
  project: 'Project',
  plugin: 'Plugins',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function Slider({
  value, min, max, step, onChange,
}: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const pct = max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0;
  const fromClient = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = clamp((clientX - r.left) / r.width, 0, 1);
    const raw = min + t * (max - min);
    onChange(clamp(Math.round(raw / step) * step, min, max));
  };
  return (
    <span
      ref={ref}
      className="slider set-slider"
      onPointerDown={(e: ReactPointerEvent) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        fromClient(e.clientX);
      }}
      onPointerMove={(e: ReactPointerEvent) => {
        if (e.buttons & 1) fromClient(e.clientX);
      }}
    >
      <span className="fill" style={{ width: `${pct}%` }} />
      <span className="thumb" style={{ left: `${pct}%` }} />
    </span>
  );
}

function NumberControl({ setting }: { setting: NumberSetting }) {
  const setValue = useSettings((s) => s.setValue);
  const value = Number(useSettings((s) => s.getValue<number>(setting.id)));
  const { min = 0, max = 100, step = 1, slider, suffix } = setting;
  return (
    <>
      {slider && (
        <Slider value={value} min={min} max={max} step={step} onChange={(v) => setValue(setting.id, v)} />
      )}
      <input
        className="set-num"
        defaultValue={`${value}${suffix ?? ''}`}
        key={value}
        onBlur={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) setValue(setting.id, clamp(n, min, max));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </>
  );
}

// Click to capture the next chord (Esc cancels). Bound to the command registry,
// so the new binding persists and takes effect immediately.
function KeybindCapture({ setting }: { setting: KeybindingSetting }) {
  const setValue = useSettings((s) => s.setValue);
  const chord = useSettings((s) => s.getValue<string>(setting.id));
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // wait for the real key
      setValue(setting.id, eventToChord(e));
      setCapturing(false);
    };
    // Capture phase + stopPropagation so neither commands nor the dialog Esc fire.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setting.id, setValue]);
  return (
    <button
      type="button"
      className={`set-key${capturing ? ' capturing' : ''}`}
      title="Click to rebind"
      onClick={() => setCapturing((c) => !c)}
    >
      {capturing ? 'Press keys…' : formatKeybinding(chord) || 'Unbound'}
    </button>
  );
}

function StringListControl({ setting }: { setting: StringListSetting }) {
  const setValue = useSettings((s) => s.setValue);
  const value = useSettings(useShallow((s) => s.getValue<string[]>(setting.id) ?? (EMPTY_LIST as string[])));
  return (
    <div className="set-list">
      {Array.from({ length: setting.count }, (_, i) => (
        <input
          key={i}
          className="set-list-item"
          value={value[i] ?? ''}
          placeholder={setting.placeholder?.(i) ?? String(i)}
          spellCheck={false}
          onChange={(e) => {
            const next = Array.from({ length: setting.count }, (_, j) => value[j] ?? '');
            next[i] = e.target.value;
            setValue(setting.id, next);
          }}
        />
      ))}
    </div>
  );
}

function Control({ setting }: { setting: Setting }) {
  const setValue = useSettings((s) => s.setValue);
  // useShallow: a bound list setting returns a fresh array each read, which would
  // otherwise make this snapshot change every render and loop.
  const value = useSettings(useShallow((s) => s.getValue(setting.id)));
  switch (setting.type) {
    case 'boolean':
      return (
        <span
          className={`toggle${value ? ' on' : ''}`}
          role="switch"
          aria-checked={Boolean(value)}
          tabIndex={0}
          onClick={() => setValue(setting.id, !value)}
        />
      );
    case 'enum':
      if (setting.segmented) {
        return (
          <div className="set-seg">
            {setting.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={value === o.value ? 'on' : ''}
                onClick={() => setValue(setting.id, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      return (
        <select className="set-sel" value={String(value)} onChange={(e) => setValue(setting.id, e.target.value)}>
          {setting.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'number':
      return <NumberControl setting={setting} />;
    case 'color':
      return (
        <div className="set-swatches">
          {setting.swatches.map((c) => (
            <span
              key={c}
              className={`set-swatch${value === c ? ' on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => setValue(setting.id, c)}
            />
          ))}
        </div>
      );
    case 'keybinding':
      return <KeybindCapture setting={setting} />;
    case 'string':
      return (
        <input
          className="set-str"
          value={String(value ?? '')}
          placeholder={setting.placeholder ?? ''}
          spellCheck={false}
          onChange={(e) => setValue(setting.id, e.target.value)}
        />
      );
    case 'stringList':
      return <StringListControl setting={setting} />;
  }
}

function Row({ setting }: { setting: Setting }) {
  const isChanged = useSettings((s) => s.isChanged(setting.id));
  const reset = useSettings((s) => s.reset);
  return (
    <div className={`set-row${isChanged ? ' changed' : ''}`}>
      <div>
        <div className="sn">{setting.label}</div>
        {setting.description && <div className="sd">{setting.description}</div>}
      </div>
      <div className="set-ctrl">
        <Control setting={setting} />
      </div>
      <span
        className={`set-reset${isChanged ? ' show' : ''}`}
        title="Reset to default"
        onClick={() => isChanged && reset(setting.id)}
      >
        {isChanged && <RotateCcw size={11} strokeWidth={2} />}
      </span>
    </div>
  );
}

// A content group: a header + its rows.
function Group({ label, settings }: { label: string; settings: Setting[] }) {
  return (
    <>
      <div className="set-group">{label}</div>
      {settings.map((s) => (
        <Row key={s.id} setting={s} />
      ))}
    </>
  );
}

export function SettingsDialog() {
  const close = () => useEditorStore.getState().setSettingsOpen(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const sections = settingsRegistry.allSections();
  const [active, setActive] = useState(() => sections[0]?.id ?? '');

  // Subscribe so rows reflect live changes of bound (editorStore) settings too.
  useEditorStore((s) => `${s.showGrid}|${s.showGizmos}|${s.snapping}|${s.snapStep}`);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (s: Setting) =>
    !q ||
    s.label.toLowerCase().includes(q) ||
    (s.description?.toLowerCase().includes(q) ?? false) ||
    s.id.toLowerCase().includes(q);

  // When searching, show matching rows across all sections (grouped by section);
  // otherwise show the active section grouped by each setting's `group`.
  const content = q
    ? sections
        .map((sec) => ({ label: sec.label, settings: settingsRegistry.settingsForSection(sec.id).filter(matches) }))
        .filter((g) => g.settings.length > 0)
    : groupByGroup(settingsRegistry.settingsForSection(active));

  return createPortal(
    <div className={`set-scrim${open ? ' open' : ''}`} onMouseDown={close}>
      <div className="set-win" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-head">
          <span className="set-title">
            <span className="ic"><SettingsIcon size={16} strokeWidth={1.8} /></span>
            Settings
          </span>
          <span className="set-head-sp" />
          <label className="set-search">
            <Search size={12} strokeWidth={2} />
            <input
              placeholder="Search settings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </label>
          <button type="button" className="set-x" title="Close (Esc)" onClick={close}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="set-body">
          <nav className="set-nav">
            {settingsRegistry.sectionsByCategory().map((cat) => (
              <div key={cat.category}>
                <div className="set-nav-sec">{CATEGORY_LABEL[cat.category] ?? cat.category}</div>
                {cat.sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    className={`set-nav-item${!q && sec.id === active ? ' active' : ''}`}
                    onClick={() => {
                      setQuery('');
                      setActive(sec.id);
                    }}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="set-content">
            {content.length === 0 ? (
              <div className="set-empty">No settings match “{query}”.</div>
            ) : (
              content.map((g) => <Group key={g.label} label={g.label} settings={g.settings} />)
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Group a section's settings by their `group` field, preserving first-seen order.
function groupByGroup(settings: Setting[]): { label: string; settings: Setting[] }[] {
  const order: string[] = [];
  const map = new Map<string, Setting[]>();
  for (const s of settings) {
    const g = s.group ?? '';
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(s);
  }
  return order.map((label) => ({ label, settings: map.get(label)! }));
}
