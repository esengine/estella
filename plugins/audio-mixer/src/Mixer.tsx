// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Mixer.tsx — one strip per bus, over the project's `features.audio`.
 *
 * Every edit goes through `ctx.project.setFeature`, which persists to
 * project.esproject AND live-applies to the edit realm, so a fader is audible
 * immediately and Play boots the same mix.
 */
import { useSyncExternalStore } from 'react';
import type { PluginContext } from '@estella/editor-api';
import type { AudioProjectConfig, AudioBusDecl, BusEffectDef } from 'esengine';
import { stripsOf, patchBus, defaultEffect, freeBusName, type StripModel } from './model';
import { text, type Strings } from './strings';

const FX_KINDS: BusEffectDef['type'][] = ['filter', 'reverb', 'compressor'];
const FILTERS = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch'] as const;

/** A tiny inline glyph — a plugin brings its own rather than reaching for the
 *  editor's icon set, which is not part of any contract. */
function Glyph({ d, size = 12 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const TRASH = 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14';
const PLUS = 'M12 5v14M5 12h14';
const SOUND = 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7';
const MUTED = 'M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6';

export function Mixer({ ctx }: { ctx: PluginContext }) {
  const s = text(ctx.locale);
  // The store hands back the same object until a write replaces it, so this is a
  // stable snapshot — a fresh one per read would re-render for ever.
  const config = useSyncExternalStore(
    (cb) => {
      const d = ctx.events.on('projectChanged', cb);
      return () => d.dispose();
    },
    () => ctx.project.feature<AudioProjectConfig>('audio'),
  );
  if (ctx.project.root() === null) return <p className="mixer-empty">{s.noProject}</p>;

  const current = config ?? {};
  const strips = stripsOf(current);
  const commit = (next: AudioProjectConfig) => void ctx.project.setFeature('audio', next);

  return (
    <div className="mixer">
      {strips.map((strip) => (
        <Strip key={strip.name} strip={strip} all={strips} config={current} s={s} commit={commit} />
      ))}
      <button
        type="button"
        className="mixer-add"
        onClick={() => commit(patchBus(current, freeBusName(strips), { parent: 'master', volume: 1 }))}
      >
        <Glyph d={PLUS} size={14} /> {s.addBus}
      </button>
    </div>
  );
}

interface StripProps {
  strip: StripModel;
  all: StripModel[];
  config: AudioProjectConfig;
  s: Strings;
  commit: (next: AudioProjectConfig) => void;
}

function Strip({ strip, all, config, s, commit }: StripProps) {
  const volume = strip.volume ?? 1;
  const effects = strip.effects ?? [];
  const patch = (p: Partial<AudioBusDecl> | null) => commit(patchBus(config, strip.name, p));

  return (
    <div className="mixer-strip">
      <div className="mixer-head">
        <span className="mixer-name">{strip.name}</span>
        {!strip.builtin && (
          <button type="button" className="mixer-icon" title={s.removeBus} onClick={() => patch(null)}>
            <Glyph d={TRASH} />
          </button>
        )}
      </div>

      <div className="mixer-row">
        <input
          type="range" min={0} max={1} step={0.01} value={volume} aria-label={s.volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
        <span className="mixer-num">{Math.round(volume * 100)}</span>
        <button
          type="button"
          className={`mixer-icon${strip.muted ? ' is-on' : ''}`}
          title={s.mute}
          onClick={() => patch({ muted: !strip.muted })}
        >
          <Glyph d={strip.muted ? MUTED : SOUND} size={13} />
        </button>
      </div>

      {effects.map((fx, i) => (
        <Effect
          key={`${i}-${fx.type}`}
          fx={fx}
          s={s}
          onChange={(next) => patch({ effects: effects.map((e, j) => (j === i ? next : e)) })}
          onRemove={() => patch({ effects: effects.filter((_, j) => j !== i) })}
        />
      ))}

      <select
        className="mixer-select"
        aria-label={s.addEffect}
        value=""
        onChange={(e) => {
          if (e.target.value) patch({ effects: [...effects, defaultEffect(e.target.value as BusEffectDef['type'])] });
        }}
      >
        <option value="">{s.addEffect}</option>
        {FX_KINDS.map((k) => <option key={k} value={k}>{s.fx[k]}</option>)}
      </select>

      {strip.name !== 'master' && (
        <div className="mixer-row">
          <span className="mixer-label">{s.duckBy}</span>
          <select
            className="mixer-select"
            aria-label={s.duckBy}
            value={strip.duck?.trigger ?? ''}
            onChange={(e) => patch({
              duck: e.target.value ? { trigger: e.target.value, amount: strip.duck?.amount ?? 0.3 } : undefined,
            })}
          >
            <option value="">{s.duckNone}</option>
            {all.filter((o) => o.name !== strip.name).map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
          </select>
          {strip.duck && (
            <input
              type="range" min={0} max={1} step={0.05} value={strip.duck.amount} title={s.duckAmount}
              onChange={(e) => patch({ duck: { ...strip.duck!, amount: Number(e.target.value) } })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A number that commits on blur / Enter, so typing "12" is not read as "1". */
function Num(props: { label: string; value: number; step?: number; onCommit: (n: number) => void }) {
  return (
    <label className="mixer-num-field">
      <span>{props.label}</span>
      <input
        type="number" defaultValue={props.value} key={props.value} step={props.step ?? 1}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== props.value) props.onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}

function Effect({ fx, s, onChange, onRemove }: {
  fx: BusEffectDef; s: Strings; onChange: (fx: BusEffectDef) => void; onRemove: () => void;
}) {
  return (
    <div className="mixer-fx">
      <span className="mixer-label">{s.fx[fx.type]}</span>
      {fx.type === 'filter' && (
        <>
          <select
            className="mixer-select" aria-label={s.filterKind} value={fx.filter}
            onChange={(e) => onChange({ ...fx, filter: e.target.value as typeof FILTERS[number] })}
          >
            {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <Num label="Hz" value={fx.frequency} step={50} onCommit={(n) => onChange({ ...fx, frequency: Math.max(10, n) })} />
          <Num label="Q" value={fx.q ?? 1} step={0.1} onCommit={(n) => onChange({ ...fx, q: n })} />
        </>
      )}
      {fx.type === 'reverb' && (
        <>
          <Num label={s.seconds} value={fx.seconds ?? 1.5} step={0.1} onCommit={(n) => onChange({ ...fx, seconds: Math.max(0.05, n) })} />
          <Num label={s.wet} value={fx.wet ?? 0.35} step={0.05} onCommit={(n) => onChange({ ...fx, wet: Math.max(0, Math.min(1, n)) })} />
        </>
      )}
      {fx.type === 'compressor' && (
        <>
          <Num label="dB" value={fx.thresholdDb ?? -24} onCommit={(n) => onChange({ ...fx, thresholdDb: n })} />
          <Num label={s.ratio} value={fx.ratio ?? 4} step={0.5} onCommit={(n) => onChange({ ...fx, ratio: Math.max(1, n) })} />
        </>
      )}
      <button type="button" className="mixer-icon" title={s.removeEffect} onClick={onRemove}>
        <Glyph d={TRASH} />
      </button>
    </div>
  );
}
