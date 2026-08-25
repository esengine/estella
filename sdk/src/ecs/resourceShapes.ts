// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    resourceShapes.ts
 * @brief   The built-in resources a compiled system can read, and their fields.
 *
 * @details A compiled system reaches a resource by ADDRESS, so its fields need a
 *          layout, and a layout needs exactly one author. This is that author:
 *          `resource.ts` builds the resource from it, and the AOT compiler reads
 *          it for the offsets (docs/REARCH_AOT_ABI.md §2.4).
 *
 *          A resource belongs here when every field is a number or a boolean —
 *          the same bar `defineComponent` shapes meet, and for the same reason:
 *          anything else has no fixed width. `Input` is deliberately absent; it
 *          is a class with methods, so there is nothing to lay out.
 *
 *          Order is the layout. Adding a field in the middle moves every field
 *          after it, which is why this list is the thing that changes and not a
 *          copy of it somewhere else.
 *
 *          NO IMPORTS. A build tool reads this without pulling in the engine.
 */

/** Field defaults per resource, in declaration order. */
export const RESOURCE_SHAPES = {
    Time: {
        delta: 0,
        elapsed: 0,
        frameCount: 0,
        fixedDelta: 1 / 60,
        fixedAlpha: 0,
        fixedTick: 0,
        scale: 1,
        unscaledDelta: 0,
    },
} as const satisfies Record<string, Readonly<Record<string, number | boolean>>>;

/** Names of the resources with a layout — what tells a host shape from a component. */
export const RESOURCE_NAMES: readonly string[] = Object.keys(RESOURCE_SHAPES);

/** The fields of `name`, in layout order, or null if it has no layout. */
export function resourceFields(name: string): readonly string[] | null {
    const shape = (RESOURCE_SHAPES as Record<string, Record<string, unknown>>)[name];
    return shape ? Object.keys(shape) : null;
}
