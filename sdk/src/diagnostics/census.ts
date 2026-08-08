// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    census.ts
 * @brief   How many of X are alive right now — one snapshot, for every X the
 *          engine is capable of leaking.
 *
 * @details The engine could not answer that question. Entity count it had;
 *          everything else a long session accumulates — GL objects, listeners,
 *          physics bodies, cache entries, both heaps — was reachable only by
 *          reading a private field of whichever class happened to own it, if at
 *          all. So the failure that actually ends an editor session ("Play/Stop
 *          forty times and it starts to crawl") had no instrument pointed at it,
 *          and every leak we ever fixed was found by someone noticing.
 *
 *          This is that instrument. Subsystems register probes; a census reads
 *          them all into one flat set of named counters that a churn test can
 *          take before and after, and a human can read.
 *
 *          THE TIER IS THE DESIGN. The obvious assertion — every counter returns
 *          to its baseline — is wrong often enough to be useless, and a soak test
 *          that cries wolf gets deleted within the month. A texture cache holding
 *          refCount==0 entries for revival is doing its job; a transient buffer
 *          pool that grew to its high-water mark and stayed there is doing its
 *          job; a JS heap is not under anyone's control at all. Only some
 *          counters obey a conservation law, so only those are asserted as one:
 *
 *            conserved — spawn/destroy is a round trip. Must be IDENTICAL across
 *                        cycles. Entities, bodies, listeners, live GL objects.
 *            bounded   — may plateau above baseline, must not grow per cycle.
 *                        Pools and caches. Judged on slope, never on value.
 *            trend     — noisy and allocator-dependent. Heaps. Judged on slope
 *                        against a stated per-cycle budget.
 *            info      — recorded to explain a failure, never asserted.
 *
 *          Slope rather than value is also what makes the test cheap: a leak is a
 *          positive slope from cycle one, so fifty cycles prove what ten thousand
 *          would, and the projection in the report says what those ten thousand
 *          would have cost.
 */
import type { Census, CensusEntry, CensusTier, CensusContext, CensusProbe } from './censusTypes';
import { readProbes, registeredProbeIds } from './censusRegistry';
import { installBuiltinCensusProbes } from './censusProbes';

export type { Census, CensusEntry, CensusTier, CensusContext, CensusProbe };

let installed = false;

/**
 * Install the engine's probes, once, from inside the exported entry points.
 *
 * Anywhere else and the bundler removes them: non-entry modules are marked
 * side-effect free, so a bare import or top-level call registers nothing in
 * dist. That shipped once — see docs/REARCH_RELIABILITY_SOAK.md.
 */
function ensureBuiltins(): void {
    if (installed) return;
    installed = true;
    installBuiltinCensusProbes();
}

export { registerCensusProbe, counter } from './censusRegistry';

/** Registered probe ids, for diagnosing a census that came back thinner than expected. */
export function censusProbeIds(): string[] {
    ensureBuiltins();
    return registeredProbeIds();
}

/** Read every registered probe into one snapshot. */
export function takeCensus(ctx: CensusContext = {}): Census {
    ensureBuiltins();
    return readProbes(ctx);
}

/**
 * Settle the JS heap before a census, if the host allows it. True when a
 * collection ran; without one the heap only climbs between samples, so the heap
 * counters downgrade themselves to `info`. Node needs `--expose-gc`.
 */
export function collectGarbage(): boolean {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== 'function') return false;
    gc();
    return true;
}

// =============================================================================
// Diff — two snapshots
// =============================================================================

export interface CensusDelta {
    readonly key: string;
    readonly tier: CensusTier;
    readonly unit: CensusEntry['unit'];
    readonly before: number;
    readonly after: number;
    readonly delta: number;
}

/**
 * What moved between two snapshots. A counter present on only one side is
 * reported with the missing half as 0: a probe that appeared or vanished
 * mid-run is a real difference, not a reason to skip the row.
 */
