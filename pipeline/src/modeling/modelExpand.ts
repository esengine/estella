// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelExpand.ts — a model source's names, sums and repeats, turned into the plain steps the build runs.
 *
 *        A model is the steps that build it, and a shape with ten fronds was ten times the steps: the numbers that make a
 *        frond were written out for each, so making every frond a little longer was ten edits. Three things take that away,
 *        and none of them is a programming language:
 *
 *          * `params` names numbers once: `{ "length": 1.9 }`.
 *          * A value written `"=length * 0.4"` is a sum over those names (modelExpr.ts).
 *          * `{ "op": "repeat", "over": [ ...rows ], "steps": [ ... ] }` runs its steps once for each row, the row's fields
 *            being names inside it; `count` in place of `over` runs them that many times. `{ "op": "let", ... }` names a
 *            value for the steps that follow it.
 *
 *        What comes out is a source of plain steps with plain numbers, which is what everything downstream reads. What
 *        is saved, and what an edit changes, is the source as written.
 */
import { evaluate, type ExprScope, type ExprValue } from './modelExpr';

const MAX_STEPS = 5000;
const MAX_DEPTH = 6;
const RESERVED = new Set(['i', 't', 'n', 'pi']);

/** Where an expanded step came from, for a refusal to name: "step 3 (repeat) row 2 > step 1 (loft)". */
export interface ExpandedStep {
    step: Record<string, unknown>;
    where: string;
    /** The top-level step of the source as written. */
    index: number;
}

export interface Expansion {
    steps: ExpandedStep[];
    /** Whether the source used a name, a sum or a repeat at all. */
    used: boolean;
}

export class ModelExpandError extends Error {
    constructor(message: string, readonly index: number | null) { super(message); }
}

const isSum = (v: unknown): v is string => typeof v === 'string' && v.startsWith('=');

function resolve(value: unknown, scope: ExprScope, what: string): unknown {
    if (isSum(value)) {
        try {
            return evaluate(value.slice(1), scope);
        } catch (e) {
            throw new Error(`${what} ${JSON.stringify(value)}: ${(e as Error).message}`);
        }
    }
    if (Array.isArray(value)) return value.map((v, i) => resolve(v, scope, `${what}[${i}]`));
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, scope, `${what}.${k}`)]));
    }
    return value;
}

const holdsSum = (value: unknown): boolean =>
    isSum(value) || (Array.isArray(value) ? value.some(holdsSum) : typeof value === 'object' && value !== null && Object.values(value).some(holdsSum));

function asValue(value: unknown, what: string): ExprValue {
    const ok = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) && v.every(ok));
    if (!ok(value)) throw new Error(`${what} must be a number, or a list of them`);
    return value as ExprValue;
}

/** Whether @p steps hold anything this file turns into something else. */
export function needsExpanding(source: { params?: unknown; steps?: unknown }): boolean {
    if (source.params !== undefined) return true;
    return Array.isArray(source.steps) && source.steps.some((s) => typeof s === 'object' && s !== null
        && ((s as { op?: unknown }).op === 'repeat' || (s as { op?: unknown }).op === 'let' || holdsSum(s)));
}

/** The names a source's `params` give, each worked out in the order written: a later one may use an earlier. */
export function paramScope(params: unknown): Map<string, ExprValue> {
    const scope = new Map<string, ExprValue>();
    if (params === undefined) return scope;
    if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new ModelExpandError('params must be an object of names', null);
    for (const [name, raw] of Object.entries(params)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new ModelExpandError(`params: "${name}" is not a name; letters, digits and _, not starting with a digit`, null);
        if (RESERVED.has(name)) throw new ModelExpandError(`params: "${name}" is taken: a repeat gives i, t and n, and pi is pi`, null);
        try {
            scope.set(name, asValue(resolve(raw, scope, `params.${name}`), `params.${name}`));
        } catch (e) {
            throw new ModelExpandError((e as Error).message, null);
        }
    }
    return scope;
}

