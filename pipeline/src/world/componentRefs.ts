// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    componentRefs.ts
 * @brief   Which component fields hold entity references, asked of the engine
 *          rather than listed here.
 *
 * @details A table would answer for the components someone remembered. The
 *          registry answers for every one the engine has — builtins from the
 *          generated metadata and the TypeScript components alike — which is what
 *          the cross-cell reference check has to be complete over.
 */

import { getComponentRegistry } from 'esengine/node';

let cached: Map<string, readonly string[]> | null = null;

/**
 * The entity-valued fields of a component type; empty for most of them.
 *
 * A project's OWN components live in its script bundle, not in this registry, so
 * a reference one holds goes unchecked at cook. The runtime is the backstop: an
 * id it cannot resolve is cleared, never left pointing at another entity.
 */
export function engineEntityFields(componentType: string): readonly string[] {
    if (cached === null) {
        cached = new Map();
        for (const [name, def] of getComponentRegistry()) {
            if (def.entityFields.length > 0) cached.set(name, def.entityFields);
        }
    }
    return cached.get(componentType) ?? [];
}
