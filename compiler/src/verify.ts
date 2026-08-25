// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify.ts
 * @brief   Re-prove an EIR system's types, without looking at the TypeScript.
 *
 * @details tsc's types are not sound — structural typing, method bivariance and
 *          `any` all leak through generics — so a pass has to prove, on the IR,
 *          that every value is the type it claims.
 *
 *          It reads only EIR, never the AST. That is the point: re-running the
 *          frontend's own reasoning would agree with the frontend's own bugs,
 *          and the failure this catches is a frontend that lowered something
 *          wrong, not a source file that was outside the subset.
 */
import {
    MATH_FNS,
    type CompShape, type EirFn, type EirSystem, type EirType, type Expr, type Local, type Place, type Stmt,
    typeName,
} from './eir';

export interface VerifyError {
    readonly system: string;
    readonly message: string;
}

class Verifier {
    private readonly byId = new Map<number, Local>();
    readonly errors: VerifyError[] = [];

    constructor(
        private readonly sys: EirSystem,
        private readonly comps: ReadonlyMap<string, CompShape>,
        private readonly fns: ReadonlyMap<string, EirFn>,
    ) {
        for (const l of [...sys.params, ...sys.locals]) {
            if (this.byId.has(l.id)) this.fail(`local %${l.id} ('${l.name}') is declared twice`);
            this.byId.set(l.id, l);
        }
    }

    private fail(message: string): void {
        this.errors.push({ system: this.sys.name, message });
    }

    private local(id: number): Local | null {
        const l = this.byId.get(id);
        if (!l) { this.fail(`local %${id} is used but never declared`); return null; }
        return l;
    }

    /** What a place is rooted in, which is what says whether writing is allowed. */
    private rootType(p: Place): EirType | null {
        return p.p === 'local' ? this.local(p.id)?.type ?? null : this.rootType(p.base);
    }

    /** The type a place reads as, or null when it does not resolve. */
    placeType(p: Place): EirType | null {
        if (p.p === 'local') return this.local(p.id)?.type ?? null;
        const base = this.placeType(p.base);
        if (!base) return null;
        if (base.k !== 'comp' && base.k !== 'res') {
            this.fail(`a ${typeName(base)} has no field '${p.path.join('.')}'`);
            return null;
        }
        const shape = this.comps.get(base.name);
        if (!shape) { this.fail(`no declared shape for '${base.name}'`); return null; }
        const f = shape.fields.get(p.path.join('.'));
        if (!f) { this.fail(`'${base.name}' has no field '${p.path.join('.')}'`); return null; }
        return f.type;
    }

    exprType(e: Expr): EirType | null {
        switch (e.e) {
            case 'const':
                if ((typeof e.value === 'boolean') !== (e.type.k === 'bool')) {
                    this.fail(`constant ${String(e.value)} is declared ${typeName(e.type)}`);
                }
                return e.type;
            case 'read': {
                const t = this.placeType(e.place);
                if (t && t.k !== e.type.k) {
                    this.fail(`a read declared ${typeName(e.type)} resolves to ${typeName(t)}`);
                }
                return t;
            }
            case 'neg': {
                const t = this.exprType(e.v);
                if (t && t.k !== 'f64') this.fail(`negation of a ${typeName(t)}`);
                return t;
            }
            case 'not': {
                const t = this.exprType(e.v);
                if (t && t.k !== 'bool') this.fail(`'!' applied to a ${typeName(t)}`);
                return e.type;
            }
            case 'logic': {
                for (const t of [this.exprType(e.l), this.exprType(e.r)]) {
                    if (t && t.k !== 'bool') this.fail(`operator '${e.op}' applied to a ${typeName(t)}`);
                }
                return e.type;
            }
            case 'bin': {
                for (const t of [this.exprType(e.l), this.exprType(e.r)]) {
                    if (t && t.k !== 'f64') this.fail(`operator '${e.op}' applied to a ${typeName(t)}`);
                }
                return e.type;
            }
            case 'select': {
                const c = this.exprType(e.cond);
                if (c && c.k !== 'bool') this.fail(`a ternary condition is a ${typeName(c)}`);
                const t = this.exprType(e.then);
                const f = this.exprType(e.otherwise);
                if (t && f && t.k !== f.k) this.fail(`ternary arms are ${typeName(t)} and ${typeName(f)}`);
                return e.type;
            }
            case 'call': {
                if (e.target.k === 'math') {
                    const arity = (MATH_FNS as Record<string, number | undefined>)[e.target.fn];
                    if (arity === undefined) this.fail(`'${e.target.fn}' is not an intrinsic`);
                    else if (arity !== e.args.length) {
                        this.fail(`${e.target.fn} called with ${e.args.length} argument(s), not ${arity}`);
                    }
                    for (const a of e.args) {
                        const t = this.exprType(a);
                        if (t && t.k !== 'f64') this.fail(`${e.target.fn} applied to a ${typeName(t)}`);
                    }
                    return e.type;
                }
                const def = this.fns.get(e.target.name);
                if (!def) { this.fail(`no function '${e.target.name}'`); return e.type; }
                if (def.params.length !== e.args.length) {
                    this.fail(`${def.name} called with ${e.args.length} argument(s), not ${def.params.length}`);
                }
                e.args.forEach((a, i) => {
                    const t = this.exprType(a);
                    const want = def.params[i]?.type;
                    if (t && want && t.k !== want.k) {
                        this.fail(`${def.name} argument ${i} is ${typeName(t)}, not ${typeName(want)}`);
                    }
                });
                if (def.ret.k !== e.type.k) this.fail(`${def.name} returns ${typeName(def.ret)}, read as ${typeName(e.type)}`);
                return e.type;
            }
        }
    }

