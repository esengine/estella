// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    frontend.ts
 * @brief   TypeScript AST -> EIR-high (docs/REARCH_AOT.md §4.1, §3.3).
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
 *          Nothing here throws on code it cannot handle. Anything outside the
 *          subset produces a Diagnostic naming the line and the reason, and its
 *          system is simply not compiled — §3.2's no-cliff rule, which is what
 *          lets this ship before it is finished.
 */
import { sep } from 'node:path';
import ts from 'typescript';
import {
    BOOL, ENTITY, F64,
    type CompShape, type EirModule, type EirSystem, type EirType,
    type Expr, type Local, type Place, type QueryArg, type Stmt, type BinOp,
} from './eir';

export interface Diagnostic {
    readonly file: string;
    readonly line: number;
    readonly message: string;
    /** The system this killed, when the failure happened inside one. */
    readonly system?: string;
}

export interface LowerResult {
    readonly module: EirModule;
    readonly diagnostics: readonly Diagnostic[];
    /** Systems seen, whether or not they compiled — the coverage gate's denominator. */
    readonly seen: readonly string[];
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

/** Thrown internally to abandon one system; never escapes lowerProgram. */
class NotInSubset extends Error {
    constructor(readonly node: ts.Node, message: string) { super(message); }
}

class SystemLowerer {
    private readonly locals: Local[] = [];
    private next = 0;
    private readonly scope = new Map<string, Local>();

    constructor(
        private readonly comps: Map<string, CompShape>,
        /** `const Speed = defineComponent('FixtureSpeed', …)` — a query names the
         *  BINDING, and the shape is filed under the declared name. */
        private readonly bindings: ReadonlyMap<string, string>,
    ) {}

    private compName(binding: string): string {
        return this.bindings.get(binding) ?? binding;
    }

    private define(name: string, type: EirType): Local {
        const l: Local = { id: this.next++, name, type };
        this.locals.push(l);
        this.scope.set(name, l);
        return l;
    }

    private lookup(node: ts.Node, name: string): Local {
        const l = this.scope.get(name);
        if (!l) throw new NotInSubset(node, `'${name}' is not a value this system declared`);
        return l;
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
            if (kind === 'Res') {
                const arg = el.arguments[0];
                if (!arg || !ts.isIdentifier(arg)) throw new NotInSubset(el, 'Res(...) needs a named resource');
                return { k: 'res', name: this.compName(arg.text) } as EirType;
            }
            if (kind !== 'Query') throw new NotInSubset(el, `'${kind}' is not a parameter intrinsic`);
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
        if (ts.isExpressionStatement(node)) return [this.assignment(node.expression)];
        if (ts.isBlock(node)) return node.statements.flatMap((s) => this.stmt(s));
        throw new NotInSubset(node, `${ts.SyntaxKind[node.kind]} is not a statement this subset lowers`);
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
        const elements = decl.name.elements;
        if (elements.length !== qt.args.length + 1) {
            throw new NotInSubset(node, `the row binds ${elements.length} names but the query yields ${qt.args.length + 1}`);
        }

        let entity: number | null = null;
        const binds: number[] = [];
        elements.forEach((el, i) => {
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

        const body = ts.isBlock(node.statement)
            ? node.statement.statements.flatMap((s) => this.stmt(s))
            : this.stmt(node.statement);
        return { s: 'rowLoop', query: { p: 'local', id: q.id }, entity, binds, body };
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
            throw new NotInSubset(node, `'${node.operatorToken.getText()}' is not an assignment this subset lowers`);
        }
        return { s: 'assign', target, value: this.expr(node.right) };
    }

    /** A place is a local, or a dotted path from one. Nothing else is addressable. */
    private place(node: ts.Expression): Place {
        if (ts.isIdentifier(node)) return { p: 'local', id: this.lookup(node, node.text).id };
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
            const t = shape.fields.get(key);
            if (!t) throw new NotInSubset(node, `'${base.type.name}' has no field '${key}'`);
            return t;
        }
        if (base.type.k === 'res') {
            const shape = this.comps.get(base.type.name);
            const t = shape?.fields.get(key);
            if (!t) throw new NotInSubset(node, `resource '${base.type.name}' has no field '${key}'`);
            return t;
        }
        throw new NotInSubset(node, `'${base.name}' has no fields to read`);
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
        if (ts.isBinaryExpression(node)) {
            const op = BIN_OPS.get(node.operatorToken.kind);
            if (!op) throw new NotInSubset(node, `operator '${node.operatorToken.getText()}' is not in this subset`);
            const l = this.expr(node.left);
            const r = this.expr(node.right);
            const type = op === '<' || op === '<=' || op === '>' || op === '>=' || op === '==' || op === '!='
                ? BOOL : F64;
            return { e: 'bin', op, l, r, type };
        }
        if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
            return { e: 'read', place: this.place(node), type: this.placeType(node) };
        }
        throw new NotInSubset(node, `${ts.SyntaxKind[node.kind]} is not an expression this subset lowers`);
    }
}

