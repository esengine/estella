// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The two things a scene file's entity list can hold, and how to tell
 *        them apart. Its own module so the loader and the validator ask the same
 *        question rather than each spelling the test out.
 */
import type { PrefabInstanceEntry } from '../prefab/sceneInstance';
import type { SceneEntityData } from './scene';

/**
 * A scene-file entity is either an ordinary entity record or a prefab-instance
 * entry — a minimal delta over a `.esprefab` asset. The runtime expands each
 * instance through the same `flattenPrefab` core the editor uses, so a saved
 * prefab scene loads identically in both.
 */
export type SceneEntry = SceneEntityData | PrefabInstanceEntry;

/** True for a prefab-instance entry (carries a `prefab` asset ref). */
export function isPrefabEntry(e: SceneEntry): e is PrefabInstanceEntry {
    return typeof (e as PrefabInstanceEntry).prefab === 'string';
}