    stmt(s: Stmt): void {
        switch (s.s) {
            case 'let': {
                const declared = this.local(s.id)?.type;
                const actual = this.exprType(s.value);
                if (declared && actual && declared.k !== actual.k) {
                    this.fail(`'${this.byId.get(s.id)?.name}' is ${typeName(declared)} but is bound to ${typeName(actual)}`);
                }
                break;
            }
            case 'assign': {
                const target = this.placeType(s.target);
                const value = this.exprType(s.value);
                if (target && value && target.k !== value.k) {
                    this.fail(`assigning ${typeName(value)} into a ${typeName(target)}`);
                }
                // The read-only half of ResMut, proved on the IR: a host writes
                // a resource block back only when the declaration asked for it,
                // so a write through `Res` would be dropped rather than refused.
                const root = this.rootType(s.target);
                if (root && root.k === 'res' && !root.mut) {
                    this.fail(`'${root.name}' is written but the system declared Res, not ResMut`);
                }
                break;
            }
            case 'emit': {
                const ch = this.placeType(s.channel);
                if (ch && ch.k !== 'channel') this.fail(`emit to a ${typeName(ch)}`);
                if (s.record === 'despawn') {
                    const t = s.args[0] ? this.exprType(s.args[0]) : null;
                    if (s.args.length !== 1) this.fail(`despawn takes 1 argument, not ${s.args.length}`);
                    else if (t && t.k !== 'entity') this.fail(`despawn applied to a ${typeName(t)}`);
                } else {
                    this.fail(`'${s.record}' is not a record the verifier knows`);
                }
                break;
            }
            case 'if': {
                const c = this.exprType(s.cond);
                if (c && c.k !== 'bool') this.fail(`if condition is a ${typeName(c)}`);
                for (const b of [...s.then, ...s.otherwise]) this.stmt(b);
                break;
            }
            case 'rowLoop': {
                const q = this.placeType(s.query);
                if (!q) break;
                if (q.k !== 'query') { this.fail(`rowLoop over a ${typeName(q)}`); break; }
                if (q.args.length !== s.binds.length) {
                    this.fail(`rowLoop binds ${s.binds.length} components for a query of ${q.args.length}`);
                }
                s.binds.forEach((id, i) => {
                    const l = this.local(id);
                    const want = q.args[i];
                    if (!l || !want) return;
                    if (l.type.k !== 'comp' || l.type.name !== want.comp) {
                        this.fail(`row binds '${l.name}' as ${typeName(l.type)} for component '${want.comp}'`);
                    }
                    // A component the query did not ask to write must not be a
                    // target — the read-only half of Mut, proved here rather than
                    // trusted from the source.
                    if (!want.mut && this.writesTo(s.body, id)) {
                        this.fail(`'${l.name}' is written but the query asks for '${want.comp}' without Mut`);
                    }
                });
                if (s.entity !== null) {
                    const l = this.local(s.entity);
                    if (l && l.type.k !== 'entity') this.fail(`row entity bound as ${typeName(l.type)}`);
                }
                for (const b of s.body) this.stmt(b);
                break;
            }
        }
    }

    private writesTo(body: readonly Stmt[], id: number): boolean {
        const rootOf = (p: Place): number => (p.p === 'local' ? p.id : rootOf(p.base));
        for (const s of body) {
            if (s.s === 'assign' && rootOf(s.target) === id) return true;
            if (s.s === 'rowLoop' && this.writesTo(s.body, id)) return true;
            if (s.s === 'if' && (this.writesTo(s.then, id) || this.writesTo(s.otherwise, id))) return true;
        }
        return false;
    }
}

/** Every type claim in `sys`, re-proved. An empty array means it holds. */
export function verifySystem(
    sys: EirSystem,
    comps: ReadonlyMap<string, CompShape>,
    fns: ReadonlyMap<string, EirFn> = new Map(),
): VerifyError[] {
    const v = new Verifier(sys, comps, fns);
    for (const s of sys.body) v.stmt(s);
    return v.errors;
}
