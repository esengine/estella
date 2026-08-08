// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The scale harness: measure one cost against the stress corpus and hold
 *        it to a declared budget.
 *
 * WHY A BUDGET AND NOT A SNAPSHOT. The perf snapshot (`tools/perf-guard.mjs`)
 * answers "did this change make it worse", which is the right question for an
 * architectural invariant and the wrong one here. A snapshot can always be
 * accepted with `--update`, so a feature that takes scene-open from 200ms to
 * 900ms passes by rewriting the number it is compared against. A budget cannot
 * be updated by the change that breaks it: it is a ceiling somebody chose, with
 * a reason next to it, and going over is a decision rather than a diff.
 *
 * HOW A BUDGET SURVIVES A DIFFERENT MACHINE. Milliseconds do not — the CI runner
 * has two shared cores and this laptop does not — so a budget is denominated in
 * CALIBRATION UNITS. Each run measures a fixed reference workload and every
 * metric is reported as its own cost divided by that reference. There are three
 * references because there are three kinds of cost here, and one of them cannot
 * stand in for another: `parse` (JSON + object churn), `loop` (tight numeric
 * iteration) and `io` (reading small files off disk). A metric names the one that
 * matches its shape, so "cold scan = 30 io" means "thirty times what reading a
 * fixed pile of files costs on whatever machine this is".
 *
 * THE STATISTIC IS `min`, for the reason the perf guard already documents: noise
 * on a shared runner is one-sided, so the fastest sample is the one closest to
 * what the code costs.
 *
 * Raw milliseconds are recorded too. They are the number a human wants when
 * reading the report; they are not the number the gate uses.
 */
import { expect } from 'vitest';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const REPORT_PATH = path.join(REPO, 'build', 'scale-report.json');

/**
 * A metric's denominator. `MB` and `count` have none: bytes and draw calls are
 * already machine-independent, so their budgets are absolute.
 */
export type Unit = 'parse' | 'loop' | 'io' | 'MB' | 'count';

export interface MetricSpec {
    /** What the metric measures, as it appears in the report. */
    name: string;
    /** The heading it is filed under. */
    group: string;
    unit: Unit;
    /** The ceiling, in `unit`. Going over fails the run. */
    budget: number;
    /** Why this ceiling and what breaking it would mean. Printed on failure. */
    why: string;
    /** Timed metrics only: how many samples to take the minimum of. */
    runs?: number;
    /**
     * Untimed runs first. Needed wherever the first call does less work than the
     * rest — resetting a world that is still empty despawns nothing, and a `min`
     * over those samples would report the one run that skipped half the job.
     */
    warmup?: number;
}

export interface MetricRecord extends MetricSpec {
    measured: number;
    rawMs: number | null;
    pctOfBudget: number;
}

const records: MetricRecord[] = [];

// --- Calibration -----------------------------------------------------------
// Each reference is fixed and shaped like the metrics that divide by it, and
// measured once per process.

const CALIBRATION_RUNS = 7;

let units: Record<'parse' | 'loop' | 'io', number> | null = null;

/** A fixed document to parse — built, never read from disk, so it is identical everywhere. */
function calibrationDocument(): string {
    const rows = [];
    for (let i = 0; i < 6000; i++) {
        rows.push({
            id: i,
            name: `entry-${i}`,
            nested: { a: i * 1.5, b: [i, i + 1, i + 2], c: `${i}` },
            tags: ['alpha', 'beta', 'gamma'],
        });
    }
    return JSON.stringify({ version: 1, rows });
}

function walkSum(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) {
        let s = 0;
        for (const x of v) s += walkSum(x);
        return s;
    }
    if (v && typeof v === 'object') {
        let s = 0;
        for (const x of Object.values(v)) s += walkSum(x);
        return s;
    }
    return 0;
}

function loopWorkload(): number {
    const lanes = new Float32Array(1 << 21);
    for (let i = 0; i < lanes.length; i++) lanes[i] = i * 0.5;
    let acc = 0;
    for (let i = 0; i < lanes.length; i++) acc += lanes[i] * 1.0001 + 1;
    return acc;
}

/**
 * The io reference walks part of the corpus the way the scan walks all of it:
 * `readdir` over twenty directories, then read and parse every `.meta`. One
 * folder instead stays in the page cache and measures syscall cost, a regime
 * the 100,000-file scan is never in — that reference moved the ratio backwards.
 */
async function ioWorkload(corpusDir: string): Promise<number> {
    const files = ioFiles(corpusDir);
    let bytes = 0;
    const LIMIT = 32;
    for (let i = 0; i < files.length; i += LIMIT) {
        const slice = files.slice(i, i + LIMIT);
        const results = await Promise.all(slice.map(async (f) => {
            const [s, body] = await Promise.all([stat(f), readFile(f, 'utf8')]);
            return s.size + JSON.parse(body).uuid.length;
        }));
        for (const r of results) bytes += r;
    }
    return bytes;
}

const IO_REFERENCE_SHARDS = 20;
const IO_REFERENCE_FILES = 10_000;
let ioFileList: string[] | null = null;

