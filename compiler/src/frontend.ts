// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frontend.ts
 * @brief   TypeScript AST -> EIR-high.
 *
 * @details Uses the real `typescript` program and checker. Re-implementing TS
 *          inference is the one decision that would sink this project.
 *
 *          The SDK entry points are INTRINSICS, not calls: `defineSystem`,
 *          `Query`, `Mut`, `Res`, `defineComponent`. `defineComponent('Mover',
 *          {...})` is runtime reflection, and AOT needs it to be a compile-time
 *          declaration — so both arguments must be literals or the file falls
 *          back to the interpreter.
 *
 *          NOTHING in this file may call `getText()`, `getSourceFile()` or read
 *          `.parent`. Those need the program to have BOUND, which only happens
 *          as a side effect of getTypeChecker(); they have already broken line
 *          numbers, binding resolution, operator text and parameter names here.
 *          Use `.text` on an identifier and `ts.tokenToString(kind)` on a token.
 *
 *          Nothing here throws on code it cannot handle. Anything outside the
 *          subset produces a Diagnostic naming the line and the reason, and its
 *          system is simply not compiled. Falling back rather than failing is
 *          what lets this ship before it is finished.
 */
import { sep } from 'node:path';
import ts from 'typescript';
import {
    BOOL, ENTITY, F64, HOST_ENC,
    type CompShape, type EirModule, type EirSystem, type EirType,
    MATH_FNS,
    type FieldSpec, type EirFn, type Expr, type Local, type Place, type QueryArg, type Stmt, type BinOp, type LogicOp,
    type MathFn,
} from './eir';

export interface Diagnostic {
    readonly file: string;
    readonly line: number;
    readonly message: string;
    readonly kind: RefusalKind;
    /**
     * Whether the author PROMISED this would compile. `@compiled` on a system
     * makes its refusal an error: without the marker a system that quietly stops
     * compiling just gets slower, and nothing anywhere goes red.
     */
    readonly severity: 'error' | 'note';
    /** The system this killed, when the failure happened inside one. */
    readonly system?: string;
}

export interface LowerResult {
    readonly module: EirModule;
    readonly diagnostics: readonly Diagnostic[];
    /** Systems seen, whether or not they compiled — the coverage gate's denominator. */
    readonly seen: readonly string[];
    /**
     * The `const` each system is bound to -> its declared name. Registration in
     * main.ts names the BINDING, so this is what lets a caller ask whether a
     * system runs per frame or once at startup.
     */
    readonly systemBindings: ReadonlyMap<string, string>;
    /**
     * Systems the author marked `@compiled`. Compiling these is a PROMISE, and
     * `brokenPromises` is what a build asks whether it was kept.
     */
    readonly required: readonly string[];
}

/**
 * A `@compiled` tag, read straight off the parse tree. `ts.getJSDocTags` walks
 * parent pointers, which this file may not touch (see the header); `node.jsDoc`
 * is what the parser attached and needs nothing bound.
 */
interface WithJsDoc {
    readonly jsDoc?: readonly ts.JSDoc[];
}

function marksCompiled(node: ts.Node): boolean {
    const doc = (node as WithJsDoc).jsDoc;
    if (!doc) return false;
    return doc.some((d) => d.tags?.some((t) => t.tagName.text === 'compiled') ?? false);
}

/**
 * The promises this program did not keep: every marked system that refused, plus
 * any that vanished without a diagnostic. A build fails on this list; an unmarked
 * refusal stays a note, because falling back to the interpreter is a design
 * and not a defect.
 */
export function brokenPromises(result: LowerResult): readonly Diagnostic[] {
    const compiled = new Set(result.module.systems.map((s) => s.name));
    const spoken = new Set<string>();
    const out = result.diagnostics.filter((d) => {
        if (d.severity !== 'error') return false;
        if (d.system) spoken.add(d.system);
        return true;
    });
    for (const name of result.required) {
        if (compiled.has(name) || spoken.has(name)) continue;
        out.push({
            file: '', line: 0, kind: 'pending', severity: 'error', system: name,
            message: `'${name}' is marked @compiled but the compiler never produced it`,
        });
    }
    return out;
}

const BIN_OPS: ReadonlyMap<ts.SyntaxKind, BinOp> = new Map([
    [ts.SyntaxKind.PlusToken, '+'], [ts.SyntaxKind.MinusToken, '-'],
    [ts.SyntaxKind.AsteriskToken, '*'], [ts.SyntaxKind.SlashToken, '/'],
    [ts.SyntaxKind.PercentToken, '%'],
    [ts.SyntaxKind.LessThanToken, '<'], [ts.SyntaxKind.LessThanEqualsToken, '<='],
    [ts.SyntaxKind.GreaterThanToken, '>'], [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, '=='], [ts.SyntaxKind.ExclamationEqualsEqualsToken, '!='],
] as const);

