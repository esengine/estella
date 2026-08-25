// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    inline.ts
 * @brief   The first EIR -> EIR pass: calls to pure functions become their bodies.
 *
 * @details A helper called once per row must not still be a call by the time the
 *          backend sees it — copy elimination and archetype specialisation need
 *          the body visible, and a call boundary hides it.
 *
 *          It is a PASS, not something the frontend does, and that is the point.
 *          The frontend lowers faithfully; every optimisation after it is an
 *          EIR -> EIR function whose result the differential re-checks against
 *          node. Stage 3's copy-elimination and archetype specialisation are the
 *          same shape, so this is where that discipline starts.
 *
 *          Arguments are bound to `let` temporaries hoisted before the statement
 *          rather than substituted into the body. Substituting would duplicate an
 *          argument once per use — `clamp`'s `v` appears three times — and while
 *          that is safe here (subset expressions are pure), it is work the C
 *          compiler would then have to undo.
 */
import type { EirFn, EirModule, EirSystem, Expr, Local, Stmt } from './eir';

/** Every function reachable from `name`, or null if the graph has a cycle. */
function callees(fn: EirFn, fns: ReadonlyMap<string, EirFn>, seen: Set<string>): boolean {
    if (seen.has(fn.name)) return false;
    seen.add(fn.name);
    let ok = true;
    walkExprs(fn.body, (e) => {
        if (e.e === 'call' && e.target.k === 'fn') {
            const next = fns.get(e.target.name);
            if (!next || !callees(next, fns, seen)) ok = false;
        }
    });
    seen.delete(fn.name);
    return ok;
}

function walkExprs(stmts: readonly Stmt[], visit: (e: Expr) => void): void {
    const expr = (e: Expr): void => {
        visit(e);
        switch (e.e) {
            case 'bin': case 'logic': expr(e.l); expr(e.r); break;
            case 'neg': case 'not': expr(e.v); break;
            case 'select': expr(e.cond); expr(e.then); expr(e.otherwise); break;
            case 'call': for (const a of e.args) expr(a); break;
            default: break;
        }
    };
    for (const s of stmts) {
        switch (s.s) {
            case 'let': case 'return': expr(s.value); break;
            case 'assign': expr(s.value); break;
            case 'emit': for (const a of s.args) expr(a); break;
            case 'if': expr(s.cond); walkExprs(s.then, visit); walkExprs(s.otherwise, visit); break;
            case 'rowLoop': walkExprs(s.body, visit); break;
        }
    }
}

/** Rewrites one system, minting fresh local ids as it goes. */
class Inliner {
    private readonly extra: Local[] = [];
    private next: number;
    /** Statements to place before the one being rewritten. */
    private hoisted: Stmt[] = [];

    constructor(private readonly fns: ReadonlyMap<string, EirFn>, firstId: number) {
        this.next = firstId;
    }

    get locals(): readonly Local[] { return this.extra; }

    private mint(name: string, type: Local['type']): Local {
        const l: Local = { id: this.next++, name: `${name}$${this.next}`, type };
        this.extra.push(l);
        return l;
    }

    stmts(list: readonly Stmt[]): Stmt[] {
        const out: Stmt[] = [];
        for (const s of list) {
            const saved = this.hoisted;
            this.hoisted = [];
            const rewritten = this.stmt(s);
            out.push(...this.hoisted, rewritten);
            this.hoisted = saved;
        }
        return out;
    }

    private stmt(s: Stmt): Stmt {
        switch (s.s) {
            case 'let': return { ...s, value: this.expr(s.value) };
            case 'return': return { ...s, value: this.expr(s.value) };
            case 'assign': return { ...s, value: this.expr(s.value) };
            case 'emit': return { ...s, args: s.args.map((a) => this.expr(a)) };
            case 'if': return {
                s: 'if',
                cond: this.expr(s.cond),
                // Each arm gets its own hoist scope: a temp for a call inside the
                // `then` must not be evaluated when the `else` is taken.
                then: this.stmts(s.then),
                otherwise: this.stmts(s.otherwise),
            };
            case 'rowLoop': return { ...s, body: this.stmts(s.body) };
        }
    }

    private expr(e: Expr): Expr {
        switch (e.e) {
            case 'const': case 'read': return e;
            case 'neg': return { ...e, v: this.expr(e.v) };
            case 'not': return { ...e, v: this.expr(e.v) };
            case 'bin': return { ...e, l: this.expr(e.l), r: this.expr(e.r) };
            case 'logic': return { ...e, l: this.expr(e.l), r: this.expr(e.r) };
            case 'select':
                return { ...e, cond: this.expr(e.cond), then: this.expr(e.then), otherwise: this.expr(e.otherwise) };
            case 'call': {
                const args = e.args.map((a) => this.expr(a));
                if (e.target.k === 'math') return { ...e, args };
                const def = this.fns.get(e.target.name);
                if (!def) return { ...e, args };
                const subst = new Map<number, Expr>();
                def.params.forEach((p, i) => {
                    const tmp = this.mint(p.name, p.type);
                    this.hoisted.push({ s: 'let', id: tmp.id, value: args[i]! });
                    subst.set(p.id, { e: 'read', place: { p: 'local', id: tmp.id }, type: p.type });
                });
                const only = def.body[0];
                if (!only || only.s !== 'return') return { ...e, args };
                // The body is one `return <expr>`, so inlining is substitution.
                return this.expr(substitute(only.value, subst));
            }
        }
    }
}

/** Replace reads of the given locals with the expressions bound to them. */
function substitute(e: Expr, subst: ReadonlyMap<number, Expr>): Expr {
    switch (e.e) {
        case 'const': return e;
        case 'read':
            return e.place.p === 'local' ? (subst.get(e.place.id) ?? e) : e;
        case 'neg': return { ...e, v: substitute(e.v, subst) };
        case 'not': return { ...e, v: substitute(e.v, subst) };
        case 'bin': return { ...e, l: substitute(e.l, subst), r: substitute(e.r, subst) };
        case 'logic': return { ...e, l: substitute(e.l, subst), r: substitute(e.r, subst) };
        case 'select': return {
            ...e,
            cond: substitute(e.cond, subst),
            then: substitute(e.then, subst),
            otherwise: substitute(e.otherwise, subst),
        };
        case 'call': return { ...e, args: e.args.map((a) => substitute(a, subst)) };
    }
}

function maxId(sys: EirSystem): number {
    let n = 0;
    for (const l of [...sys.params, ...sys.locals]) n = Math.max(n, l.id + 1);
    return n;
}

/**
 * Inline every call to a module function. A system whose call graph has a cycle
 * is returned unchanged — recursion cannot be inlined, and pretending otherwise
 * would loop rather than fail.
 */
export function inlineSystem(sys: EirSystem, fns: ReadonlyMap<string, EirFn>): EirSystem {
    for (const fn of fns.values()) {
        if (!callees(fn, fns, new Set())) return sys;
    }
    const inliner = new Inliner(fns, maxId(sys));
    const body = inliner.stmts(sys.body);
    return { ...sys, body, locals: [...sys.locals, ...inliner.locals] };
}

/** The whole module with every system inlined. Types are unchanged, so the
 *  verifier holds on the result exactly as it did on the input. */
export function inlineModule(module: EirModule): EirModule {
    return { ...module, systems: module.systems.map((s) => inlineSystem(s, module.fns)) };
}
