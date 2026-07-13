// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AudioMixerPanel.tsx
 * @brief   The project mixer — one strip per bus (volume fader, mute, insert
 *          chain, duck rule) editing `project.esproject` features.audio. Every
 *          edit persists through ProjectStore.setAudio AND live-applies to the
 *          edit realm's Audio resource, so tweaks are audible immediately and
 *          Play/exports boot the same mix (the config rides the physics-config
 *          pipeline).
 */

import { useSyncExternalStore } from 'react';
import { Plus, Trash2, VolumeX, Volume2 } from 'lucide-react';
import {
  Audio, applyAudioProjectConfig,
  type AudioProjectConfig, type AudioBusDecl, type BusEffectDef,
} from 'esengine';
import { ProjectStore } from '@/project/ProjectStore';
import { EngineHost } from '@/engine/EngineHost';
import { Select } from '@/components/Select';
import { t } from '@/i18n';

/** The always-present mixer tree; custom buses append after these. */
const DEFAULT_BUSES = ['master', 'music', 'sfx', 'ui', 'voice'];
const DEFAULT_VOLUME: Record<string, number> = { master: 1, music: 0.8, sfx: 1, ui: 1, voice: 1 };

interface StripModel extends AudioBusDecl {
  builtin: boolean;
}

/** Default buses merged with the project declarations, declaration order kept. */
function stripsOf(config: AudioProjectConfig): StripModel[] {
  const byName = new Map((config.buses ?? []).map((b) => [b.name, b]));
  const strips: StripModel[] = DEFAULT_BUSES.map((name) => ({
    name, volume: DEFAULT_VOLUME[name], ...byName.get(name), builtin: true,
  }));
  for (const b of config.buses ?? []) {
    if (!DEFAULT_BUSES.includes(b.name)) strips.push({ ...b, builtin: false });
  }
  return strips;
}

/** Persist + live-apply one new config state. */
function commit(next: AudioProjectConfig): void {
  void ProjectStore.setAudio(next);
  const audio = EngineHost.getResource(Audio);
  if (audio) applyAudioProjectConfig(audio, next);
}

/** Replace/patch one bus's declaration inside the config. */
function patchBus(config: AudioProjectConfig, name: string, patch: Partial<AudioBusDecl> | null): AudioProjectConfig {
  const buses = [...(config.buses ?? [])];
  const i = buses.findIndex((b) => b.name === name);
  if (patch === null) {
    if (i >= 0) buses.splice(i, 1);
  } else if (i >= 0) {
    buses[i] = { ...buses[i], ...patch };
  } else {
    buses.push({ name, ...patch });
  }
  return { buses };
}

const FX_KINDS: Array<{ value: BusEffectDef['type']; label: () => string }> = [
  { value: 'filter', label: () => t('mix.fx.filter') },
  { value: 'reverb', label: () => t('mix.fx.reverb') },
  { value: 'compressor', label: () => t('mix.fx.compressor') },
];

function defaultEffect(type: BusEffectDef['type']): BusEffectDef {
  switch (type) {
    case 'filter': return { type: 'filter', filter: 'lowpass', frequency: 1200, q: 1 };
    case 'reverb': return { type: 'reverb', seconds: 1.5, wet: 0.35 };
    case 'compressor': return { type: 'compressor', thresholdDb: -24, ratio: 4 };
  }
}

