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
import { Settings as SettingsIcon, X, RotateCcw } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useSettings } from '@/store/settingsStore';
import { settingsRegistry } from '@/settings/registry';
import { eventToChord, formatKeybinding } from '@/commands/keybinding';
import { commands } from '@/commands';
import { Toasts } from '@/store/Toasts';
import { useDialogFocus } from '@/components/dialogFocus';
import { IconButton } from '@/components/IconButton';
import { SearchField } from '@/components/SearchField';
import { Segmented } from '@/components/Segmented';
import { Select } from '@/components/Select';
import { ColorControl } from '@/components/ColorControl';
import type { Setting, NumberSetting, KeybindingSetting, StringListSetting, MatrixSetting, FlagListSetting } from '@/settings/types';
import { t } from '@/i18n';

// A bound list setting's getter returns a fresh array each call; useShallow below
// keeps the read referentially stable (else useSyncExternalStore loops). A shared
// empty fallback avoids a fresh `[]` when a value is unset.
const EMPTY_LIST: readonly string[] = [];

const CATEGORY_LABEL: Record<string, string> = {
  editor: t('set.cat.editor'),
  project: t('set.cat.project'),
  plugin: t('set.cat.plugin'),
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
  // An absent max means unbounded for the numeric field (a design width is not a
  // percentage); only the slider needs a finite range, so it falls back to 100.
  const { min = 0, max = Infinity, step = 1, slider, suffix } = setting;
  return (
    <>
      {slider && (
        <Slider value={value} min={min} max={Number.isFinite(max) ? max : 100} step={step} onChange={(v) => setValue(setting.id, v)} />
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
      const chord = eventToChord(e);
      setValue(setting.id, chord);
      setCapturing(false);
      // Warn (don't block) if the chord already drives another command — some
      // overlaps are intentional (context-gated keys), but a SILENT shadow is the
      // real bug, so name the clash and let the user decide.
      const clash = commands.conflictsFor(chord, setting.commandId);
      if (clash.length) {
        Toasts.push(
          t('set.rebindConflict', { keys: formatKeybinding(chord), cmd: commands.get(clash[0])?.label ?? clash[0] }),
          'warn',
        );
      }
    };
    // Capture phase + stopPropagation so neither commands nor the dialog Esc fire.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setting.id, setValue]);
  return (
    <button
      type="button"
      className={`set-key${capturing ? ' capturing' : ''}`}
      title={t('set.rebindHint')}
      onClick={() => setCapturing((c) => !c)}
    >
      {capturing ? t('set.pressKeys') : formatKeybinding(chord) || t('set.unbound')}
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

const EMPTY_MASKS: readonly number[] = [];

function MatrixControl({ setting }: { setting: MatrixSetting }) {
  const setValue = useSettings((s) => s.setValue);
  const value = useSettings(useShallow((s) => s.getValue<number[]>(setting.id) ?? (EMPTY_MASKS as number[])));
  const labels = setting.labels();
  const masks = Array.from({ length: setting.count }, (_, i) => value[i] ?? 0xffff);
  // Show layer 0 (Default) + any named layer — the matrix stays readable.
  const shown = Array.from({ length: setting.count }, (_, i) => i).filter((i) => i === 0 || (labels[i] ?? '') !== '');
  const collides = (i: number, j: number) => ((masks[i] >> j) & 1) === 1;
  const toggle = (i: number, j: number) => {
    const on = !collides(i, j);
    const setBit = (m: number, b: number) => (on ? m | (1 << b) : m & ~(1 << b)) & 0xffff;
    const next = masks.slice();
    next[i] = setBit(next[i], j);
    next[j] = setBit(next[j], i); // keep the matrix symmetric
    setValue(setting.id, next);
  };
  return (
    <table className="set-matrix">
      <thead>
        <tr>
          <th />
          {shown.map((j) => <th key={j} className="set-matrix-col"><span>{labels[j] || t('set.layerN', { i: j })}</span></th>)}
        </tr>
      </thead>
      <tbody>
        {shown.map((i) => (
          <tr key={i}>
            <th className="set-matrix-row">{labels[i] || t('set.layerN', { i })}</th>
            {shown.map((j) => (
              <td key={j}>
                <input type="checkbox" checked={collides(i, j)} onChange={() => toggle(i, j)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlagListControl({ setting }: { setting: FlagListSetting }) {
  const setValue = useSettings((s) => s.setValue);
  const value = useSettings(useShallow((s) => s.getValue<number[]>(setting.id) ?? (EMPTY_MASKS as number[])));
  const labels = setting.labels();
  const shown = Array.from({ length: setting.count }, (_, i) => i).filter((i) => i === 0 || (labels[i] ?? '') !== '');
  const isOn = (i: number) => value.includes(i);
  const toggle = (i: number) => {
    const next = isOn(i) ? value.filter((v) => v !== i) : [...value, i].sort((a, b) => a - b);
    setValue(setting.id, next);
  };
  return (
    <div className="set-flaglist">
      {shown.map((i) => (
        <label key={i} className="set-flaglist-item">
          <input type="checkbox" checked={isOn(i)} onChange={() => toggle(i)} />
          <span>{labels[i] || t('set.layerN', { i })}</span>
        </label>
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
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              setValue(setting.id, !value);
            }
          }}
        />
      );
    case 'enum': {
      const options = setting.options.map((o) => ({ value: o.value, label: o.label }));
      if (setting.segmented) {
        return (
          <Segmented
            value={String(value)}
            onChange={(v) => setValue(setting.id, v)}
            ariaLabel={setting.label}
            options={options}
          />
        );
      }
      return (
        <Select
          ariaLabel={setting.label}
          value={String(value)}
          options={options}
          onChange={(v) => setValue(setting.id, v)}
        />
      );
    }
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
    case 'colorpicker': {
      const hex = String(value ?? '');
      return (
        <div className={`set-colorpicker${hex ? '' : ' inherited'}`}>
          <ColorControl
            value={hex || setting.placeholderColor?.() || '#00000000'}
            onChange={(v) => setValue(setting.id, v)}
          />
          {!hex && <span className="set-inherit">{t('set.inherited')}</span>}
        </div>
      );
    }
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
    case 'matrix':
      return <MatrixControl setting={setting} />;
    case 'flagList':
      return <FlagListControl setting={setting} />;
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
        title={t('set.resetDefault')}
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
  const winRef = useRef<HTMLDivElement>(null);
  useDialogFocus(winRef);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const sections = settingsRegistry.allSections();
  // Open on the requested section (e.g. Help → Keyboard Shortcuts), else the first.
  const [active, setActive] = useState(() => {
    const want = useEditorStore.getState().settingsSection;
    return (want && sections.some((s) => s.id === want) ? want : sections[0]?.id) ?? '';
  });

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
      <div
        ref={winRef}
        className="set-win"
        role="dialog"
        aria-modal="true"
        aria-label={t('set.title')}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-head">
          <span className="set-title">
            <span className="ic"><SettingsIcon size={16} strokeWidth={1.8} /></span>
            {t('set.title')}
          </span>
          <span className="set-head-sp" />
          <SearchField className="set-search" iconSize={12} autoFocus placeholder={t('set.search')} value={query} onChange={setQuery} />
          <IconButton size="lg" title={t('set.closeEsc')} onClick={close}>
            <X size={14} strokeWidth={2} />
          </IconButton>
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
              <div className="empty-line">{t('set.noMatch', { query })}</div>
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
