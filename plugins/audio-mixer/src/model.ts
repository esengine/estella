// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  model.ts — the mixer's state, without a screen.
 *
 * Pure functions over the project's `features.audio` block, so what the strips
 * mean is testable without mounting anything.
 */
import type { AudioProjectConfig, AudioBusDecl, BusEffectDef } from 'esengine';

/** The always-present mixer tree; custom buses append after these. */
export const DEFAULT_BUSES = ['master', 'music', 'sfx', 'ui', 'voice'];

const DEFAULT_VOLUME: Record<string, number> = { master: 1, music: 0.8, sfx: 1, ui: 1, voice: 1 };

export interface StripModel extends AudioBusDecl {
  /** One of the buses the engine always has: it can be edited, never removed. */
  builtin: boolean;
}

/** Default buses merged with the project's declarations, declaration order kept. */
export function stripsOf(config: AudioProjectConfig): StripModel[] {
  const byName = new Map((config.buses ?? []).map((b) => [b.name, b]));
  const strips: StripModel[] = DEFAULT_BUSES.map((name) => ({
    name, volume: DEFAULT_VOLUME[name], ...byName.get(name), builtin: true,
  }));
  for (const b of config.buses ?? []) {
    if (!DEFAULT_BUSES.includes(b.name)) strips.push({ ...b, builtin: false });
  }
  return strips;
}

/** Replace, patch (or with `null`, remove) one bus's declaration in the config. */
export function patchBus(
  config: AudioProjectConfig,
  name: string,
  patch: Partial<AudioBusDecl> | null,
): AudioProjectConfig {
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

/** A name no strip has yet, for the Add button. */
export function freeBusName(strips: readonly StripModel[]): string {
  let name = 'bus';
  for (let n = 1; strips.some((s) => s.name === name); n++) name = `bus-${n}`;
  return name;
}

export function defaultEffect(type: BusEffectDef['type']): BusEffectDef {
  switch (type) {
    case 'filter': return { type: 'filter', filter: 'lowpass', frequency: 1200, q: 1 };
    case 'reverb': return { type: 'reverb', seconds: 1.5, wet: 0.35 };
    case 'compressor': return { type: 'compressor', thresholdDb: -24, ratio: 4 };
  }
}
