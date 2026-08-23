// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AudioProjectConfig.ts
 * @brief   Project-declared mixer state (project.esproject `features.audio`):
 *          bus volumes, custom buses, insert chains, duck rules. The runtime
 *          applies it at boot; the editor Mixer edits the same shape. On
 *          backends without a WebAudio graph every step degrades to a no-op
 *          through the AudioAPI guards.
 */

import type { AudioAPI } from './Audio';
import type { BusDuckRule } from './AudioMixer';
import { parseBusEffects, type BusEffectDef } from './BusEffects';

export interface AudioBusDecl {
    name: string;
    /** Parent bus for buses beyond the default five (default parent: master). */
    parent?: string;
    volume?: number;
    muted?: boolean;
    effects?: BusEffectDef[];
    duck?: BusDuckRule;
}

export interface AudioProjectConfig {
    buses?: AudioBusDecl[];
    /** How many voices may sound at once before `priority` decides which is
     *  dropped. 0 or less means no cap. */
    maxVoices?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Normalize arbitrary JSON into a valid config (tolerant; drops junk). */
export function parseAudioProjectConfig(raw: unknown): AudioProjectConfig {
    const buses: AudioBusDecl[] = [];
    const rawBuses = (raw as { buses?: unknown } | undefined)?.buses;
    for (const b of Array.isArray(rawBuses) ? rawBuses : []) {
        if (!b || typeof b !== 'object' || typeof b.name !== 'string' || !b.name) continue;
        const decl: AudioBusDecl = { name: b.name };
        if (typeof b.parent === 'string' && b.parent) decl.parent = b.parent;
        if (typeof b.volume === 'number' && Number.isFinite(b.volume)) decl.volume = clamp01(b.volume);
        if (typeof b.muted === 'boolean') decl.muted = b.muted;
        const effects = parseBusEffects(b.effects);
        if (effects.length > 0) decl.effects = effects;
        const d = b.duck as BusDuckRule | undefined;
        if (d && typeof d === 'object' && typeof d.trigger === 'string' && d.trigger
            && typeof d.amount === 'number' && Number.isFinite(d.amount)) {
            decl.duck = {
                trigger: d.trigger,
                amount: clamp01(d.amount),
                ...(typeof d.attack === 'number' ? { attack: d.attack } : {}),
                ...(typeof d.release === 'number' ? { release: d.release } : {}),
                ...(typeof d.threshold === 'number' ? { threshold: d.threshold } : {}),
            };
        }
        buses.push(decl);
    }
    const config: AudioProjectConfig = buses.length > 0 ? { buses } : {};
    const maxVoices = (raw as { maxVoices?: unknown } | undefined)?.maxVoices;
    if (typeof maxVoices === 'number' && Number.isFinite(maxVoices)) {
        config.maxVoices = Math.floor(maxVoices);
    }
    return config;
}

/**
 * Apply the declared mixer state: create missing buses, then set volume /
 * mute / effects / duck per declaration. Full-state semantics — a declared
 * bus with no `duck` clears any prior rule, so the editor can re-apply live.
 */
export function applyAudioProjectConfig(audio: AudioAPI, config: AudioProjectConfig | undefined): void {
    // Before the buses: the cap is the API's own and applies on every backend,
    // while the loop below returns early where there is no mixer graph.
    if (config?.maxVoices !== undefined) audio.setMaxVoices(config.maxVoices);
    for (const bus of config?.buses ?? []) {
        if (!audio.ensureBus(bus.name, bus.parent)) return; // no mixer: nothing applies
        if (bus.volume !== undefined) audio.setBusVolume(bus.name, bus.volume);
        if (bus.muted !== undefined) audio.muteBus(bus.name, bus.muted);
        audio.setBusEffects(bus.name, bus.effects ?? []);
        audio.setBusDucking(bus.name, bus.duck ?? null);
    }
}