export function diffCensus(before: Census, after: Census): CensusDelta[] {
    const keys = new Set([...before.entries.keys(), ...after.entries.keys()]);
    const out: CensusDelta[] = [];
    for (const key of [...keys].sort()) {
        const a = before.entries.get(key);
        const b = after.entries.get(key);
        const spec = b ?? a!;
        const from = a?.value ?? 0;
        const to = b?.value ?? 0;
        out.push({ key, tier: spec.tier, unit: spec.unit, before: from, after: to, delta: to - from });
    }
    return out;
}

// =============================================================================
// Series analysis — the judge
// =============================================================================

export interface CensusSeriesOptions {
    /**
     * Cycles to discard before judging. A first pass legitimately allocates for
     * good — lazy component registration, a shader compiled on first use, a pool
     * reaching working size — and judging that would fail every run.
     * Defaults to the larger of 3 and a fifth of the samples.
     */
    warmupCycles?: number;
    /**
     * Cycle count the projection reports against — "at this rate, N cycles costs
     * this much". Does not affect the verdict.
     */
    projectCycles?: number;
    /** Per-cycle growth a `bounded` counter may show before it reads as a leak. */
    boundedSlopeTolerance?: number;
    /**
     * Per-cycle byte growth a `trend` counter (a heap) may show.
     *
     * The default is a DETECTION FLOOR, not a taste — below ~16 KB the number
     * is V8 sizing its heap, not the engine keeping anything (measurements in
     * docs/REARCH_RELIABILITY_SOAK.md). Exact counters do the fine-grained job.
     */
    trendByteBudgetPerCycle?: number;
}

export interface CensusVerdict {
    readonly key: string;
    readonly tier: CensusTier;
    readonly unit: CensusEntry['unit'];
    readonly leaking: boolean;
    /** Least-squares growth per cycle over the judged samples. */
    readonly slopePerCycle: number;
    /**
     * The growth the samples actually support — the slope pulled back by twice
     * its standard error. This, not the point estimate, is what is judged.
     */
    readonly confidentSlopePerCycle: number;
    /**
     * Share of cycles on which the counter rose. Near 1 is a leak; near 0 with a
     * positive slope is a pool that stepped once and the fit read as a ramp.
     */
    readonly risingFraction: number;
    readonly first: number;
    readonly last: number;
    /** confidentSlopePerCycle × projectCycles — what this costs over a session. */
    readonly projected: number;
    /** Populated when `leaking`; the sentence a failure should print. */
    readonly reason?: string;
}

export interface CensusReport {
    readonly cycles: number;
    readonly judgedFrom: number;
    readonly projectCycles: number;
    readonly verdicts: readonly CensusVerdict[];
    readonly leaks: readonly CensusVerdict[];
    readonly failedProbes: readonly string[];
}

const DEFAULT_PROJECT_CYCLES = 10_000;

/**
 * Judged samples a fitted verdict needs. Below this the standard error is not
 * estimable and the slope comes back with full confidence attached to almost
 * nothing — a five-cycle run would report a leak from two points. Conserved
 * counters are exempt: they are integers under a contract, not a fit.
 */
const MIN_FITTED_SAMPLES = 8;

/**
 * Cycle-to-cycle rises a fitted counter needs before it reads as a leak.
 *
 * A LINE FITS A STAIRCASE: one 4 KB page allocated mid-run clears the confidence
 * gate as +120 B/cycle. A leak rises again and again; a pool rises once. Cost: a
 * counter stepping rarer than one cycle in four needs a longer run.
 */
const MIN_RISING_FRACTION = 0.25;

/** Fraction of cycle-to-cycle transitions on which `ys` increased. */
function risingFraction(ys: readonly number[]): number {
    if (ys.length < 2) return 0;
    let rising = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1]) rising++;
    return rising / (ys.length - 1);
}

/**
 * Confidence multiplier on the slope's standard error — roughly one-sided 95%.
 *
 * The point estimate alone is not evidence: judging a raw fitted slope makes the
 * verdict depend on where sampling stopped — one clean step measured here passed
 * at 30 cycles and failed at 40.
 */
const CONFIDENCE_K = 2;

interface Fit {
    /** Least-squares growth per cycle. */
    slope: number;
    /** Standard error of that slope; 0 when the points are collinear. */
    stderr: number;
    /** Lower bound of the confidence interval — the slope we can actually claim. */
    lower: number;
}

