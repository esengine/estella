// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export function isSoundEventPath(path: string): boolean {
    return /\.esaudioevent$/i.test(path);
}

/** Visit the authored clip slots while preserving all other document fields. */
export function mapSoundEventClipRefs(document: unknown, map: (ref: string) => string): void {
    const clips = (document as { clips?: { clip?: unknown }[] } | null)?.clips;
    if (!Array.isArray(clips)) return;
    for (const slot of clips) {
        if (typeof slot?.clip === 'string' && slot.clip.trim()) slot.clip = map(slot.clip);
    }
}
