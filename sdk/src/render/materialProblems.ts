// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  materialProblems.ts
 * @brief What a material asset says that nothing reads. Pure, and apart from material.ts so a loader can name it without the material system.
 */
import { readMaterialProperty } from './materialProperty';

/**
 * The properties of a material asset that `parseAssetProperties` (material.ts) would drop, each with what to write instead. A dropped value is the quietest
 * way a material goes wrong: it loads, draws, and simply ignores what was written (a tiling of `[12, 12]` leaves the surface untiled).
 * Strings are texture refs and are the loader's own business.
 */
export function assetPropertyProblems(properties: Record<string, unknown>): string[] {
    const problems: string[] = [];
    for (const [key, value] of Object.entries(properties)) {
        if (Array.isArray(value)) {
            const names = ['x', 'y', 'z', 'w'].slice(0, Math.min(Math.max(value.length, 2), 4));
            const colour = value.length === 3 || value.length === 4;
            problems.push(`${key} is an array and no material reads one: write ${colour ? '{ "r": .., "g": .., "b": .., "a": .. } for a colour or ' : ''}{ ${names.map((n) => `"${n}": ..`).join(', ')} } for a vector`);
        } else if (readMaterialProperty(value) !== undefined) {
            continue;
        } else if (typeof value === 'object' && value !== null) {
            problems.push(`${key} is an object with none of the keys a colour (r, g, b, a) or a vector (x, y, z, w) has`);
        } else {
            problems.push(`${key} is ${value === null ? 'null' : typeof value}: a material property is a number, a texture path, a colour or a vector`);
        }
    }
    return problems;
}
