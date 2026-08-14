// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  apiSnapshot.mjs — reading sdk/etc/*.api.md, and what a release promised.
 *
 * Pure text in, findings out: no compiler and no filesystem, so the rule that
 * decides whether a promise was broken can be tested directly instead of only
 * being observable the release after it was needed.
 */

/** Stability tiers, most-frozen first. A symbol carries exactly one. */
export const TIERS = ['public', 'beta', 'experimental', 'internal'];

/** What a snapshot heading says when no release named a tier for the symbol. */
export const UNCLAIMED = 'unclaimed';

/**
 * Parse a `<entry>.api.md` into `name -> { kind, tier, deprecated, body }`.
 * Snapshots written before the tiers existed carry no tag; those read as
 * {@link UNCLAIMED}, which is the truth about them — nothing was promised.
 */
export function parseSnapshot(text) {
    const out = new Map();
    for (const section of text.replace(/\r\n?/g, '\n').split(/^## /m).slice(1)) {
        const nl = section.indexOf('\n');
        const heading = nl < 0 ? section : section.slice(0, nl);
        const m = /^(\S+) — (\S+)(.*)$/.exec(heading);
        if (!m) continue;
        const [, name, kind, tags] = m;
        out.set(name, {
            kind,
            tier: new RegExp(`@(${TIERS.join('|')})\\b`).exec(tags)?.[1] ?? UNCLAIMED,
            deprecated: /@deprecated\b/.test(tags),
            body: (nl < 0 ? '' : section.slice(nl + 1)).trim(),
        });
    }
    return out;
}

/**
 * The part of a body that carries a promise. An `@internal` member is in the
 * shipped `.d.ts` and in the snapshot so it is visible, but it is not something
 * a release promised, so changing one is not breaking one.
 */
export function promisedBody(body) {
    return body.split('\n').filter((l) => !l.startsWith('@internal ')).join('\n');
}


/**
 * Whether `after` only ADDS optional members to `before` — an addition that
 * breaks nobody, since existing code constructs the value without the field.
 * A snapshot renders an optional member as `name: T | undefined`, and that
 * spelling is what makes the addition safe, so it is what this looks for.
 */
export function isAdditiveMembers(before, after) {
    const was = before.split('\n').filter(Boolean);
    const now = new Set(after.split('\n').filter(Boolean));
    if (was.some((line) => !now.has(line))) return false;
    const added = [...now].filter((line) => !was.includes(line));
    return added.length > 0 && added.every((line) => /:\s.*\|\s*undefined$/.test(line));
}

/**
 * Compare one entry against its released self. Only @public carries a promise,
 * so only @public produces a failure; @beta is noted because "may adjust" should
 * still read as a decision someone made rather than a silent edit.
 */
export function baselineFindings(was, now) {
    const failures = [];
    const notes = [];
    for (const [name, before] of was) {
        const after = now.get(name);
        if (before.tier === 'public') {
            if (!after) {
                // Deprecated for a release first is exactly what earns a removal.
                if (before.deprecated) continue;
                failures.push(`${name} — removed while @public and never @deprecated`);
            } else if (after.tier !== 'public') {
                failures.push(`${name} — @public at baseline, now @${after.tier}; a freeze does not thaw`);
            } else if (after.kind !== before.kind) {
                failures.push(`${name} — @public ${before.kind} became a ${after.kind}`);
            } else if (promisedBody(after.body) !== promisedBody(before.body)) {
                if (before.kind === 'interface'
                    && isAdditiveMembers(promisedBody(before.body), promisedBody(after.body))) {
                    notes.push(`${name} — @public interface gained an optional member`);
                } else {
                    failures.push(`${name} — @public signature changed`);
                }
            }
        } else if (before.tier === 'beta') {
            if (!after) notes.push(`${name} — @beta removed`);
            else if (promisedBody(after.body) !== promisedBody(before.body)) {
                notes.push(`${name} — @beta signature changed`);
            }
        }
    }
    return { failures, notes };
}
