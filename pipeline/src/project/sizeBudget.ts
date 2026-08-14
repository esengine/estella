// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a packaging target's size limit is, and what it measures.
 *
 *        A shipped game is refused by a store, a mini-game host or an ad network
 *        for being too big far more often than for being wrong, and every target
 *        counts differently: WeChat caps the MAIN package and, separately, the
 *        sum of every subpackage; an ad network caps the one FILE it takes an
 *        upload of. So a limit is not a number — it is a number, WHAT it counts,
 *        and WHERE it comes from, and all three travel together.
 *
 *        This vocabulary was already here, but it lived on one branch: the
 *        playable export carried `maxBytes` + `limitNote` per ad network and
 *        wrote its own warning sentence, while WeChat's 4MB main package — the
 *        harder limit, on the platform this engine targets first — had nothing.
 *        The shape that worked for one network is the shape every target gets.
 *
 *        A budget is DATA, so it rides the same profile a vendor/network already
 *        supplies (`MiniGameExportProfile`, `PlayableAdProfile`): adding a target
 *        with a limit of its own stays one profile object, not a branch. Nothing
 *        here reads the filesystem or React — the export measures, the build
 *        dialog renders, and the tests check the arithmetic, all off this file.
 *
 *        Deliberately absent: a made-up limit for targets that have none. The web
 *        and the desktop shell impose no cap, so they get an empty list and the
 *        project may declare its own budget — an invented "recommended" ceiling
 *        would be a number a developer then designs around, sourced from us.
 */
import type { ExportPlatform } from './platforms';

/**
 * What a limit counts. The distinction is the whole point: 30MB of art behind a
 * lazy subpackage breaks a WeChat main-package limit not at all, and breaks an
 * ad network's single-file limit completely.
 */
export type BudgetScope =
    /** Bytes needed before the game can be played at all: the host page, the
     *  engine runtime, the scripts, and the assets in `local` groups. What a
     *  mini-game calls the main package. */
    | 'initial'
    /** Every byte inside the package — `initial` plus lazily-loaded subpackages.
     *  Excludes `remote` groups, which are downloaded from a CDN and are not part
     *  of what the host stores. */
    | 'total'
    /** The single file that gets uploaded: an ad network's index.html or archive,
     *  a store's .apk. */
    | 'deliverable';

/** One limit a target imposes. */
export interface SizeBudget {
    readonly scope: BudgetScope;
    readonly maxBytes: number;
    /**
     * Where the number comes from, quoted verbatim wherever the limit is
     * reported — so a developer checks it against the platform's current docs
     * rather than trusting us. Left in the platform's own words (English) on
     * purpose: it cites an external rule, and a translation is a paraphrase of
     * someone else's contract.
     */
    readonly note: string;
}

/** Bytes per binary megabyte — the unit every platform states its cap in. */
const MB = 1024 * 1024;

/**
 * The limits a built-in target imposes, before any profile or project override.
 *
 * Only limits we can cite. `wechat` is here rather than on the WeChat profile
 * because it is the platform's rule, not the export's — a project-authored
 * mini-game profile for another vendor declares its own (see
 * {@link resolveSizeBudgets}).
 */
export function builtinSizeBudgets(platform: ExportPlatform): readonly SizeBudget[] {
    if (platform === 'wechat') return WECHAT_BUDGETS;
    return NO_BUDGETS;
}

const NO_BUDGETS: readonly SizeBudget[] = [];

const WECHAT_BUDGETS: readonly SizeBudget[] = [
    { scope: 'initial', maxBytes: 4 * MB, note: "WeChat caps a mini-game's main package at 4MB" },
    { scope: 'total', maxBytes: 20 * MB, note: 'WeChat caps a mini-game at 20MB across all subpackages' },
];

/**
 * The limits in force for one export, from the three places one can come from.
 *
 * Precedence is deliberate. A PROFILE limit replaces the built-in for the same
 * scope, because a vendor/network profile is more specific than the platform
 * default (a playable's cap is the chosen network's, not "playables in
 * general"). A PROJECT budget replaces both, because a team that ships under a
 * stricter self-imposed ceiling — or that knows their host raised the cap — is
 * the authority on their own build, and an engine that argued with them would
 * just be wrong on a schedule.
 */
export function resolveSizeBudgets(
    platform: ExportPlatform,
    opts?: {
        /** Limits declared by the vendor / ad-network profile driving this export. */
        profile?: readonly SizeBudget[];
        /** `packaging.sizeBudget[platform]` — bytes, replacing the primary limit. */
        projectMaxBytes?: number;
    },
): readonly SizeBudget[] {
    const byScope = new Map<BudgetScope, SizeBudget>();
    for (const b of builtinSizeBudgets(platform)) byScope.set(b.scope, b);
    for (const b of opts?.profile ?? NO_BUDGETS) byScope.set(b.scope, b);
    const budgets = [...byScope.values()];

    const override = opts?.projectMaxBytes;
    if (override != null && override > 0) {
        // Replaces the PRIMARY limit — the first one, which is the scope this
        // target is actually judged on (`initial` for a package, `deliverable`
        // for an upload). A project that sets a budget for a target with no
        // built-in limit gets `initial`: the bytes before play is the only
        // measure that means the same thing on every target.
        const primary = budgets[0]?.scope ?? 'initial';
        const at = budgets.findIndex((b) => b.scope === primary);
        const declared: SizeBudget = { scope: primary, maxBytes: override, note: PROJECT_BUDGET_NOTE };
        if (at >= 0) budgets[at] = declared;
        else budgets.unshift(declared);
    }
    return budgets;
}

/** Marks a limit as the project's own, so the UI attributes it rather than
 *  quoting a platform rule that did not say this. */
export const PROJECT_BUDGET_NOTE = 'project budget';

/** How one measurement came out against one limit. */
export interface SizeVerdict {
    readonly budget: SizeBudget;
    /** Bytes measured for {@link SizeBudget.scope}. */
    readonly measuredBytes: number;
    /** Measured over the limit — 1 is exactly at it. Drives the meter, and is
     *  what "close to the limit" is judged on. */
    readonly ratio: number;
    readonly status: 'ok' | 'near' | 'over';
}

/** Fraction of a limit at which a build is called `near` — close enough that the
 *  next art pass breaks it, far enough that saying so is not noise. */
export const NEAR_LIMIT_RATIO = 0.9;

/** Judge one measurement against one limit. */
export function evaluateSizeBudget(measuredBytes: number, budget: SizeBudget): SizeVerdict {
    const ratio = budget.maxBytes > 0 ? measuredBytes / budget.maxBytes : 0;
    const status = ratio > 1 ? 'over' : ratio >= NEAR_LIMIT_RATIO ? 'near' : 'ok';
    return { budget, measuredBytes, ratio, status };
}

/**
 * Human byte size — ONE spelling for the whole editor.
 *
 * Three copies of this used to exist (the content browser, the inspector, and
 * the build dialog's MB-only variant), so the same file could be "1.4 MB" in one
 * panel and "1.4 MB" in another only by coincidence. Binary units, because every
 * limit this file carries is stated in them.
 */
export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${Math.round(n)} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = n;
    let i = -1;
    do {
        v /= 1024;
        i++;
    } while (v >= 1024 && i < units.length - 1);
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
