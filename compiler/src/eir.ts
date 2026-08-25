// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    eir.ts
 * @brief   Estella IR, high level — typed, and ECS-aware (docs/REARCH_AOT.md §4).
 *
 * @details The reason this layer exists rather than lowering the TS AST straight
 *          to LLVM: by LLVM IR a query is an opaque call, and the optimisations
 *          that pay — copy-in/copy-out elimination, archetype specialisation,
 *          query fusion, change-detection sinking — need to see that a system
 *          walks rows of components. Once that is gone it cannot be recovered.
 *
 *          So `RowLoop` is a first-class statement here and `CompField` a
 *          first-class place, instead of both being calls.
 *
 *          Statement tree, not a CFG. The doc puts SSA and explicit memory at
 *          EIR-low; making this one a CFG too would buy nothing a Stage 1
 *          interpreter can use, and the split is where RC insertion and
 *          bounds-check elimination will live.
 */

/** Every value in EIR carries one of these; there is no `any` to fall back to. */
export type EirType =
    | { readonly k: 'f64' }
    | { readonly k: 'bool' }
    | { readonly k: 'entity' }
    /** A component row — its fields come from the component's declared shape. */
    | { readonly k: 'comp'; readonly name: string }
    /** A resource, addressed by field like a component. */
    | { readonly k: 'res'; readonly name: string }
    | { readonly k: 'query'; readonly args: readonly QueryArg[] }
    /** A deferred-mutation channel: Commands, and later an EventWriter. */
    | { readonly k: 'channel'; readonly name: string };

export const F64: EirType = { k: 'f64' };
export const BOOL: EirType = { k: 'bool' };
export const ENTITY: EirType = { k: 'entity' };

/** One component a query asks for, and whether the system may write it. */
export interface QueryArg {
    readonly comp: string;
    readonly mut: boolean;
}

export type BinOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=';

/**
 * A place a value can be read from or written to. `Field` addresses a component
 * or resource by a path of names — `position.x` — which is what lets a later
 * pass turn it into one load at a constant offset.
 */
export type Place =
    | { readonly p: 'local'; readonly id: number }
    | { readonly p: 'field'; readonly base: Place; readonly path: readonly string[] };

export type LogicOp = '&&' | '||';

export type Expr =
    | { readonly e: 'const'; readonly value: number | boolean; readonly type: EirType }
    | { readonly e: 'read'; readonly place: Place; readonly type: EirType }
    | { readonly e: 'bin'; readonly op: BinOp; readonly l: Expr; readonly r: Expr; readonly type: EirType }
    | { readonly e: 'neg'; readonly v: Expr; readonly type: EirType }
    | { readonly e: 'not'; readonly v: Expr; readonly type: EirType }
    /** Separate from `bin` because both sides must NOT be evaluated. */
    | { readonly e: 'logic'; readonly op: LogicOp; readonly l: Expr; readonly r: Expr; readonly type: EirType }
    /** `a ? b : c`; like `logic`, only one arm runs. */
    | {
        readonly e: 'select';
        readonly cond: Expr;
        readonly then: Expr;
        readonly otherwise: Expr;
        readonly type: EirType;
    }
    /** A call. One node, parameterised by target — as `emit` is by record. */
    | { readonly e: 'call'; readonly target: CallTarget; readonly args: readonly Expr[]; readonly type: EirType };

export type CallTarget =
    /** Only the exactly-specified Math operations (§3.3). */
    | { readonly k: 'math'; readonly fn: MathFn }
    | { readonly k: 'fn'; readonly name: string };

/**
 * The Math operations ECMAScript specifies EXACTLY, so a backend can compute
 * them without disagreeing with the interpreter. sin/cos/tan/exp/log/pow are
 * implementation-defined and deliberately absent — see frontend.ts.
 */
export const MATH_FNS = {
    abs: 1, floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, sign: 1,
    min: 2, max: 2,
} as const;

export type MathFn = keyof typeof MATH_FNS;

export type Stmt =
    /**
     * Walk every row the query matches, binding the entity and one local per
     * component. The op that must survive to EIR-low as a strided walk.
     */
    | {
        readonly s: 'rowLoop';
        readonly query: Place;
        readonly entity: number | null;
        readonly binds: readonly number[];
        readonly body: readonly Stmt[];
    }
    | { readonly s: 'assign'; readonly target: Place; readonly value: Expr }
    | { readonly s: 'return'; readonly value: Expr }
    | { readonly s: 'let'; readonly id: number; readonly value: Expr }
    /**
     * Append one record to a channel. Commands are a QUEUE the runner flushes at
     * system end, not calls — so `despawn`, `spawn` and `EventWriter.send` are
     * one statement with the record name as data, rather than an opcode each.
     */
    | {
        readonly s: 'emit';
        readonly channel: Place;
        readonly record: string;
        readonly args: readonly Expr[];
    }
    | {
        readonly s: 'if';
        readonly cond: Expr;
        readonly then: readonly Stmt[];
        readonly otherwise: readonly Stmt[];
    };

/** A local's name and type; the name is for diagnostics and printing only. */
export interface Local {
    readonly id: number;
    readonly name: string;
    readonly type: EirType;
}

