// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    componentRefs.ts
 * @brief   Which component fields hold entity references, asked of the engine
 *          rather than listed here.
 *
 * @details A table would answer for the components someone remembered. The
 *          registry answers for every component registered in the current realm.
 *          A cook can supply project declarations extracted from its register
 *          entry, while Play reads the registry populated by the project bundle.
 */

import { getComponentRegistry } from '../ecs/component';

/**
 * A lookup over the registry as it stands right now.
 *
 * Taken as a snapshot rather than answered per call, because `getComponentRegistry`
 * composes a fresh map on every call and a partition asks this once per component
 * field of every entity in the world.
 */
export function registryEntityFields(): (componentType: string) => readonly string[] {
    const fields = new Map<string, readonly string[]>();
    for (const [name, def] of getComponentRegistry()) {
        if (def.entityFields.length > 0) fields.set(name, def.entityFields);
    }
    return (componentType) => fields.get(componentType) ?? [];
}
