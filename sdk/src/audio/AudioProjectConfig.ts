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
import type { AudioLoadType } from './PlatformAudioBackend';

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
    /**
     * Clips whose import settings ask for something other than `auto`, by project-relative path:
     * `streaming` plays one from its compressed file, `decompress` decodes it at load. Written by the
     * editor and the exporter from the assets' import settings, never by hand in the project file.
     */
    loadTypes?: Record<string, Exclude<AudioLoadType, 'auto'>>;
    /**
     * Clips the exporter re-encoded, by project-relative path: how long each really is and the silence the encoding
     * put before it, in seconds. Written by the exporter only; a project played from its own files has none.
     */
    encoded?: Record<string, { seconds: number; lead: number }>;
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
    const rawTypes = (raw as { loadTypes?: unknown } | undefined)?.loadTypes;
    if (rawTypes && typeof rawTypes === 'object') {
        const loadTypes: Record<string, 'streaming' | 'decompress'> = {};
        for (const [path, type] of Object.entries(rawTypes)) {
            if (path && (type === 'streaming' || type === 'decompress')) loadTypes[path] = type;
        }
        if (Object.keys(loadTypes).length > 0) config.loadTypes = loadTypes;
    }
    const rawEncoded = (raw as { encoded?: unknown } | undefined)?.encoded;
    if (rawEncoded && typeof rawEncoded === 'object') {
        const encoded: Record<string, { seconds: number; lead: number }> = {};
        for (const [path, value] of Object.entries(rawEncoded)) {
            const v = value as { seconds?: unknown; lead?: unknown } | null;
            if (path && v && typeof v.seconds === 'number' && v.seconds > 0 && typeof v.lead === 'number' && v.lead >= 0 && v.lead < 1) encoded[path] = { seconds: v.seconds, lead: v.lead };
        }
        if (Object.keys(encoded).length > 0) config.encoded = encoded;
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
    if (config?.loadTypes !== undefined) audio.setLoadTypes(config.loadTypes);
    if (config?.encoded !== undefined) audio.setEncodedClips(config.encoded);
    for (const bus of config?.buses ?? []) {
        if (!audio.ensureBus(bus.name, bus.parent)) return; // no mixer: nothing applies
        if (bus.volume !== undefined) audio.setBusVolume(bus.name, bus.volume);
        if (bus.muted !== undefined) audio.muteBus(bus.name, bus.muted);
        audio.setBusEffects(bus.name, bus.effects ?? []);
        audio.setBusDucking(bus.name, bus.duck ?? null);
    }
}