const COMPOUND: ReadonlyMap<ts.SyntaxKind, BinOp> = new Map([
    [ts.SyntaxKind.PlusEqualsToken, '+'], [ts.SyntaxKind.MinusEqualsToken, '-'],
    [ts.SyntaxKind.AsteriskEqualsToken, '*'], [ts.SyntaxKind.SlashEqualsToken, '/'],
] as const);

const LOGIC_OPS: ReadonlyMap<ts.SyntaxKind, LogicOp> = new Map([
    [ts.SyntaxKind.AmpersandAmpersandToken, '&&'],
    [ts.SyntaxKind.BarBarToken, '||'],
] as const);

/**
 * A token's source text WITHOUT touching the node. `getText()` walks parent
 * pointers, which exist only after the program has bound — the same trap that
 * has now caught line numbers, binding resolution and this.
 */
function tokenText(kind: ts.SyntaxKind): string {
    return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}

/**
 * Command records this subset emits, and how many arguments each carries.
 * `spawn` is absent on purpose: it returns a builder that the corpus chains
 * `.insert(Component, {…})` onto, which needs component literals as values.
 */
const COMMAND_RECORDS: Record<string, number | undefined> = { despawn: 1 };

/**
 * A module-level `const` the compiler can read at compile time: a literal, or a
 * record of them. `WORLD_HALF_W` and `FOLLOW.damping` are values, not storage,
 * so a system reading one gets a constant rather than a load.
 */
export type ConstValue = number | boolean | { readonly [k: string]: ConstValue };

/** `const X = 800` / `const F = { damping: 5 }` -> a value, or null if not literal. */
function constValue(node: ts.Expression): ConstValue | null {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const inner = constValue(node.operand);
        return typeof inner === 'number' ? -inner : null;
    }
    if (ts.isObjectLiteralExpression(node)) {
        const out: Record<string, ConstValue> = {};
        for (const prop of node.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return null;
            const v = constValue(prop.initializer);
            if (v === null) return null;
            out[prop.name.text] = v;
        }
        return out;
    }
    return null;
}

/** `number` / `boolean` written as an annotation; nothing else is a subset type. */
function annotatedType(node: ts.TypeNode): EirType | null {
    if (node.kind === ts.SyntaxKind.NumberKeyword) return F64;
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return BOOL;
    return null;
}

/**
 * `permanent` = the contract has no place for it, not a
 * todo. `pending` = the contract admits it, nobody lowered it yet. Default is
 * `pending`; every `permanent` below names what is missing.
 */
export type RefusalKind = 'permanent' | 'pending';

/** Thrown internally to abandon one system; never escapes lowerProgram. */
class NotInSubset extends Error {
    constructor(
        readonly node: ts.Node,
        message: string,
        readonly kind: RefusalKind = 'pending',
    ) { super(message); }
}

class SystemLowerer {
    private readonly locals: Local[] = [];
    private next = 0;
    /** A stack, not one map: a `const` in a row loop must not outlive the loop. */
    private readonly scopes: Map<string, Local>[] = [new Map()];

    constructor(
        private readonly comps: Map<string, CompShape>,
        /** `const Speed = defineComponent('FixtureSpeed', …)` — a query names the
         *  BINDING, and the shape is filed under the declared name. */
        private readonly bindings: ReadonlyMap<string, string>,
        /** Module-level literals, folded where they are read. */
        private readonly consts: ReadonlyMap<string, ConstValue>,
        /** Module-level pure functions, callable from a system or from each other. */
        private readonly fns: ReadonlyMap<string, EirFn>,
        /** Why a function is absent, so the call site can say more than "no". */
        private readonly fnFailures: ReadonlyMap<string, string> = new Map(),
    ) {}

    /** Lower a module-level function; `lower` does the same for a system body. */
    lowerFn(name: string, params: readonly ts.ParameterDeclaration[], body: ts.ConciseBody): EirFn {
        const bound = params.map((p) => {
            if (!ts.isIdentifier(p.name)) throw new NotInSubset(p, 'a parameter must be a plain name');
            if (!p.type) {
                throw new NotInSubset(p, `parameter '${p.name.text}' needs a type annotation`);
            }
            const t = annotatedType(p.type);
            if (!t) throw new NotInSubset(p.type, 'a parameter must be annotated number or boolean');
            return this.define(p.name.text, t);
        });
        // One `return <expr>` and nothing else: that is what makes inlining a
        // substitution rather than a control-flow splice, and it covers the
        // numeric helpers the corpus writes.
        const value = ts.isBlock(body)
            ? (() => {
                const only = body.statements.length === 1 ? body.statements[0] : undefined;
                if (!only || !ts.isReturnStatement(only) || !only.expression) {
                    throw new NotInSubset(body, 'a function body must be a single return of an expression');
                }
                return this.expr(only.expression);
            })()
            : this.expr(body);
        const paramIds = new Set(bound.map((b) => b.id));
        return {
            name,
            params: bound,
            locals: this.locals.filter((l) => !paramIds.has(l.id)),
            body: [{ s: 'return', value }],
            ret: value.type,
        };
    }

