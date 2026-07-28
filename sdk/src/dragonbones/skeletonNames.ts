// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/skeletonNames.ts
 * @brief   The armature and animation names a `_ske.json` declares.
 *
 * @details Read here rather than asked of the module, for the reason the Spine
 *          atlas's page names are (see spine/atlasPages): naming what is in a file
 *          is not posing a skeleton, and making an inspector dropdown wait on a
 *          wasm instantiation buys nothing.
 *
 *          A `.dbbin` is binary and yields nothing — which is not an error. Every
 *          reader of this is expected to work without it, and the editor's field
 *          simply stays free text.
 */

export interface DragonBonesArmatureNames {
    name: string;
    animations: string[];
}

interface RawArmature {
    name?: unknown;
    animation?: unknown;
}

const nameOf = (v: unknown): string | null =>
    v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
        ? (v as { name: string }).name
        : null;

/**
 * Armatures and their animations, in file order. Anything unreadable — binary
 * data, a truncated download, a file that is simply not this format — is no names
 * rather than a throw: a caller asking what is inside can always be told nothing.
 */
export function parseDragonBonesNames(source: string | object): DragonBonesArmatureNames[] {
    let doc: unknown = source;
    if (typeof source === 'string') {
        try {
            doc = JSON.parse(source);
        } catch {
            return [];
        }
    }
    const armatures = (doc as { armature?: unknown } | null)?.armature;
    if (!Array.isArray(armatures)) return [];

    const out: DragonBonesArmatureNames[] = [];
    for (const raw of armatures as RawArmature[]) {
        const name = nameOf(raw);
        if (name === null) continue;
        const animations = Array.isArray(raw.animation)
            ? (raw.animation as unknown[]).map(nameOf).filter((n): n is string => n !== null)
            : [];
        out.push({ name, animations });
    }
    return out;
}
