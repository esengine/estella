// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelExpr.ts — the sums a model source may hold in place of a number.
 *
 *        A value written `"=length * 0.4"` is worked out when the model is built. It is arithmetic and nothing more: no
 *        assignment, no branching, no way to loop. What it adds to plain numbers is vectors (a point is `[x, y, z]`,
 *        and points add and scale) and the few makers a shape keeps asking for: a point round an axis, a line that
 *        bends, a part of a line.
 *
 *        Angles are degrees everywhere, as they are in every step.
 */
import { hash3 } from './hash';

export type ExprValue = number | ExprValue[];
export type ExprScope = ReadonlyMap<string, ExprValue>;

const DEG = Math.PI / 180;
const isVec = (v: ExprValue): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

function num(v: ExprValue, what: string): number {
    if (typeof v !== 'number') throw new Error(`${what} must be a number, not a list`);
    return v;
}

function vec3(v: ExprValue, what: string): [number, number, number] {
    if (!isVec(v) || v.length !== 3) throw new Error(`${what} must be a point [x, y, z]`);
    return v as [number, number, number];
}

function points(v: ExprValue, what: string): [number, number, number][] {
    if (!Array.isArray(v) || v.length < 2 || !v.every((p) => isVec(p as ExprValue) && (p as number[]).length === 3)) {
        throw new Error(`${what} must be a line of two points or more`);
    }
    return v as [number, number, number][];
}

/** Number with number, or a list with a number or a list of its own length, item by item. */
function each(a: ExprValue, b: ExprValue, f: (x: number, y: number) => number, sign: string): ExprValue {
    if (typeof a === 'number' && typeof b === 'number') return f(a, b);
    if (Array.isArray(a) && typeof b === 'number') return a.map((x) => each(x, b, f, sign));
    if (typeof a === 'number' && Array.isArray(b)) return b.map((y) => each(a, y, f, sign));
    const [x, y] = [a as ExprValue[], b as ExprValue[]];
    if (x.length !== y.length) throw new Error(`\`${sign}\` between lists of ${x.length} and ${y.length}`);
    return x.map((v, i) => each(v, y[i]!, f, sign));
}

const len = (v: number[]): number => Math.hypot(...v);

/** Where a line of points is at @p t of its length, 0..1. */
function alongLine(line: [number, number, number][], t: number): [number, number, number] {
    const walked = [0];
    for (let i = 1; i < line.length; i++) walked.push(walked[i - 1]! + len(line[i]!.map((v, k) => v - line[i - 1]![k]!)));
    const want = Math.min(1, Math.max(0, t)) * walked.at(-1)!;
    let k = 1;
    while (k < line.length - 1 && walked[k]! < want) k++;
    const span = walked[k]! - walked[k - 1]!;
    const w = span > 0 ? (want - walked[k - 1]!) / span : 0;
    return line[k - 1]!.map((v, i) => v + (line[k]![i]! - v) * w) as [number, number, number];
}

type Fn = (args: ExprValue[]) => ExprValue;
const unary = (name: string, f: (x: number) => number): Fn => (a) => {
    if (a.length !== 1) throw new Error(`${name} takes one value`);
    return f(num(a[0]!, name));
};
const takes = (name: string, a: ExprValue[], min: number, max = min): void => {
    if (a.length < min || a.length > max) throw new Error(`${name} takes ${min === max ? min : `${min} to ${max}`} values, not ${a.length}`);
};