    /** The constant a dotted path names, or null when the root is not one. */
    private constAt(root: string, path: readonly string[]): ConstValue | null {
        let cur = this.consts.get(root);
        if (cur === undefined) return null;
        for (const key of path) {
            if (cur === null || typeof cur !== 'object') return null;
            cur = (cur as Record<string, ConstValue>)[key];
            if (cur === undefined) return null;
        }
        return cur;
    }

    private compName(binding: string): string {
        return this.bindings.get(binding) ?? binding;
    }

    private define(name: string, type: EirType): Local {
        const l: Local = { id: this.next++, name, type };
        this.locals.push(l);
        this.scopes[this.scopes.length - 1]!.set(name, l);
        return l;
    }

    /** The local a name binds to, or null — for a caller that wants to ask, not throw. */
    private tryLookup(name: string): Local | null {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const l = this.scopes[i]!.get(name);
            if (l) return l;
        }
        return null;
    }

    private lookup(node: ts.Node, name: string): Local {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const l = this.scopes[i]!.get(name);
            if (l) return l;
        }
        // Some of these are heap values (an array, a class) and some are not —
        // a numeric enum member is a compile-time constant nobody folds yet. The
        // default stands: claiming it cannot be done needs a reason.
        throw new NotInSubset(node, `'${name}' is not a value this system declared`);
    }

    private scoped<T>(fn: () => T): T {
        this.scopes.push(new Map());
        try { return fn(); } finally { this.scopes.pop(); }
    }

    /** `[Query(Mut(Transform), Mover), Res(Time)]` -> one param type each. */
    private paramTypes(node: ts.Expression): EirType[] {
        if (!ts.isArrayLiteralExpression(node)) {
            throw new NotInSubset(node, "defineSystem's parameter list must be an array literal");
        }
        return node.elements.map((el) => {
            if (!ts.isCallExpression(el) || !ts.isIdentifier(el.expression)) {
                throw new NotInSubset(el, 'each parameter must be Query(...) or Res(...)');
            }
            const kind = el.expression.text;
            if (kind === 'Res' || kind === 'ResMut') {
                const arg = el.arguments[0];
                if (!arg || !ts.isIdentifier(arg)) throw new NotInSubset(el, `${kind}(...) needs a named resource`);
                return { k: 'res', name: this.compName(arg.text), mut: kind === 'ResMut' } as EirType;
            }
            if (kind === 'Commands') {
                if (el.arguments.length !== 0) throw new NotInSubset(el, 'Commands() takes no arguments');
                return { k: 'channel', name: 'Commands' } as EirType;
            }
            if (kind !== 'Query') {
                // GetWorld hands over the whole World — arbitrary access, the one
                // thing a closed contract cannot have. The rest are parameters
                // nobody has lowered yet.
                throw new NotInSubset(el, `'${kind}' is not a parameter intrinsic`,
                    kind === 'GetWorld' ? 'permanent' : 'pending');
            }
            const args: QueryArg[] = el.arguments.map((a) => this.queryArg(a));
            return { k: 'query', args } as EirType;
        });
    }

    private queryArg(node: ts.Expression): QueryArg {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            if (node.expression.text !== 'Mut') {
                throw new NotInSubset(node, `'${node.expression.text}(...)' is not a query argument this subset lowers`);
            }
            const inner = node.arguments[0];
            if (!inner || !ts.isIdentifier(inner)) throw new NotInSubset(node, 'Mut(...) needs a named component');
            return { comp: this.compName(inner.text), mut: true };
        }
        if (!ts.isIdentifier(node)) throw new NotInSubset(node, 'a query argument must be a named component');
        return { comp: this.compName(node.text), mut: false };
    }

    lower(name: string, params: ts.Expression, fn: ts.ArrowFunction): EirSystem {
        const types = this.paramTypes(params);
        if (fn.parameters.length !== types.length) {
            throw new NotInSubset(fn, `the callback takes ${fn.parameters.length} parameters but ${types.length} were declared`);
        }
        const bound: Local[] = fn.parameters.map((p, i) => {
            if (!ts.isIdentifier(p.name)) throw new NotInSubset(p, 'a system parameter must be a plain name');
            return this.define(p.name.text, types[i]!);
        });
        const body = ts.isBlock(fn.body)
            ? fn.body.statements.flatMap((s) => this.stmt(s))
            : (() => { throw new NotInSubset(fn, 'the callback must have a block body'); })();
        const paramIds = new Set(bound.map((b) => b.id));
        return {
            name,
            params: bound,
            locals: this.locals.filter((l) => !paramIds.has(l.id)),
            body,
        };
    }

    private stmt(node: ts.Statement): Stmt[] {
        if (ts.isForOfStatement(node)) return [this.rowLoop(node)];
        if (ts.isExpressionStatement(node)) {
            if (ts.isCallExpression(node.expression)) return [this.emit(node.expression)];
            return [this.assignment(node.expression)];
        }
        if (ts.isBlock(node)) return this.scoped(() => node.statements.flatMap((s) => this.stmt(s)));
        if (ts.isVariableStatement(node)) return this.declarations(node);
        if (ts.isIfStatement(node)) return [this.ifStmt(node)];
        throw new NotInSubset(node, `${ts.SyntaxKind[node.kind]} is not a statement this subset lowers`);
    }

    /** `const x = expr` — the local takes the initializer's type; there is none to declare. */
    private declarations(node: ts.VariableStatement): Stmt[] {
        return node.declarationList.declarations.map((d) => {
            if (!ts.isIdentifier(d.name)) throw new NotInSubset(d, 'a declaration must bind a plain name');
            if (!d.initializer) throw new NotInSubset(d, 'a local must be initialized where it is declared');
            const value = this.expr(d.initializer);
            if (value.type.k !== 'f64' && value.type.k !== 'bool') {
                // A component or query is a reference, and the contract has no
                // reference values — only memory it was handed, and numbers.
                throw new NotInSubset(d, `a local cannot hold a ${value.type.k}`, 'permanent');
            }
            return { s: 'let', id: this.define(d.name.text, value.type).id, value } as Stmt;
        });
    }

    private ifStmt(node: ts.IfStatement): Stmt {
        const cond = this.expr(node.expression);
        if (cond.type.k !== 'bool') throw new NotInSubset(node.expression, 'an if condition must be a boolean');
        const then = this.scoped(() => this.stmt(node.thenStatement));
        const otherwise = node.elseStatement ? this.scoped(() => this.stmt(node.elseStatement!)) : [];
        return { s: 'if', cond, then, otherwise };
    }

    /** `for (const [e, a, b] of query) { ... }` — the shape a system iterates rows in. */
    private rowLoop(node: ts.ForOfStatement): Stmt {
        if (!ts.isIdentifier(node.expression)) {
            throw new NotInSubset(node.expression, 'a row loop must iterate a declared query');
        }
        const q = this.lookup(node.expression, node.expression.text);
        const qt = q.type;
        if (qt.k !== 'query') throw new NotInSubset(node.expression, `'${q.name}' is not a query`);

        const decl = ts.isVariableDeclarationList(node.initializer) ? node.initializer.declarations[0] : undefined;
        if (!decl || !decl.name || !ts.isArrayBindingPattern(decl.name)) {
            throw new NotInSubset(node, 'a row loop must destructure [entity, ...components]');
        }
        // A destructuring may bind a PREFIX and may elide holes — `[, transform,
        // player]` is what most of the corpus writes. Demanding one name per
        // yielded value refused legal TypeScript for no reason.
        const elements = decl.name.elements;
        if (elements.length > qt.args.length + 1) {
            throw new NotInSubset(node, `the row binds ${elements.length} names but the query yields ${qt.args.length + 1}`);
        }

        let entity: number | null = null;
        const binds: number[] = [];
        elements.forEach((el, i) => {
            if (ts.isOmittedExpression(el)) {
                // A hole still occupies its position; the row just does not name it.
                if (i > 0) binds.push(this.define(`_hole${i}`, { k: 'comp', name: qt.args[i - 1]!.comp }).id);
                return;
            }
            if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) {
                throw new NotInSubset(el, 'a row binding must be a plain name');
            }
            const nm = el.name.text;
            if (i === 0) {
                const l = this.define(nm, ENTITY);
                // A row's entity is bound whether or not the body reads it; the
                // leading underscore convention only says the author expects not to.
                entity = l.id;
                return;
            }
            const arg = qt.args[i - 1]!;
            binds.push(this.define(nm, { k: 'comp', name: arg.comp }).id);
        });
        // A prefix binding still needs the trailing components bound, because the
        // interpreter and every later pass index binds positionally.
        for (let i = elements.length; i < qt.args.length + 1; i++) {
            binds.push(this.define(`_tail${i}`, { k: 'comp', name: qt.args[i - 1]!.comp }).id);
        }

        const body = this.scoped(() => (ts.isBlock(node.statement)
            ? node.statement.statements.flatMap((s) => this.stmt(s))
            : this.stmt(node.statement)));
        return { s: 'rowLoop', query: { p: 'local', id: q.id }, entity, binds, body };
    }

    /**
     * `cmds.despawn(entity)` — a record appended to a channel, not a call. The
     * SDK already defers these to a flush at system end, so this models what it
     * does rather than pretending the mutation happens here.
     */
    private emit(node: ts.CallExpression): Stmt {
        const callee = node.expression;
        if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) {
            throw new NotInSubset(node, 'a call statement must be a method on a declared channel');
        }
        const target = this.lookup(callee.expression, callee.expression.text);
        if (target.type.k !== 'channel') {
            throw new NotInSubset(node, `'${target.name}' is not a channel this subset can emit to`);
        }
        const record = callee.name.text;
        const arity = COMMAND_RECORDS[record];
        if (arity === undefined) {
            throw new NotInSubset(node, `Commands.${record} is not a record this subset emits yet`);
        }
        if (node.arguments.length !== arity) {
            throw new NotInSubset(node, `Commands.${record} takes ${arity} argument(s), not ${node.arguments.length}`);
        }
        const args = node.arguments.map((a) => this.expr(a));
        return { s: 'emit', channel: { p: 'local', id: target.id }, record, args };
    }

    private assignment(node: ts.Expression): Stmt {
        if (!ts.isBinaryExpression(node)) {
            throw new NotInSubset(node, 'only assignments are statements in this subset');
        }
        const compound = COMPOUND.get(node.operatorToken.kind);
        const target = this.place(node.left);
        if (compound) {
            const type = this.placeType(node.left);
            const read: Expr = { e: 'read', place: target, type };
            const r = this.expr(node.right);
            return { s: 'assign', target, value: { e: 'bin', op: compound, l: read, r, type } };
        }
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
            throw new NotInSubset(node, `'${tokenText(node.operatorToken.kind)}' is not an assignment this subset lowers`);
        }
        return { s: 'assign', target, value: this.expr(node.right) };
    }

    /** A place is a local, or a dotted path from one. Nothing else is addressable. */
    private place(node: ts.Expression): Place {
        if (ts.isIdentifier(node)) {
            if (this.consts.has(node.text) && !this.scopes.some((sc) => sc.has(node.text))) {
                throw new NotInSubset(node, `'${node.text}' is a constant and cannot be assigned`);
            }
            return { p: 'local', id: this.lookup(node, node.text).id };
        }
        if (!ts.isPropertyAccessExpression(node)) {
            throw new NotInSubset(node, 'only a name or a dotted path can be read or assigned here');
        }
        const path: string[] = [];
        let cur: ts.Expression = node;
        while (ts.isPropertyAccessExpression(cur)) {
            path.unshift(cur.name.text);
            cur = cur.expression;
        }
        if (!ts.isIdentifier(cur)) throw new NotInSubset(node, 'a dotted path must start at a declared name');
        if (this.consts.has(cur.text) && !this.scopes.some((sc) => sc.has(cur.text))) {
            throw new NotInSubset(node, `'${cur.text}' is a constant and cannot be assigned`);
        }
        return { p: 'field', base: { p: 'local', id: this.lookup(cur, cur.text).id }, path };
    }

    /**
     * The type a place reads as. A component or resource field must exist in the
     * declared shape — this is where a typo stops being a runtime undefined.
     */
    private placeType(node: ts.Expression): EirType {
        const place = this.place(node);
        if (place.p === 'local') {
            return this.locals.find((l) => l.id === place.id)!.type;
        }
        const base = this.locals.find((l) => l.id === (place.base as { p: 'local'; id: number }).id)!;
        const key = place.path.join('.');
        if (base.type.k === 'comp') {
            const shape = this.comps.get(base.type.name);
            if (!shape) throw new NotInSubset(node, `no declared shape for component '${base.type.name}'`);
            const f = shape.fields.get(key);
            if (!f) throw new NotInSubset(node, `'${base.type.name}' has no field '${key}'`);
            return this.leafType(node, `${base.type.name}.${key}`, f);
        }
        if (base.type.k === 'res') {
            const shape = this.comps.get(base.type.name);
            const f = shape?.fields.get(key);
            if (!f) throw new NotInSubset(node, `resource '${base.type.name}' has no field '${key}'`);
            return this.leafType(node, `${base.type.name}.${key}`, f);
        }
        throw new NotInSubset(node, `'${base.name}' has no fields to read`);
    }

    /**
     * The EIR type a stored leaf reads as, or a refusal naming its encoding. An
     * integer leaf is `pending`: what is missing is an EIR integer type, without
     * which the two sides could not agree — C narrowing an out-of-range double
     * is undefined where JS wraps.
     */
    private leafType(node: ts.Node, where: string, f: FieldSpec): EirType {
        if (f.enc === 'i32' || f.enc === 'u32' || f.enc === 'u8') {
            throw new NotInSubset(node,
                `'${where}' is stored as ${f.enc}, and this subset has no integer type`
                + ' — reading it as a double could not be reproduced bit-for-bit');
        }
        return f.type;
    }

    /**
     * `Math.abs(x)` and friends. Only the operations ECMAScript specifies to the
     * bit: sin/cos/tan/exp/log/pow are implementation-defined, so a native
     * backend and the interpreter would be free to disagree — and a pixel gate
     * would go red on trig rather than on a bug.
     */
    private mathCall(node: ts.CallExpression): Expr {
        const callee = node.expression;
        // A module-level pure function, called by name.
        if (ts.isIdentifier(callee)) {
            const target = this.fns.get(callee.text);
            if (!target) {
                const why = this.fnFailures.get(callee.text);
                throw new NotInSubset(node, why
                    ? `'${callee.text}' cannot be lowered: ${why}`
                    : `'${callee.text}' is not a function this subset lowers`);
            }
            if (node.arguments.length !== target.params.length) {
                throw new NotInSubset(node,
                    `${target.name} takes ${target.params.length} argument(s), not ${node.arguments.length}`);
            }
            const args = node.arguments.map((a) => this.expr(a));
            args.forEach((a, i) => {
                const want = target.params[i]!.type;
                if (a.type.k !== want.k) {
                    throw new NotInSubset(node.arguments[i]!,
                        `${target.name} takes a ${want.k} here, not a ${a.type.k}`);
                }
            });
            return { e: 'call', target: { k: 'fn', name: target.name }, args, type: target.ret };
        }
        if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)
            || callee.expression.text !== 'Math') {
            // A method on a RESOURCE is pending: a service is meant to be read
            // as memory, so `input.isKeyDown('KeyW')` is a bit at a known offset.
            // On anything else it needs an object model, which there is none of.
            const recv = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
                ? this.tryLookup(callee.expression.text)
                : null;
            if (recv && recv.type.k === 'res') {
                throw new NotInSubset(node,
                    `${recv.name}.${(callee as ts.PropertyAccessExpression).name.text}(…) is a resource method`
                    + ' — the contract wants it read as memory, and nothing lowers it yet');
            }
            throw new NotInSubset(node, 'CallExpression is not an expression this subset lowers', 'permanent');
        }
        const fn = callee.name.text as MathFn;
        const arity = (MATH_FNS as Record<string, number | undefined>)[fn];
        if (arity === undefined) {
            throw new NotInSubset(node,
                `Math.${fn} is not exactly specified by ECMAScript, so a compiled build would be free to disagree with the interpreter`,
                'permanent');
        }
        if (node.arguments.length !== arity) {
            throw new NotInSubset(node, `Math.${fn} takes ${arity} argument(s), not ${node.arguments.length}`);
        }
        const args = node.arguments.map((a) => this.expr(a));
        for (const a of args) {
            if (a.type.k !== 'f64') throw new NotInSubset(node, `Math.${fn} takes numbers, not a ${a.type.k}`);
        }
        return { e: 'call', target: { k: 'math', fn }, args, type: F64 };
    }

    /** A read of a module-level constant becomes the value, not a load. */
    private foldConst(node: ts.Expression): Expr | null {
        const path: string[] = [];
        let cur: ts.Expression = node;
        while (ts.isPropertyAccessExpression(cur)) {
            path.unshift(cur.name.text);
            cur = cur.expression;
        }
        if (!ts.isIdentifier(cur)) return null;
        // A local of the same name shadows the module constant, as it does in TS.
        if (this.scopes.some((sc) => sc.has(cur.text))) return null;
        const v = this.constAt(cur.text, path);
        if (v === null || typeof v === 'object') return null;
        return typeof v === 'boolean'
            ? { e: 'const', value: v, type: BOOL }
            : { e: 'const', value: v, type: F64 };
    }

    private expr(node: ts.Expression): Expr {
        if (ts.isParenthesizedExpression(node)) return this.expr(node.expression);
        if (ts.isNumericLiteral(node)) return { e: 'const', value: Number(node.text), type: F64 };
        if (node.kind === ts.SyntaxKind.TrueKeyword) return { e: 'const', value: true, type: BOOL };
        if (node.kind === ts.SyntaxKind.FalseKeyword) return { e: 'const', value: false, type: BOOL };
        if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
            const v = this.expr(node.operand);
            return { e: 'neg', v, type: v.type };
        }
        if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
            return { e: 'not', v: this.expr(node.operand), type: BOOL };
        }
        if (ts.isBinaryExpression(node)) {
            const logic = LOGIC_OPS.get(node.operatorToken.kind);
            if (logic) {
                return { e: 'logic', op: logic, l: this.expr(node.left), r: this.expr(node.right), type: BOOL };
            }
            const op = BIN_OPS.get(node.operatorToken.kind);
            if (!op) throw new NotInSubset(node, `operator '${tokenText(node.operatorToken.kind)}' is not in this subset`);
            const l = this.expr(node.left);
            const r = this.expr(node.right);
            const type = op === '<' || op === '<=' || op === '>' || op === '>=' || op === '==' || op === '!='
                ? BOOL : F64;
            return { e: 'bin', op, l, r, type };
        }
        if (ts.isConditionalExpression(node)) {
            const cond = this.expr(node.condition);
            if (cond.type.k !== 'bool') throw new NotInSubset(node.condition, 'a ternary condition must be a boolean');
            const then = this.expr(node.whenTrue);
            const otherwise = this.expr(node.whenFalse);
            if (then.type.k !== otherwise.type.k) {
                throw new NotInSubset(node, 'the two arms of a ternary must have the same type');
            }
            return { e: 'select', cond, then, otherwise, type: then.type };
        }
        if (ts.isCallExpression(node)) return this.mathCall(node);
        if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
            const folded = this.foldConst(node);
            if (folded) return folded;
            return { e: 'read', place: this.place(node), type: this.placeType(node) };
        }
        // String, array, object, new, await: each needs a heap, and the contract
        // has no allocation.
        throw new NotInSubset(node, `${ts.SyntaxKind[node.kind]} is not an expression this subset lowers`, 'permanent');
    }
}

