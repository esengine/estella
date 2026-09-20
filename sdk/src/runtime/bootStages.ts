// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bootStages.ts — the stages a packaged game boots through, once.
 *
 * Two very different screens read this list: a web page's start overlay, drawn
 * in HTML before any script runs, and a mini-game's host loading indicator,
 * which is an API call because the display canvas is already the GL surface.
 * They agree about the weights or they disagree about how far along the same
 * boot is.
 *
 * Weights, not stage count: the engine binary and the first app are most of a
 * cold start, and an even bar sits at 60% for as long as the rest takes.
 */

/** A boot stage, in the order a host reaches them. */
export const BOOT_STAGES = [
    { id: 'config', weight: 4, says: 'Reading the build' },
    { id: 'scripts', weight: 6, says: 'Loading scripts' },
    { id: 'manifest', weight: 4, says: 'Reading the asset list' },
    { id: 'scene', weight: 6, says: 'Loading the scene' },
    { id: 'engine', weight: 40, says: 'Starting the engine' },
    { id: 'app', weight: 22, says: 'Preparing the renderer' },
    { id: 'assets', weight: 13, says: 'Loading assets' },
    { id: 'ready', weight: 5, says: 'Ready' },
] as const;

export type BootStage = (typeof BOOT_STAGES)[number]['id'];

/** Total weight, so a caller turns "stages finished" into a percentage. */
export const BOOT_TOTAL = BOOT_STAGES.reduce((n, s) => n + s.weight, 0);

/** How far along a boot is, having finished `done`, as a whole percent. */
export function bootPercent(done: readonly BootStage[]): number {
    const seen = new Set(done);
    const sum = BOOT_STAGES.filter((s) => seen.has(s.id)).reduce((n, s) => n + s.weight, 0);
    return Math.min(100, Math.round((sum / BOOT_TOTAL) * 100));
}

/** What the host should say it is doing, having finished `done`. */
export function bootSays(done: readonly BootStage[]): string {
    const seen = new Set(done);
    return (BOOT_STAGES.find((s) => !seen.has(s.id)) ?? BOOT_STAGES[BOOT_STAGES.length - 1]).says;
}