/** `defineComponent('Mover', { speed: 100 })` -> a shape, or null if not literal. */
function componentShape(call: ts.CallExpression): CompShape | null {
    const [nameArg, defaults] = call.arguments;
    if (!nameArg || !ts.isStringLiteral(nameArg)) return null;
    if (!defaults || !ts.isObjectLiteralExpression(defaults)) return null;
    const fields = new Map<string, EirType>();
    for (const prop of defaults.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return null;
        const init = prop.initializer;
        if (ts.isNumericLiteral(init)) fields.set(prop.name.text, F64);
        else if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) {
            fields.set(prop.name.text, BOOL);
        } else return null;
    }
    return { name: nameArg.text, fields };
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
    const systems: EirSystem[] = [];
    const diagnostics: Diagnostic[] = [];
    const seen: string[] = [];

    // ts normalises fileName to forward slashes; a caller on Windows will not
    // have. Comparing them raw lowers nothing and reports no error at all.
    const wanted = new Set(files.map(normalizePath));
    const sources = program.getSourceFiles()
        .filter((sf) => wanted.has(normalizePath(sf.fileName)) && !sf.isDeclarationFile);

    // Both scans carry the enclosing `const` name down instead of reading
    // node.parent: parent pointers exist only once the program has bound, which
    // is a side effect of getTypeChecker() and not a thing to depend on.
    type Visit = (node: ts.Node, binding: string | null) => void;
    const walkTop = (sf: ts.SourceFile, visit: Visit): void => {
        const go = (node: ts.Node, binding: string | null): void => {
            visit(node, binding);
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
                go(node.initializer, node.name.text);
                return;
            }
            ts.forEachChild(node, (c) => go(c, null));
        };
        ts.forEachChild(sf, (c) => go(c, null));
    };

    // Components first: a system in one file names a component declared in another.
    for (const sf of sources) {
        walkTop(sf, (node, binding) => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
            if (node.expression.text !== 'defineComponent') return;
            const shape = componentShape(node);
            if (!shape) {
                diagnostics.push({
                    file: sf.fileName, line: lineOf(sf, node),
                    message: 'defineComponent needs a string literal name and an object literal of literal defaults',
                });
                return;
            }
            comps.set(shape.name, shape);
            if (binding) bindings.set(binding, shape.name);
        });
    }

    for (const sf of sources) {
        walkTop(sf, (node, binding) => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
            if (node.expression.text !== 'defineSystem') return;
            const name = systemName(node, binding);
            seen.push(name);
            try {
                const [params, fn] = node.arguments;
                if (!params || !fn || !ts.isArrowFunction(fn)) {
                    throw new NotInSubset(node, 'defineSystem takes a parameter array and an arrow function');
                }
                systems.push(new SystemLowerer(comps, bindings).lower(name, params, fn));
            } catch (e) {
                if (!(e instanceof NotInSubset)) throw e;
                diagnostics.push({
                    file: sf.fileName, line: lineOf(sf, e.node), message: e.message, system: name,
                });
            }
        });
    }

    return { module: { systems, comps }, diagnostics, seen };
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
