// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

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
