// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify.ts
 * @brief   Re-prove an EIR system's types, without looking at the TypeScript.
 *
 * @details docs/REARCH_AOT.md §4.1 asks for this because tsc's types are not
 *          sound — structural typing, method bivariance and `any` leak through
 *          generics — so a pass has to prove, on the IR, that every value is the
 *          type it claims.
 *
 *          It reads only EIR, never the AST. That is the point: re-running the
 *          frontend's own reasoning would agree with the frontend's own bugs,
 *          and the failure this catches is a frontend that lowered something
 *          wrong, not a source file that was outside the subset.
 */
import {
    type CompShape, type EirSystem, type EirType, type Expr, type Local, type Place, type Stmt,
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
        const t = shape.fields.get(p.path.join('.'));
        if (!t) { this.fail(`'${base.name}' has no field '${p.path.join('.')}'`); return null; }
        return t;
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
            case 'bin': {
                const l = this.exprType(e.l);
                const r = this.exprType(e.r);
                for (const t of [l, r]) {
                    if (t && t.k !== 'f64') this.fail(`operator '${e.op}' applied to a ${typeName(t)}`);
                }
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
        }
        return false;
    }
}

/** Every type claim in `sys`, re-proved. An empty array means it holds. */
export function verifySystem(sys: EirSystem, comps: ReadonlyMap<string, CompShape>): VerifyError[] {
    const v = new Verifier(sys, comps);
    for (const s of sys.body) v.stmt(s);
    return v.errors;
}