function ioFiles(corpusDir: string): string[] {
    if (ioFileList) return ioFileList;
    const textures = path.join(corpusDir, 'assets/textures');
    const shards = readdirSync(textures).filter((d) => d.startsWith('shard-')).sort().slice(0, IO_REFERENCE_SHARDS);
    const out: string[] = [];
    for (const shard of shards) {
        const dir = path.join(textures, shard);
        for (const f of readdirSync(dir).sort()) if (f.endsWith('.meta')) out.push(path.join(dir, f));
    }
    if (out.length !== IO_REFERENCE_FILES) {
        throw new Error(`io calibration expects ${IO_REFERENCE_FILES} files across ${IO_REFERENCE_SHARDS} `
            + `shards of ${textures}, found ${out.length} — the corpus was generated at a reduced `
            + '--scale, and budgets do not apply to it.');
    }
    ioFileList = out;
    return ioFileList;
}

/**
 * Measure the three references. Every suite calls this and only the first one
 * does the work: calibrating again half way through a run would denominate the
 * later metrics in a different machine-state than the earlier ones, and the
 * report is one table.
 */
export async function calibrate(corpusDir: string): Promise<Record<string, number>> {
    if (units) return units;
    const doc = calibrationDocument();
    const parse = minOf(CALIBRATION_RUNS, () => { walkSum(JSON.parse(doc)); });
    const loop = minOf(CALIBRATION_RUNS, () => { loopWorkload(); });
    let io = Infinity;
    for (let i = 0; i < 3; i++) {
        const t = performance.now();
        await ioWorkload(corpusDir);
        io = Math.min(io, performance.now() - t);
    }
    units = { parse, loop, io };
    return units;
}

function minOf(runs: number, fn: () => void): number {
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
        const t = performance.now();
        fn();
        best = Math.min(best, performance.now() - t);
    }
    return best;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Time `fn` and hold the result to `spec.budget`. Returns whatever `fn` returned
 * on its last run, so a metric can assert on the work as well as its cost.
 */
export async function budgeted<T>(spec: MetricSpec, fn: () => Promise<T> | T): Promise<T> {
    if (spec.unit === 'MB' || spec.unit === 'count') {
        throw new Error(`${spec.name}: ${spec.unit} is a value, not a duration — use budgetedValue`);
    }
    if (!units) throw new Error('calibrate() was never called — every budget would be meaningless');

    const runs = spec.runs ?? 3;
    let best = Infinity;
    let last!: T;
    for (let i = 0; i < (spec.warmup ?? 0); i++) last = await fn();
    for (let i = 0; i < runs; i++) {
        const t = performance.now();
        last = await fn();
        best = Math.min(best, performance.now() - t);
    }
    record(spec, best / units[spec.unit], best);
    return last;
}

/** The same contract for a metric that is already a number: bytes, or a count. */
export async function budgetedValue(spec: MetricSpec, fn: () => Promise<number> | number): Promise<number> {
    if (spec.unit !== 'MB' && spec.unit !== 'count') {
        throw new Error(`${spec.name}: ${spec.unit} is a duration — use budgeted`);
    }
    const value = await fn();
    record(spec, value, null);
    return value;
}

function record(spec: MetricSpec, measured: number, rawMs: number | null): void {
    const rec: MetricRecord = {
        ...spec,
        measured: round(measured),
        rawMs: rawMs === null ? null : round(rawMs),
        pctOfBudget: Math.round((measured / spec.budget) * 100),
    };
    records.push(rec);
    void persist();

    // The failure message has to carry the reason, because whoever reads it in a
    // CI log has neither this file nor the budget table in front of them.
    expect(
        measured,
        `\n  ${spec.name}\n`
        + `    measured ${rec.measured}${suffix(spec.unit)}, budget ${spec.budget}${suffix(spec.unit)}`
        + `${rawMs === null ? '' : ` (${rec.rawMs}ms on this machine)`}\n`
        + `    ${spec.why}\n`
        + '    If this cost is now correct, raise the budget in the file that declares it —\n'
        + '    deliberately, in its own commit, with the reason updated.\n',
    ).toBeLessThanOrEqual(spec.budget);
}

const suffix = (u: Unit) => (u === 'MB' ? 'MB' : u === 'count' ? '' : ` ${u}`);
const round = (n: number) => Number(n.toPrecision(4));

/**
 * The report is rewritten after every metric rather than at the end, so a run
 * that dies half way still says what it managed to measure.
 */
async function persist(): Promise<void> {
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify({
        note: 'Generated by the scale suite — see bench/scale/README.md.',
        units,
        metrics: records,
    }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** Where the generator put it, unless $ESTELLA_STRESS_PROJECT says otherwise. */
export function corpusDir(): string {
    const dir = process.env.ESTELLA_STRESS_PROJECT ?? path.join(REPO, 'build', 'stress-project');
    if (!existsSync(path.join(dir, 'project.esproject'))) {
        throw new Error(`No stress corpus at ${dir}. Generate it: node tools/stress-project.mjs`);
    }
    return dir;
}