/** `defineComponent('Mover', { speed: 100 })` -> a shape, or null if not literal. */
function componentShape(call: ts.CallExpression): CompShape | null {
    const [nameArg, defaults] = call.arguments;
    if (!nameArg || !ts.isStringLiteral(nameArg)) return null;
    if (!defaults || !ts.isObjectLiteralExpression(defaults)) return null;
    const fields = new Map<string, FieldSpec>();
    for (const prop of defaults.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return null;
        // `-50` parses as a prefix expression, not a numeric literal. A default
        // of a negative number is ordinary, and refusing it took FixtureClamp
        // out of the corpus for no reason anyone would guess from the message.
        const init = ts.isPrefixUnaryExpression(prop.initializer)
            && prop.initializer.operator === ts.SyntaxKind.MinusToken
            ? prop.initializer.operand
            : prop.initializer;
        if (ts.isNumericLiteral(init)) fields.set(prop.name.text, { type: F64, enc: HOST_ENC, offset: null });
        else if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) {
            fields.set(prop.name.text, { type: BOOL, enc: HOST_ENC, offset: null });
        } else return null;
    }
    // defineComponent lands in ScriptStorage — a Map of JS objects — so its
    // numbers are f64, unlike an engine component's f32 pool.
    return { name: nameArg.text, storage: 'host', fields };
}