/** Least-squares fit of `ys` against its own index, with the slope's uncertainty. */
function fit(ys: readonly number[]): Fit {
    const n = ys.length;
    if (n < 2) return { slope: 0, stderr: 0, lower: 0 };
    const meanX = (n - 1) / 2;
    let meanY = 0;
    for (const y of ys) meanY += y;
    meanY /= n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
        const dx = i - meanX;
        sxy += dx * (ys[i] - meanY);
        sxx += dx * dx;
    }
    if (sxx === 0) return { slope: 0, stderr: 0, lower: 0 };
    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;

    let sse = 0;
    for (let i = 0; i < n; i++) {
        const residual = ys[i] - (intercept + slope * i);
        sse += residual * residual;
    }
    const stderr = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
    // Toward zero from both directions: a negative slope's claim is its upper bound.
    const lower = slope >= 0
        ? Math.max(0, slope - CONFIDENCE_K * stderr)
        : Math.min(0, slope + CONFIDENCE_K * stderr);
    return { slope, stderr, lower };
}

/**
 * Judge a run: one census per cycle, in order. Tiers share the fitted slope,
 * differing only in how much of one they may have.
 *
 * Conserved counters are also checked for VARIANCE: one that spiked and came
 * back means a cycle cleans up late, which the slope alone reads as steady.
 */
export function analyzeCensusSeries(samples: readonly Census[], opts: CensusSeriesOptions = {}): CensusReport {
    const projectCycles = opts.projectCycles ?? DEFAULT_PROJECT_CYCLES;
    const boundedTol = opts.boundedSlopeTolerance ?? 0;
    const byteBudget = opts.trendByteBudgetPerCycle ?? 64 * 1024;
    const warmup = Math.min(
        opts.warmupCycles ?? Math.max(3, Math.floor(samples.length / 5)),
        Math.max(0, samples.length - 2),
    );
    const judged = samples.slice(warmup);

    const keys = new Set<string>();
    for (const s of samples) for (const k of s.entries.keys()) keys.add(k);

    const verdicts: CensusVerdict[] = [];
    for (const key of [...keys].sort()) {
        const spec = judged.find((s) => s.entries.has(key))?.entries.get(key)
            ?? samples.find((s) => s.entries.has(key))!.entries.get(key)!;
        const ys = judged.map((s) => s.entries.get(key)?.value ?? 0);
        const { slope: m, lower } = fit(ys);
        const first = ys[0] ?? 0;
        const last = ys[ys.length - 1] ?? 0;
        const projected = lower * projectCycles;

        let leaking = false;
        let reason: string | undefined;
        let rising = 0;
        if (spec.tier === 'conserved') {
            // Integers with a hard contract: no fit, no tolerance, no argument.
            const min = Math.min(...ys);
            const max = Math.max(...ys);
            if (max !== min) {
                leaking = true;
                reason = last !== first
                    ? `conserved counter moved ${fmt(first, spec.unit)} → ${fmt(last, spec.unit)} over ${ys.length} cycles `
                      + `(${signed(m, spec.unit)}/cycle; ${signed(m * projectCycles, spec.unit)} over ${projectCycles})`
                    : `conserved counter is not stable within the run: ranged ${fmt(min, spec.unit)}…${fmt(max, spec.unit)} `
                      + 'while starting and ending equal — a cycle is cleaning up late, and a longer session overlaps two of them';
            }
        } else {
            const budget = spec.tier === 'bounded' ? boundedTol
                : spec.unit === 'bytes' ? byteBudget : boundedTol;
            rising = risingFraction(ys);
            if (spec.tier !== 'info'
                && ys.length >= MIN_FITTED_SAMPLES
                && lower > budget
                && rising >= MIN_RISING_FRACTION) {
                leaking = true;
                const what = spec.tier === 'bounded'
                    ? 'bounded counter grows where a pool would plateau'
                    : 'grows beyond its budget';
                reason = `${what}: ${signed(m, spec.unit)}/cycle, at least ${signed(lower, spec.unit)}/cycle `
                    + `after uncertainty (budget ${fmt(budget, spec.unit)}/cycle), `
                    + `rising on ${Math.round(rising * 100)}% of cycles — `
                    + `${signed(projected, spec.unit)} over ${projectCycles} cycles`;
            }
        }

        verdicts.push({
            key, tier: spec.tier, unit: spec.unit, leaking, risingFraction: rising,
            slopePerCycle: m, confidentSlopePerCycle: lower, first, last, projected, reason,
        });
    }

    const failedProbes = [...new Set(samples.flatMap((s) => s.failedProbes))];
    return {
        cycles: samples.length,
        judgedFrom: warmup,
        projectCycles,
        verdicts,
        leaks: verdicts.filter((v) => v.leaking),
        failedProbes,
    };
}