function NumCell(props: { label: string; value: number; step?: number; onCommit: (n: number) => void }) {
  return (
    <label className="mix-num">
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

function EffectRow(props: { fx: BusEffectDef; onChange: (fx: BusEffectDef) => void; onRemove: () => void }) {
  const { fx, onChange, onRemove } = props;
  return (
    <div className="mix-fx">
      <span className="mix-fx-kind">{FX_KINDS.find((k) => k.value === fx.type)?.label()}</span>
      {fx.type === 'filter' && (
        <>
          <Select
            ariaLabel={t('mix.fx.filterKind')}
            value={fx.filter}
            options={(['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch'] as const)
              .map((v) => ({ value: v, label: v }))}
            onChange={(v) => onChange({ ...fx, filter: v })}
          />
          <NumCell label="Hz" value={fx.frequency} step={50} onCommit={(n) => onChange({ ...fx, frequency: Math.max(10, n) })} />
          <NumCell label="Q" value={fx.q ?? 1} step={0.1} onCommit={(n) => onChange({ ...fx, q: n })} />
        </>
      )}
      {fx.type === 'reverb' && (
        <>
          <NumCell label={t('mix.fx.seconds')} value={fx.seconds ?? 1.5} step={0.1} onCommit={(n) => onChange({ ...fx, seconds: Math.max(0.05, n) })} />
          <NumCell label={t('mix.fx.wet')} value={fx.wet ?? 0.35} step={0.05} onCommit={(n) => onChange({ ...fx, wet: Math.max(0, Math.min(1, n)) })} />
        </>
      )}
      {fx.type === 'compressor' && (
        <>
          <NumCell label="dB" value={fx.thresholdDb ?? -24} onCommit={(n) => onChange({ ...fx, thresholdDb: n })} />
          <NumCell label={t('mix.fx.ratio')} value={fx.ratio ?? 4} step={0.5} onCommit={(n) => onChange({ ...fx, ratio: Math.max(1, n) })} />
        </>
      )}
      <button type="button" className="mix-rm" title={t('mix.fx.remove')} onClick={onRemove}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function BusStrip(props: { strip: StripModel; all: StripModel[]; config: AudioProjectConfig }) {
  const { strip, all, config } = props;
  const volume = strip.volume ?? 1;
  const patch = (p: Partial<AudioBusDecl> | null) => commit(patchBus(config, strip.name, p));
  const effects = strip.effects ?? [];
  const duckTargets = all.filter((s) => s.name !== strip.name).map((s) => s.name);

  return (
    <div className="mix-strip">
      <div className="mix-head">
        <span className="mix-name">{strip.name}</span>
        {!strip.builtin && (
          <button type="button" className="mix-rm" title={t('mix.removeBus')} onClick={() => patch(null)}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div className="mix-vol">
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          className="mix-fader"
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
        <span className="mix-vol-num">{Math.round(volume * 100)}</span>
        <button
          type="button"
          className={'mix-mute' + (strip.muted ? ' is-on' : '')}
          title={t('mix.mute')}
          onClick={() => patch({ muted: !strip.muted })}
        >
          {strip.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      </div>

      <div className="mix-fxs">
        {effects.map((fx, i) => (
          <EffectRow
            key={`${i}-${fx.type}`}
            fx={fx}
            onChange={(nf) => patch({ effects: effects.map((e, j) => (j === i ? nf : e)) })}
            onRemove={() => patch({ effects: effects.filter((_, j) => j !== i) })}
          />
        ))}
        <Select
          ariaLabel={t('mix.fx.add')}
          value={'' as string}
          options={[
            { value: '', label: t('mix.fx.add') },
            ...FX_KINDS.map((k) => ({ value: k.value as string, label: k.label() })),
          ]}
          onChange={(v) => { if (v) patch({ effects: [...effects, defaultEffect(v as BusEffectDef['type'])] }); }}
        />
      </div>

      {strip.name !== 'master' && (
        <div className="mix-duck">
          <span className="mix-lbl">{t('mix.duckBy')}</span>
          <Select
            ariaLabel={t('mix.duckBy')}
            value={strip.duck?.trigger ?? ''}
            options={[{ value: '', label: t('mix.duckNone') }, ...duckTargets.map((n) => ({ value: n, label: n }))]}
            onChange={(v) => patch({ duck: v ? { trigger: v, amount: strip.duck?.amount ?? 0.3 } : undefined })}
          />
          {strip.duck && (
            <input
              type="range" min={0} max={1} step={0.05} value={strip.duck.amount}
              className="mix-duck-amt" title={t('mix.duckAmount')}
              onChange={(e) => patch({ duck: { ...strip.duck!, amount: Number(e.target.value) } })}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function AudioMixerPanel() {
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  if (!project) {
    return <div className="mix-empty">{t('mix.noProject')}</div>;
  }
  const config = ProjectStore.audioFeature();
  const strips = stripsOf(config);

  const addBus = () => {
    let n = 1;
    let name = 'bus';
    while (strips.some((s) => s.name === name)) name = `bus-${n++}`;
    commit(patchBus(config, name, { parent: 'master', volume: 1 }));
  };

  return (
    <div className="mix-panel">
      <div className="mix-strips">
        {strips.map((s) => (
          <BusStrip key={s.name} strip={s} all={strips} config={config} />
        ))}
        <button type="button" className="mix-add" title={t('mix.addBus')} onClick={addBus}>
          <Plus size={14} /> {t('mix.addBus')}
        </button>
      </div>
    </div>
  );
}