/** What a sum may call. Each says, in {@link EXPR_HELP}, what it gives. */
const FUNCTIONS: Record<string, Fn> = {
    sin: unary('sin', (x) => Math.sin(x * DEG)),
    cos: unary('cos', (x) => Math.cos(x * DEG)),
    tan: unary('tan', (x) => Math.tan(x * DEG)),
    asin: unary('asin', (x) => Math.asin(x) / DEG),
    acos: unary('acos', (x) => Math.acos(x) / DEG),
    atan: unary('atan', (x) => Math.atan(x) / DEG),
    sqrt: unary('sqrt', Math.sqrt),
    abs: unary('abs', Math.abs),
    floor: unary('floor', Math.floor),
    ceil: unary('ceil', Math.ceil),
    round: unary('round', Math.round),
    atan2: (a) => { takes('atan2', a, 2); return Math.atan2(num(a[0]!, 'atan2'), num(a[1]!, 'atan2')) / DEG; },
    min: (a) => { takes('min', a, 1, 99); return Math.min(...a.map((v) => num(v, 'min'))); },
    max: (a) => { takes('max', a, 1, 99); return Math.max(...a.map((v) => num(v, 'max'))); },
    clamp: (a) => { takes('clamp', a, 3); return Math.min(num(a[2]!, 'clamp'), Math.max(num(a[1]!, 'clamp'), num(a[0]!, 'clamp'))); },
    mix: (a) => {
        takes('mix', a, 3);
        const t = num(a[2]!, 'mix');
        return each(a[0]!, a[1]!, (x, y) => x + (y - x) * t, 'mix');
    },
    smooth: unary('smooth', (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }),
    /** The same number for the same key, 0..1 or between two given: a size that differs from copy to copy and not from build to build. */
    rand: (a) => {
        takes('rand', a, 1, 3);
        const r = hash3(num(a[0]!, 'rand'), 17, 91, 5) * 0.5 + 0.5;
        return a.length === 3 ? num(a[1]!, 'rand') + (num(a[2]!, 'rand') - num(a[1]!, 'rand')) * r : r;
    },
    len: (a) => { takes('len', a, 1); if (!isVec(a[0]!)) throw new Error('len takes a point'); return len(a[0] as number[]); },
    count: (a) => { takes('count', a, 1); if (!Array.isArray(a[0])) throw new Error('count takes a list'); return (a[0] as ExprValue[]).length; },
    norm: (a) => {
        takes('norm', a, 1);
        if (!isVec(a[0]!)) throw new Error('norm takes a point');
        const l = len(a[0] as number[]);
        if (!(l > 0)) throw new Error('norm of a point at the origin has no direction');
        return (a[0] as number[]).map((v) => v / l);
    },
    dot: (a) => { takes('dot', a, 2); const [p, q] = [vec3(a[0]!, 'dot'), vec3(a[1]!, 'dot')]; return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; },
    cross: (a) => {
        takes('cross', a, 2);
        const [p, q] = [vec3(a[0]!, 'cross'), vec3(a[1]!, 'cross')];
        return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    },
    /** A point round the upright axis: `angle` from +z toward +x, `radius` out, `y` up. */
    polar: (a) => {
        takes('polar', a, 2, 3);
        const [angle, radius] = [num(a[0]!, 'polar'), num(a[1]!, 'polar')];
        return [Math.sin(angle * DEG) * radius, a[2] === undefined ? 0 : num(a[2], 'polar'), Math.cos(angle * DEG) * radius];
    },
    /**
     * A line that bends: from `start`, `length` long, leaning `from` degrees off upright where it begins and `to` where it
     * ends, toward `toward`. `power` above 1 keeps it straight for longer before it turns. A frond, a horn, a tail, a cable.
     */
    arc: (a) => {
        takes('arc', a, 5, 7);
        const start = vec3(a[0]!, 'arc start');
        const toward = vec3(a[1]!, 'arc toward');
        const flat = len([toward[0], toward[2]]);
        if (!(flat > 1e-9)) throw new Error('arc leans toward a direction, and straight up or down is not one');
        const lean: [number, number, number] = [toward[0] / flat, 0, toward[2] / flat];
        const [length, from, to] = [num(a[2]!, 'arc length'), num(a[3]!, 'arc from'), num(a[4]!, 'arc to')];
        const power = a[5] === undefined ? 1 : num(a[5], 'arc power');
        const steps = a[6] === undefined ? 10 : num(a[6], 'arc points');
        if (!(length > 0)) throw new Error('arc length must be positive');
        if (!Number.isInteger(steps) || steps < 1 || steps > 200) throw new Error('arc points must be a whole number, 1..200');
        const line: [number, number, number][] = [start];
        let at = start;
        for (let k = 1; k <= steps; k++) {
            const angle = (from + (to - from) * Math.pow((k - 0.5) / steps, power)) * DEG;
            const [up, out] = [(Math.cos(angle) * length) / steps, (Math.sin(angle) * length) / steps];
            at = [at[0] + lean[0] * out, at[1] + up, at[2] + lean[2] * out];
            line.push(at);
        }
        return line;
    },
    /** The part of a line between two shares of its length: where a stem carries its leaves. */
    part: (a) => {
        takes('part', a, 3);
        const line = points(a[0]!, 'part');
        const [from, to] = [num(a[1]!, 'part from'), num(a[2]!, 'part to')];
        if (!(from >= 0 && to <= 1 && from < to)) throw new Error('part takes shares of the length, 0..1, the first below the second');
        const walked = [0];
        for (let i = 1; i < line.length; i++) walked.push(walked[i - 1]! + len(line[i]!.map((v, k) => v - line[i - 1]![k]!)));
        const whole = walked.at(-1)!;
        const inside = line.filter((_, i) => walked[i]! > from * whole + 1e-9 && walked[i]! < to * whole - 1e-9);
        return [alongLine(line, from), ...inside, alongLine(line, to)];
    },
    /** Where a line is at a share of its length. */
    along: (a) => { takes('along', a, 2); return alongLine(points(a[0]!, 'along'), num(a[1]!, 'along')); },
    /** The way a line runs at a share of its length, one unit long. */
    heading: (a) => {
        takes('heading', a, 2);
        const line = points(a[0]!, 'heading');
        const t = num(a[1]!, 'heading');
        const [p, q] = [alongLine(line, Math.max(0, t - 0.01)), alongLine(line, Math.min(1, t + 0.01))];
        const d = q.map((v, i) => v - p[i]!);
        const l = len(d);
        if (!(l > 0)) throw new Error('heading of a line with no length');
        return d.map((v) => v / l);
    },
};