/** Two declarations of one name are the same component only if every field matches. */
function sameShape(a: CompShape, b: CompShape): boolean {
    if (a.fields.size !== b.fields.size) return false;
    for (const [k, f] of a.fields) {
        const other = b.fields.get(k);
        if (other?.type.k !== f.type.k || other.enc !== f.enc || other.offset !== f.offset) return false;
    }
    return true;
}

function normalizePath(p: string): string {
    return p.split(sep).join('/').toLowerCase();
}

/**
 * The source file is passed in rather than taken from the node: `getSourceFile()`
 * walks parent pointers, which only exist once the program has bound — a side
 * effect of calling getTypeChecker(), and not something to depend on.
 */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Lower every `defineSystem` in `files`. Builtin component and resource shapes
 * come in from the caller — EHT is their authority, and inventing a second copy
 * here is exactly the drift the ABI hash exists to prevent.
 *
 * `files` is ONE PROGRAM — one game project, the unit pipeline/ cooks. A
 * component's identity is its declared name WITHIN that program; declaring one
 * name twice with different fields is a diagnostic, never an overwrite.
 */
export function lowerProgram(files: readonly string[], builtins: ReadonlyMap<string, CompShape>): LowerResult {
    const program = ts.createProgram([...files], {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        strict: true, noEmit: true, skipLibCheck: true, allowJs: false,
    });
    const comps = new Map<string, CompShape>(builtins);
    // A component's declared name and the const it is bound to are two different
    // things; move.ts happens to use one word for both, which is why this was
    // missing until a fixture used two.
    const bindings = new Map<string, string>();
    const consts = new Map<string, ConstValue>();
    const fns = new Map<string, EirFn>();
    // Why a function could not be lowered, reported at the CALL SITE rather than
    // where it was declared: a helper nothing calls has blocked nothing, and a
    // diagnostic for it is noise that buries the list of real blockers.
    const fnFailures = new Map<string, string>();
    const systems: EirSystem[] = [];
    const diagnostics: Diagnostic[] = [];
    const seen: string[] = [];
    const systemBindings = new Map<string, string>();
    const required: string[] = [];

    // ts normalises fileName to forward slashes; a caller on Windows will not
    // have. Comparing them raw lowers nothing and reports no error at all.
    const wanted = new Set(files.map(normalizePath));
    const sources = program.getSourceFiles()
        .filter((sf) => wanted.has(normalizePath(sf.fileName)) && !sf.isDeclarationFile);

    // Both scans carry the enclosing `const` name down instead of reading
    // node.parent: parent pointers exist only once the program has bound, which
    // is a side effect of getTypeChecker() and not a thing to depend on.
    /** `marked` is the `@compiled` tag from the enclosing statement, carried down
     *  to the `defineSystem` call the same way `binding` is. */
    type Visit = (node: ts.Node, binding: string | null, marked: boolean) => void;
    const walkTop = (sf: ts.SourceFile, visit: Visit): void => {
        const go = (node: ts.Node, binding: string | null, marked: boolean): void => {
            const here = marked || marksCompiled(node);
            visit(node, binding, here);
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
                go(node.initializer, node.name.text, here);
                return;
            }
            ts.forEachChild(node, (c) => go(c, null, here));
        };
        ts.forEachChild(sf, (c) => go(c, null, false));
    };

    // Constants and components first: a system in one file names both from another.
    for (const sf of sources) {
        walkTop(sf, (node) => {
            // The declaration's own name, not the binding walkTop passes DOWN to
            // an initializer: at the declaration node itself that is still null.
            if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
            const v = constValue(node.initializer);
            if (v !== null) consts.set(node.name.text, v);
        });
    }
    for (const sf of sources) {
        walkTop(sf, (node, binding) => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
            if (node.expression.text !== 'defineComponent') return;
            const shape = componentShape(node);
            if (!shape) {
                diagnostics.push({
                    file: sf.fileName, line: lineOf(sf, node),
                    kind: 'permanent', severity: 'note',
                    message: 'defineComponent needs a string literal name and an object literal of literal defaults',
                });
                return;
            }
            const existing = comps.get(shape.name);
            if (existing && !sameShape(existing, shape)) {
                diagnostics.push({
                    file: sf.fileName, line: lineOf(sf, node), kind: 'permanent', severity: 'note',
                    message: `component '${shape.name}' is already declared with a different shape`
                        + ` — one program cannot hold two`,
                });
                return;
            }
            comps.set(shape.name, shape);
            if (binding) bindings.set(binding, shape.name);
        });
    }

    // Functions before systems, and in dependency order by repeated passes: a
    // helper may call a helper declared later in the file.
    for (let pass = 0; pass < 2; pass++) {
        for (const sf of sources) {
            walkTop(sf, (node, binding) => {
                let name: string | null = null;
                let params: readonly ts.ParameterDeclaration[] | null = null;
                let body: ts.ConciseBody | null = null;
                if (ts.isFunctionDeclaration(node) && node.name && node.body) {
                    name = node.name.text; params = node.parameters; body = node.body;
                } else if (binding && ts.isArrowFunction(node)) {
                    name = binding; params = node.parameters; body = node.body;
                }
                if (!name || !params || !body || fns.has(name)) return;
                try {
                    fns.set(name, new SystemLowerer(comps, bindings, consts, fns, fnFailures)
                        .lowerFn(name, params, body));
                } catch (e) {
                    if (!(e instanceof NotInSubset)) throw e;
                    // Recorded on the last pass only: an earlier failure may just
                    // be a helper whose own callee is not lowered yet.
                    if (pass === 1) fnFailures.set(name, e.message);
                }
            });
        }
    }

    for (const sf of sources) {
        walkTop(sf, (node, binding, marked) => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
            if (node.expression.text !== 'defineSystem') return;
            const name = systemName(node, binding);
            seen.push(name);
            if (binding) systemBindings.set(binding, name);
            if (marked) required.push(name);
            try {
                const [params, fn] = node.arguments;
                if (!params || !fn || !ts.isArrowFunction(fn)) {
                    throw new NotInSubset(node, 'defineSystem takes a parameter array and an arrow function');
                }
                systems.push(new SystemLowerer(comps, bindings, consts, fns, fnFailures).lower(name, params, fn));
            } catch (e) {
                if (!(e instanceof NotInSubset)) throw e;
                diagnostics.push({
                    file: sf.fileName, line: lineOf(sf, e.node), message: e.message, kind: e.kind,
                    // The marker does not change WHY a system was refused, only
                    // whether anybody has to act on it.
                    severity: marked ? 'error' : 'note',
                    system: name,
                });
            }
        });
    }

    return { module: { systems, comps, fns }, diagnostics, seen, systemBindings, required };
}

/** `{ name: 'MoveSystem' }` if given, else the const it is assigned to. */
function systemName(call: ts.CallExpression, binding: string | null): string {
    const opts = call.arguments[2];
    if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const p of opts.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'name'
                && ts.isStringLiteral(p.initializer)) {
                return p.initializer.text;
            }
        }
    }
    return binding ?? '<anonymous>';
}
