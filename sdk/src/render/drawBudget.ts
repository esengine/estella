// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    drawBudget.ts
 * @brief   Where a frame's draws went, pass by pass, held against the level's draw call budget.
 *
 * @details The device counts every draw it issues (`render.gpu.draws`); the scene's and the overlay's
 *          lists count theirs after batching (`batch.draws`), and the passes that draw the scene again
 *          count their own (shadow maps, the depth prepass, planar reflections, motion vectors, the
 *          cover pass). What none of them claims — post-processing, a blit, the editor's grid — is
 *          `other`, so the shares always add up to the device's total and a pass nobody counts is still
 *          seen. The per-pass counters are published only while the frame profiler is on; without them
 *          everything but the lists is `other`.
 */

/** A part of the frame, by what drew it. @experimental */
export type DrawPass = 'lists' | 'shadow' | 'prepass' | 'reflection' | 'motion' | 'cover' | 'other';

/** @experimental */
export interface DrawPassShare {
    pass: DrawPass;
    draws: number;
}

/** @experimental */
export interface DrawBudgetReport {
    /** Every draw the GPU was asked for. */
    draws: number;
    /** The budget it is held to; 0 is none. */
    budget: number;
    /** By how many it went past the budget; 0 within it. */
    over: number;
    /** The draws by pass, largest first, the empty ones left out. */
    passes: DrawPassShare[];
}

const COUNTERS: readonly [Exclude<DrawPass, 'other'>, string][] = [
    ['lists', 'batch.draws'],
    ['shadow', 'render.shadow.draws'],
    ['prepass', 'render.prepass.draws'],
    ['reflection', 'render.planar.draws'],
    ['motion', 'render.motion.draws'],
    ['cover', 'render.cover.draws'],
];

/**
 * A frame's draws by pass. @p gpuDraws is the device's own count; @p counters the frame's engine
 * counters by name (a frame stats report's `cppCounters`), and @p listDraws the lists' count to use
 * when the counters do not carry it (they are absent while the profiler is off).
 *
 * @experimental
 */
export function drawBudgetReport(
    gpuDraws: number, budget: number, counters: Readonly<Record<string, number>>, listDraws = 0,
): DrawBudgetReport {
    const passes: DrawPassShare[] = [];
    let claimed = 0;
    for (const [pass, name] of COUNTERS) {
        const value = counters[name] ?? (pass === 'lists' ? listDraws : 0);
        const draws = Math.max(0, Math.round(value));
        if (draws === 0) continue;
        passes.push({ pass, draws });
        claimed += draws;
    }
    // The device's count is the truth; a share a pass claims past it (a counter from a frame other than the
    // one counted) is not taken from `other`, which never goes below nothing.
    const total = Math.max(0, Math.round(gpuDraws));
    const other = total - claimed;
    if (other > 0) passes.push({ pass: 'other', draws: other });
    passes.sort((a, b) => b.draws - a.draws);
    const limit = Math.max(0, Math.round(budget));
    return { draws: total, budget: limit, over: limit > 0 ? Math.max(0, total - limit) : 0, passes };
}