/** One line for the tool text: what a sum may use. */
export const EXPR_HELP = '+ - * / % ^ and ( ); points as [x, y, z], which add, and scale by a number; angles in degrees; pi; '
    + 'sin cos tan asin acos atan atan2 sqrt abs floor ceil round min max clamp(v, lo, hi) mix(a, b, t) smooth(t) rand(key, lo?, hi?); '
    + 'len norm dot cross; polar(angle, radius, y?) a point round the upright axis; '
    + 'arc(start, toward, length, from, to, power?, points?) a line that bends from one lean to another; '
    + 'part(line, from, to), along(line, t), heading(line, t); count(list); list[i]';

interface Token { kind: 'num' | 'name' | 'op'; text: string; at: number }

function tokens(source: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < source.length) {
        const c = source[i]!;
        if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
        const number = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(source.slice(i));
        if (number) { out.push({ kind: 'num', text: number[0], at: i }); i += number[0].length; continue; }
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
        if (name) { out.push({ kind: 'name', text: name[0], at: i }); i += name[0].length; continue; }
        if ('+-*/%^()[],'.includes(c)) { out.push({ kind: 'op', text: c, at: i }); i++; continue; }
        throw new Error(`"${c}" at ${i} is not part of a sum`);
    }
    return out;
}

/** Works @p source out against @p scope. Throws an Error that says what is wrong with it. */
export function evaluate(source: string, scope: ExprScope): ExprValue {
    const list = tokens(source);
    let at = 0;
    const peek = (): Token | undefined => list[at];
    const is = (text: string): boolean => peek()?.kind === 'op' && peek()!.text === text;
    const take = (text: string): void => {
        if (!is(text)) throw new Error(peek() ? `expected "${text}" at ${peek()!.at}, found "${peek()!.text}"` : `expected "${text}" at the end`);
        at++;
    };

    const listOf = (close: string): ExprValue[] => {
        const items: ExprValue[] = [];
        if (!is(close)) {
            do items.push(sum()); while (is(',') && ++at);
        }
        take(close);
        return items;
    };

    function primary(): ExprValue {
        const t = peek();
        if (!t) throw new Error('the sum stops short');
        at++;
        if (t.kind === 'num') return Number(t.text);
        if (t.kind === 'name') {
            if (is('(')) {
                at++;
                const fn = FUNCTIONS[t.text];
                if (!fn) throw new Error(`there is no ${t.text}(); there are ${Object.keys(FUNCTIONS).join(', ')}`);
                return fn(listOf(')'));
            }
            if (t.text === 'pi') return Math.PI;
            const value = scope.get(t.text);
            if (value === undefined) throw new Error(`"${t.text}" is not a name here; there are ${[...scope.keys()].join(', ') || 'none'}`);
            return value;
        }
        if (t.text === '(') { const v = sum(); take(')'); return v; }
        if (t.text === '[') return listOf(']');
        throw new Error(`"${t.text}" at ${t.at} is not where a value goes`);
    }

    function indexed(): ExprValue {
        let v = primary();
        while (is('[')) {
            at++;
            const i = num(sum(), 'an index');
            take(']');
            if (!Array.isArray(v)) throw new Error('only a list has items');
            if (!Number.isInteger(i) || i < 0 || i >= v.length) throw new Error(`item ${i} of a list of ${v.length}`);
            v = v[i]!;
        }
        return v;
    }

    function signed(): ExprValue {
        if (is('-')) { at++; return each(0, signed(), (x, y) => x - y, '-'); }
        if (is('+')) { at++; return signed(); }
        const base = indexed();
        if (is('^')) { at++; return Math.pow(num(base, 'what is raised'), num(signed(), 'a power')); }
        return base;
    }

    function product(): ExprValue {
        let v = signed();
        for (;;) {
            if (is('*')) {
                at++;
                const r = signed();
                if (Array.isArray(v) && Array.isArray(r)) throw new Error('two lists do not multiply; use dot(a, b), or scale one by a number');
                v = each(v, r, (x, y) => x * y, '*');
            } else if (is('/')) {
                at++;
                const r = num(signed(), 'what divides');
                if (r === 0) throw new Error('division by zero');
                v = each(v, r, (x, y) => x / y, '/');
            } else if (is('%')) {
                at++;
                const r = num(signed(), 'what divides');
                if (r === 0) throw new Error('division by zero');
                v = ((num(v, 'what is divided') % r) + r) % r;
            } else return v;
        }
    }

    function sum(): ExprValue {
        let v = product();
        for (;;) {
            if (is('+')) { at++; v = each(v, product(), (x, y) => x + y, '+'); }
            else if (is('-')) { at++; v = each(v, product(), (x, y) => x - y, '-'); }
            else return v;
        }
    }

    const value = sum();
    if (peek()) throw new Error(`"${peek()!.text}" at ${peek()!.at} is left over`);
    const finite = (v: ExprValue): boolean => (typeof v === 'number' ? Number.isFinite(v) : v.every(finite));
    if (!finite(value)) throw new Error('it comes to a value that is not a number');
    return value;
}
