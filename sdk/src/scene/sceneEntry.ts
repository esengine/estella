// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The two things a scene file's entity list can hold, and how to tell
 *        them apart. Its own module so the loader and the validator ask the same
 *        question rather than each spelling the test out.
 */
import type { PrefabInstanceEntry } from '../prefab/sceneInstance';
import type { SceneComponentData, SceneEntityData } from './scene';

/**
 * A scene-file entity is either an ordinary entity record or a prefab-instance
 * entry — a minimal delta over a `.esprefab` asset. The runtime expands each
 * instance through the same `flattenPrefab` core the editor uses, so a saved
 * prefab scene loads identically in both.
 */
export type SceneEntry = SceneEntityData | PrefabInstanceEntry;

/** True for a prefab-instance entry (carries a `prefab` asset ref). */
export function isPrefabEntry(e: SceneEntry): e is PrefabInstanceEntry {
    return typeof (e as PrefabInstanceEntry | null)?.prefab === 'string';
}

/** Visit references authored in one scene row, including the scene-side parts of a prefab instance. */
export function visitSceneEntryEntityReferences(
    entry: SceneEntry, entityFieldsOf: (type: string) => readonly string[],
    visit: (type: string, field: string, reference: unknown) => void,
): void {
    const field = (type: string, key: string, value: unknown): void => {
        if (Array.isArray(value)) for (const ref of value) visit(type, key, ref);
        else visit(type, key, value);
    };
    const component = ({ type, data }: SceneComponentData): void => {
        for (const key of entityFieldsOf(type)) field(type, key, data?.[key]);
    };
    if (!isPrefabEntry(entry)) {
        for (const row of entry.components ?? []) component(row);
        return;
    }
    for (const override of entry.overrides) {
        const { type, componentType, propertyName, componentData } = override;
        if (type === 'property' && componentType && propertyName !== undefined
            && entityFieldsOf(componentType).includes(propertyName)) {
            field(componentType, propertyName, override.value);
        } else if ((type === 'component_added' || type === 'component_replaced') && componentData) {
            component(componentData);
        }
    }
    for (const member of entry.added ?? []) for (const row of member.components ?? []) component(row);
}