/** The plain steps @p source builds from. Throws a {@link ModelExpandError} naming the step as written. */
export function expandSteps(source: { params?: unknown; steps: readonly unknown[] }): Expansion {
    const out: ExpandedStep[] = [];
    let used = source.params !== undefined;

    const run = (steps: readonly unknown[], outer: ExprScope, path: string, top: number | null, depth: number): void => {
        // A `let` names a value for the steps after it in this list, and in the lists inside them.
        const scope = new Map(outer);
        steps.forEach((raw, i) => {
            const index = top ?? i;
            const fail = (what: string): never => { throw new ModelExpandError(`${where}: ${what}`, index); };
            const op = typeof raw === 'object' && raw !== null ? (raw as { op?: unknown }).op : undefined;
            const where = `${path}step ${i}${typeof op === 'string' ? ` (${op})` : ''}`;
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                out.push({ step: raw as never, where, index });
                return;
            }
            const step = raw as Record<string, unknown>;

            if (op === 'let') {
                used = true;
                for (const [name, value] of Object.entries(step)) {
                    if (name === 'op') continue;
                    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`"${name}" is not a name`);
                    if (RESERVED.has(name)) fail(`"${name}" is taken: a repeat gives i, t and n, and pi is pi`);
                    try {
                        scope.set(name, asValue(resolve(value, scope, name), name));
                    } catch (e) {
                        fail((e as Error).message);
                    }
                }
                return;
            }

            if (op === 'repeat') {
                used = true;
                if (depth >= MAX_DEPTH) fail(`repeats go ${MAX_DEPTH} deep and no further`);
                for (const key of Object.keys(step)) if (!['op', 'count', 'over', 'steps'].includes(key)) fail(`unknown field "${key}"; repeat takes count or over, and steps`);
                if (!Array.isArray(step.steps) || step.steps.length === 0) fail('`steps` is what it repeats: give one or more');
                if ((step.count === undefined) === (step.over === undefined)) fail('say how many times with one of `count` or `over`');
                let rows: Record<string, unknown>[];
                try {
                    if (step.over !== undefined) {
                        if (!Array.isArray(step.over) || step.over.length === 0 || step.over.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
                            throw new Error('`over` must be a list of rows, each an object of names');
                        }
                        rows = step.over as Record<string, unknown>[];
                    } else {
                        const count = resolve(step.count, scope, 'count');
                        if (!Number.isInteger(count) || (count as number) < 1) throw new Error(`count ${JSON.stringify(count)} must be a whole number of 1 or more`);
                        rows = Array.from({ length: count as number }, () => ({}));
                    }
                } catch (e) {
                    return fail((e as Error).message);
                }
                rows.forEach((row, r) => {
                    const inner = new Map(scope);
                    inner.set('i', r);
                    inner.set('n', rows.length);
                    inner.set('t', rows.length > 1 ? r / (rows.length - 1) : 0);
                    for (const [name, value] of Object.entries(row)) {
                        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED.has(name)) fail(`row ${r}: "${name}" cannot be a name`);
                        try {
                            inner.set(name, asValue(resolve(value, inner, name), `row ${r}: ${name}`));
                        } catch (e) {
                            fail((e as Error).message);
                        }
                    }
                    run(step.steps as unknown[], inner, `${where} row ${r} > `, index, depth + 1);
                });
                return;
            }

            if (!used && holdsSum(step)) used = true;
            let plain: Record<string, unknown>;
            try {
                plain = Object.fromEntries(Object.entries(step).map(([k, v]) => [k, k === 'op' || k === 'id' ? v : resolve(v, scope, `\`${k}\``)]));
            } catch (e) {
                return fail((e as Error).message);
            }
            out.push({ step: plain, where, index });
            if (out.length > MAX_STEPS) fail(`the repeats come to more than ${MAX_STEPS} steps`);
        });
    };

    run(source.steps, paramScope(source.params), '', null, 0);
    return { steps: out, used };
}
