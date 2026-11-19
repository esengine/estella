// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * How much the world generator keeps: read by the generator, set from the runtime's configuration. It lives outside
 * `worldgen/` because the configuration is in every package and the generator is not: imported from there, a blank package
 * carried a piece of the generator along.
 */
export interface WorldgenLimits {
    tilesKept: number;
    cacheLimit: number;
    plansKept: number;
}

export const WORLDGEN_LIMIT_DEFAULTS: Readonly<WorldgenLimits> = { tilesKept: 6000, cacheLimit: 40000, plansKept: 24 };

const limits: WorldgenLimits = { ...WORLDGEN_LIMIT_DEFAULTS };

export function worldgenLimits(): Readonly<WorldgenLimits> {
    return limits;
}

export function setWorldgenLimits(next: Partial<WorldgenLimits> | undefined): void {
    if (next) Object.assign(limits, next);
}