// =============================================================================
// Formatting
// =============================================================================

const MB = 1024 * 1024;

function fmt(value: number, unit: CensusEntry['unit']): string {
    if (unit !== 'bytes') {
        return Number.isInteger(value) ? String(value) : value.toFixed(3);
    }
    const abs = Math.abs(value);
    if (abs >= MB) return `${(value / MB).toFixed(2)} MB`;
    if (abs >= 1024) return `${(value / 1024).toFixed(2)} KB`;
    return `${value.toFixed(0)} B`;
}

function signed(value: number, unit: CensusEntry['unit']): string {
    return (value >= 0 ? '+' : '') + fmt(value, unit);
}

/** Two snapshots, as a table. Rows that did not move are omitted unless `all`. */
export function formatCensusDiff(before: Census, after: Census, all = false): string {
    const rows = diffCensus(before, after).filter((d) => all || d.delta !== 0);
    if (rows.length === 0) return 'census: nothing moved';
    const width = Math.max(...rows.map((r) => r.key.length));
    return rows
        .map((r) => `  ${r.key.padEnd(width)}  ${fmt(r.before, r.unit)} → ${fmt(r.after, r.unit)}  (${signed(r.delta, r.unit)}) [${r.tier}]`)
        .join('\n');
}

/**
 * A run, as the failure message it should print.
 *
 * Leaks lead; the rest follows as context, because the counter that did NOT move
 * is half the diagnosis — entities conserved while GL textures climb says the
 * scene tore down and the renderer did not.
 */
export function formatCensusReport(report: CensusReport): string {
    const lines: string[] = [];
    const judgedCount = report.cycles - report.judgedFrom;
    lines.push(
        `census: ${report.cycles} cycles, judged from cycle ${report.judgedFrom}, ` +
        `projections over ${report.projectCycles}`,
    );
    if (judgedCount < MIN_FITTED_SAMPLES) {
        lines.push(
            `  only ${judgedCount} judged cycles — conserved counters still hold, ` +
            `but nothing fitted (pools, caches, heaps) was judged. Run at least ${MIN_FITTED_SAMPLES + 3}.`,
        );
    }
    if (report.failedProbes.length > 0) {
        lines.push('  probes that stopped answering (counters MISSING, not zero):');
        for (const f of report.failedProbes) lines.push(`    ! ${f}`);
    }
    if (report.leaks.length === 0) {
        lines.push('  no counter drifted beyond its tier');
    } else {
        lines.push(`  ${report.leaks.length} leaking:`);
        for (const v of report.leaks) lines.push(`    ✗ ${v.key} — ${v.reason}`);
    }
    const steady = report.verdicts.filter((v) => !v.leaking);
    if (steady.length > 0) {
        const width = Math.max(...steady.map((v) => v.key.length));
        lines.push('  steady:');
        for (const v of steady) {
            // Both numbers: the raw slope says what was measured, the confident
            // one says how much of it the samples support. A wide gap between
            // them is the signal to run more cycles, not to trust either.
            const claim = v.tier === 'conserved' ? '' : ` ≥${signed(v.confidentSlopePerCycle, v.unit)}`;
            lines.push(
                `    ${v.key.padEnd(width)}  ${fmt(v.last, v.unit)}  ` +
                `(${signed(v.slopePerCycle, v.unit)}/cycle${claim}) [${v.tier}]`,
            );
        }
    }
    return lines.join('\n');
}
