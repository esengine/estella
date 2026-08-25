// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    interp.ts
 * @brief   A reference interpreter for EIR-high (docs/REARCH_AOT.md §8.1).
 *
 * @details Written before any code generation, for two reasons. It proves the IR
 *          means something on its own, and it is the third implementation a
 *          differential test needs: when compiled output and node disagree, an
 *          oracle that is neither says which one is wrong.
 *
 *          Deliberately dumb — a tree walk with no caching. Its job is to be
 *          obviously correct, not fast; anything clever here would be a second
 *          place for a bug to hide from the backend it exists to check.
 */
import type { EirSystem, Expr, Local, Place, QueryArg, Stmt } from './eir';

/** One component instance, nested exactly as a system reads it. */
export type Row = Record<string, unknown>;

export interface EirWorld {
    /** Entity ids in the order a query walks them. */
    readonly entities: readonly number[];
    /** component name -> entity -> its row. An absent entity simply has none. */
    readonly comps: ReadonlyMap<string, Map<number, Row>>;
    readonly resources: ReadonlyMap<string, Row>;
}

class Frame {
    private readonly slots = new Map<number, unknown>();
    set(id: number, v: unknown): void { this.slots.set(id, v); }
    get(id: number): unknown {
        if (!this.slots.has(id)) throw new Error(`EIR: local %${id} read before it was bound`);
        return this.slots.get(id);
    }
}

function walk(root: unknown, path: readonly string[]): { owner: Record<string, unknown>; key: string } {
    let cur = root as Record<string, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
        const next = cur[path[i]!];
        if (next === null || typeof next !== 'object') {
            throw new Error(`EIR: '${path.slice(0, i + 1).join('.')}' is not a value with fields`);
        }
        cur = next as Record<string, unknown>;
    }
    return { owner: cur, key: path[path.length - 1]! };
}

function readPlace(p: Place, frame: Frame): unknown {
    if (p.p === 'local') return frame.get(p.id);
    const base = readPlace(p.base, frame);
    const { owner, key } = walk(base, p.path);
    return owner[key];
}

function writePlace(p: Place, frame: Frame, value: unknown): void {
    if (p.p === 'local') { frame.set(p.id, value); return; }
    const base = readPlace(p.base, frame);
    const { owner, key } = walk(base, p.path);
    owner[key] = value;
}

function evalExpr(e: Expr, frame: Frame): number | boolean {
    switch (e.e) {
        case 'const': return e.value;
        case 'read': return readPlace(e.place, frame) as number | boolean;
        case 'neg': return -(evalExpr(e.v, frame) as number);
        case 'not': return !(evalExpr(e.v, frame) as boolean);
        case 'select':
            return evalExpr(e.cond, frame) ? evalExpr(e.then, frame) : evalExpr(e.otherwise, frame);
        case 'call': {
            const a = e.args.map((x) => evalExpr(x, frame) as number);
            // The frontend admits only the exactly-specified operations, so
            // deferring to the host's Math is the same answer everywhere.
            const fn = (Math as unknown as Record<string, (...xs: number[]) => number>)[e.fn]!;
            return fn(...a);
        }
        case 'logic': {
            // Short-circuit, which is why this is not a `bin`: `a && b(…)` must
            // not evaluate b when a is false.
            const l = evalExpr(e.l, frame) as boolean;
            if (e.op === '&&') return l ? (evalExpr(e.r, frame) as boolean) : false;
            return l ? true : (evalExpr(e.r, frame) as boolean);
        }
        case 'bin': {
            const l = evalExpr(e.l, frame) as number;
            const r = evalExpr(e.r, frame) as number;
            switch (e.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
                case '%': return l % r;
                case '<': return l < r;
                case '<=': return l <= r;
                case '>': return l > r;
                case '>=': return l >= r;
                case '==': return l === r;
                case '!=': return l !== r;
            }
        }
    }
}

/** Entities carrying every component the query names, in world order. */
function matching(world: EirWorld, args: readonly QueryArg[]): number[] {
    return world.entities.filter((e) => args.every((a) => world.comps.get(a.comp)?.has(e)));
}

function exec(stmts: readonly Stmt[], frame: Frame, world: EirWorld): void {
    for (const s of stmts) {
        switch (s.s) {
            case 'let':
                frame.set(s.id, evalExpr(s.value, frame));
                break;
            case 'assign':
                writePlace(s.target, frame, evalExpr(s.value, frame));
                break;
            case 'if':
                if (evalExpr(s.cond, frame)) exec(s.then, frame, world);
                else exec(s.otherwise, frame, world);
                break;
            case 'rowLoop': {
                const q = readPlace(s.query, frame) as { args: readonly QueryArg[] };
                for (const entity of matching(world, q.args)) {
                    if (s.entity !== null) frame.set(s.entity, entity);
                    s.binds.forEach((id, i) => {
                        frame.set(id, world.comps.get(q.args[i]!.comp)!.get(entity)!);
                    });
                    exec(s.body, frame, world);
                }
                break;
            }
        }
    }
}

/**
 * Run `sys` against `world`, mutating it in place. Parameters are bound from
 * their declared types: a query becomes its own argument list, a resource its
 * row — the same two things the SDK's runner resolves.
 */
export function runSystem(sys: EirSystem, world: EirWorld): void {
    const frame = new Frame();
    for (const p of sys.params) bindParam(p, frame, world);
    exec(sys.body, frame, world);
}

function bindParam(p: Local, frame: Frame, world: EirWorld): void {
    if (p.type.k === 'query') { frame.set(p.id, { args: p.type.args }); return; }
    if (p.type.k === 'res') {
        const row = world.resources.get(p.type.name);
        if (!row) throw new Error(`EIR: no resource '${p.type.name}' in the world`);
        frame.set(p.id, row);
        return;
    }
    throw new Error(`EIR: '${p.name}' has no parameter binding for ${p.type.k}`);
}