/** A module-level pure function over numbers and booleans. */
export interface EirFn {
    readonly name: string;
    readonly params: readonly Local[];
    readonly locals: readonly Local[];
    readonly body: readonly Stmt[];
    readonly ret: EirType;
}

export interface EirSystem {
    readonly name: string;
    /** Locals bound to the system's declared parameters, in declaration order. */
    readonly params: readonly Local[];
    readonly locals: readonly Local[];
    readonly body: readonly Stmt[];
}

/** A component's field shape, flattened to leaf paths of one scalar each. */
export interface CompShape {
    readonly name: string;
    /** `position.x` -> f64. Order is the declaration order EHT would give. */
    readonly fields: ReadonlyMap<string, EirType>;
}

export interface EirModule {
    readonly systems: readonly EirSystem[];
    readonly comps: ReadonlyMap<string, CompShape>;
    readonly fns: ReadonlyMap<string, EirFn>;
}

// =============================================================================
// printing — an EIR dump is the first thing anyone debugging this will read
// =============================================================================

export function typeName(t: EirType): string {
    switch (t.k) {
        case 'comp': return `comp<${t.name}>`;
        case 'res': return `res<${t.name}>`;
        case 'channel': return `channel<${t.name}>`;
        case 'query': return `query<${t.args.map((a) => (a.mut ? `mut ${a.comp}` : a.comp)).join(', ')}>`;
        default: return t.k;
    }
}

function placeName(p: Place, locals: ReadonlyMap<number, Local>): string {
    if (p.p === 'local') return locals.get(p.id)?.name ?? `%${p.id}`;
    return `${placeName(p.base, locals)}.${p.path.join('.')}`;
}

function exprText(e: Expr, locals: ReadonlyMap<number, Local>): string {
    switch (e.e) {
        case 'const': return String(e.value);
        case 'read': return placeName(e.place, locals);
        case 'bin':
        case 'logic': return `(${exprText(e.l, locals)} ${e.op} ${exprText(e.r, locals)})`;
        case 'neg': return `-${exprText(e.v, locals)}`;
        case 'not': return `!${exprText(e.v, locals)}`;
        case 'select':
            return `(${exprText(e.cond, locals)} ? ${exprText(e.then, locals)} : ${exprText(e.otherwise, locals)})`;
        case 'call': {
            const name = e.target.k === 'math' ? e.target.fn : e.target.name;
            return `${name}(${e.args.map((a) => exprText(a, locals)).join(', ')})`;
        }
    }
}

function stmtText(s: Stmt, locals: ReadonlyMap<number, Local>, indent: string): string[] {
    switch (s.s) {
        case 'rowLoop': {
            const names = s.binds.map((b) => locals.get(b)?.name ?? `%${b}`);
            const ent = s.entity === null ? '_' : (locals.get(s.entity)?.name ?? `%${s.entity}`);
            const head = `${indent}rowLoop ${placeName(s.query, locals)} -> (${ent}, ${names.join(', ')}) {`;
            const body = s.body.flatMap((b) => stmtText(b, locals, `${indent}  `));
            return [head, ...body, `${indent}}`];
        }
        case 'assign':
            return [`${indent}${placeName(s.target, locals)} = ${exprText(s.value, locals)}`];
        case 'let':
            return [`${indent}let ${locals.get(s.id)?.name ?? `%${s.id}`} = ${exprText(s.value, locals)}`];
        case 'return':
            return [`${indent}return ${exprText(s.value, locals)}`];
        case 'emit':
            return [`${indent}emit ${placeName(s.channel, locals)}.${s.record}(`
                + `${s.args.map((a) => exprText(a, locals)).join(', ')})`];
        case 'if': {
            const out = [`${indent}if ${exprText(s.cond, locals)} {`];
            out.push(...s.then.flatMap((b) => stmtText(b, locals, `${indent}  `)));
            if (s.otherwise.length > 0) {
                out.push(`${indent}} else {`);
                out.push(...s.otherwise.flatMap((b) => stmtText(b, locals, `${indent}  `)));
            }
            out.push(`${indent}}`);
            return out;
        }
    }
}

export function printFn(fn: EirFn): string {
    const byId = new Map<number, Local>();
    for (const l of [...fn.params, ...fn.locals]) byId.set(l.id, l);
    const params = fn.params.map((p) => `${p.name}: ${typeName(p.type)}`).join(', ');
    return [
        `fn ${fn.name}(${params}) -> ${typeName(fn.ret)} {`,
        ...fn.body.flatMap((s) => stmtText(s, byId, '  ')),
        '}',
    ].join('\n');
}

export function printSystem(sys: EirSystem): string {
    const byId = new Map<number, Local>();
    for (const l of [...sys.params, ...sys.locals]) byId.set(l.id, l);
    const params = sys.params.map((p) => `${p.name}: ${typeName(p.type)}`).join(', ');
    return [
        `system ${sys.name}(${params}) {`,
        ...sys.body.flatMap((s) => stmtText(s, byId, '  ')),
        '}',
    ].join('\n');
}
