// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  censusJudge — the engine's own census judge, reachable from a script.
 *
 * Re-export, not a reimplementation. The tiers, the confidence bound and the
 * staircase rule are subtle enough that a second copy here would drift from the
 * one the headless soak uses, and then the two suites would disagree about what
 * a leak is — which is worse than having only one of them.
 */
export { analyzeCensusSeries, formatCensusReport, formatCensusDiff, diffCensus } from 'esengine';
