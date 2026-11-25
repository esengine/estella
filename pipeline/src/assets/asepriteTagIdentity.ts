// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AnimClipAssetData } from 'esengine';
import type { AsepriteTag } from './asepriteFile';
import type { AsepriteClipFile } from './asepriteImport';

export function asepriteClipName(stem: string, tag: AsepriteTag | null, legacy = false): string {
    if (!tag) return stem + '.esanim';
    const separators = legacy ? /[^\w.-]+/g : /[^\p{L}\p{M}\p{N}_.-]+/gu;
    const name = legacy ? tag.name : tag.name.normalize('NFC');
    const slug = name.trim().replace(separators, '-').replace(/^-+|-+$/g, '');
    return stem + '_' + (slug || 'clip') + '.esanim';
}

export function filenameKey(file: string): string {
    return file.normalize('NFC').toLowerCase();
}

/** The same spelling is available on a case-sensitive volume and a case-insensitive one. */
export function availableName(preferred: string, occupied: Set<string>): string {
    const dot = preferred.lastIndexOf('.');
    let file = preferred;
    for (let n = 2; occupied.has(filenameKey(file)); n++) {
        file = preferred.slice(0, dot) + '-' + n + preferred.slice(dot);
    }
    occupied.add(filenameKey(file));
    return file;
}

export interface PreviousClip {
    file: string;
    uuid: unknown;
    /** Undefined on imports made before source tags were recorded. Null is the whole untagged animation. */
    tag?: AsepriteTag | null;
    data?: AnimClipAssetData | null;
}

function tagKey(tag: AsepriteTag | null, exact: boolean): string {
    if (!tag) return 'null';
    return JSON.stringify(exact ? [tag.name, tag.from, tag.to, tag.direction, tag.repeat] : [tag.name]);
}

function legacySpelling(base: string, file: string): boolean {
    const stem = base.slice(0, -'.esanim'.length).toLowerCase();
    const name = file.slice(0, -'.esanim'.length).toLowerCase();
    return name === stem || name.startsWith(stem + '-') && /^(?:[2-9]|[1-9]\d+)$/.test(name.slice(stem.length + 1));
}

function playback(clip: AnimClipAssetData | null | undefined): string | undefined {
    if (!Array.isArray(clip?.frames)) return undefined;
    return JSON.stringify([clip.loop, clip.frames.map(frame => frame.cell)]);
}

/** Match exact tags first, then a unique name whose range or timing changed. Aseprite stores no persistent tag ID. */
export function matchAsepriteClips(stem: string, clips: AsepriteClipFile[], previous: PreviousClip[]) {
    const remaining = new Set(clips), retired = new Set(previous);
    const matched = new Map<AsepriteClipFile, PreviousClip>();
    function assign(clip: AsepriteClipFile, old: PreviousClip) {
        matched.set(clip, old);
        remaining.delete(clip);
        retired.delete(old);
    }
    for (const exact of [true, false]) {
        const prior = new Map<string, PreviousClip[]>();
        for (const old of retired) {
            if (old.tag === undefined) continue;
            const key = tagKey(old.tag, exact);
            if (!prior.has(key)) prior.set(key, []);
            prior.get(key)!.push(old);
        }
        const counts = new Map<string, number>();
        for (const clip of remaining) {
            const key = tagKey(clip.tag, exact);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        // Identical duplicates can exchange places without changing playback. When their counts change,
        // the file cannot tell which one survived, so keep those old references independent.
        for (const [key, group] of prior) {
            if (group.length !== counts.get(key) || !exact && group.length !== 1) prior.delete(key);
            else if (group.length > 1) {
                const stemOf = (clip: PreviousClip) => clip.file.slice(0, -'.esanim'.length);
                group.sort((a, b) => stemOf(a).localeCompare(stemOf(b), 'en', { numeric: true }));
            }
        }
        for (const clip of remaining) {
            const group = prior.get(tagKey(clip.tag, exact));
            if (group?.length) assign(clip, group.shift()!);
        }
    }
    // Earlier importers recorded only the disambiguated filename. For colliding names the old cells
    // and loop setting can disambiguate a reorder. An ambiguous pair must keep its own playable asset.
    const legacy = [...retired].filter(old => old.tag === undefined);
    if (legacy.length) for (const compareFrames of [true, false]) {
        const choices = new Map<AsepriteClipFile, PreviousClip[]>(), uses = new Map<PreviousClip, number>();
        for (const clip of remaining) {
            const base = asepriteClipName(stem, clip.tag, true), sequence = playback(clip.data);
            const candidates = legacy.filter(old => retired.has(old) && legacySpelling(base, old.file)
                && (!compareFrames || sequence === playback(old.data)));
            choices.set(clip, candidates);
            for (const old of candidates) uses.set(old, (uses.get(old) ?? 0) + 1);
        }
        for (const [clip, candidates] of choices) {
            if (candidates.length === 1 && uses.get(candidates[0]!) === 1) assign(clip, candidates[0]!);
        }
    }
    return { matched, retired };
}
