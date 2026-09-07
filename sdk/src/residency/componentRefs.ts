// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    componentRefs.ts
 * @brief   Which component fields hold entity references, asked of the engine
 *          rather than listed here.
 *
 * @details A table would answer for the components someone remembered. The
 *          registry answers for every one registered where the question is asked
 *          — and that is not the same set on both sides: a cook loads the
 *          engine's components, while a play realm has also drained the project's
 *          own bundle. Play's reference check is therefore a SUPERSET of the
 *          cook's, and a cross-cell reference held by a project component is
 *          found in the editor first. The runtime is the backstop for whatever
 *          neither saw: an id it cannot resolve is cleared, never left pointing
 *          at another entity.
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
