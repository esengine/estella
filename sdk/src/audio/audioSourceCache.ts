// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AudioLoadOptions } from './PlatformAudioBackend';

export interface AudioSourceKey {
    readonly url: string;
    readonly profile: string;
}

/** Group playback preparations by resolved file so a file change invalidates them together. */
export type AudioSourceMap<T extends AudioSourceKey> = Map<string, Map<string, T>>;

export function audioLoadProfile(options?: AudioLoadOptions): string {
    const mode = options?.loadType ?? 'auto';
    const trim = options?.trim;
    return trim ? `${mode}:${trim.lead}:${trim.seconds}` : mode;
}

export function addAudioSource<T extends AudioSourceKey>(sources: AudioSourceMap<T>, source: T): void {
    let profiles = sources.get(source.url);
    if (!profiles) {
        profiles = new Map();
        sources.set(source.url, profiles);
    }
    profiles.set(source.profile, source);
}

/** A late release belongs to its captured entry even if that profile has since reloaded. */
export function removeAudioSource<T extends AudioSourceKey>(sources: AudioSourceMap<T>, source: T): void {
    const profiles = sources.get(source.url);
    if (profiles?.get(source.profile) !== source) return;
    profiles.delete(source.profile);
    if (profiles.size === 0) sources.delete(source.url);
}
