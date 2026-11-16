// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    parse.ts
 * @brief   The GLSL ES 3.00 subset the engine's shaders are written in, as tokens and a tree.
 *
 * A preprocessor line (`#ifdef`, `#else`, ...) is kept as a node of its own wherever a declaration or a statement may stand, so
 * the WGSL written from the tree carries it at the same place: a twin is one body selected by the same symbols, not one body per
 * combination of them.
 */

export class GlslError extends Error {
    constructor(message: string, readonly line?: number) {
        super(line !== undefined ? `line ${line}: ${message}` : message);
    }
}

export interface Token { t: 'id' | 'num' | 'p' | 'pp' | 'eof'; v: string; line: number }

/** A node of the tree: `k` says which, the rest is that kind's. Kept as plain records so the tree is cheap to walk. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node = { k: string; line?: number; [field: string]: any };

export interface TypeSpec { quals: string[]; layout: string | null; type: string; array: Node | null; line: number }

const PUNCT = ['<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '^^', '<<', '>>',
    '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}'];

/** Tokens of GLSL text. Comments go; a `#` line is one 'pp' token. */
export function lex(src: string): Token[] {
    const out: Token[] = [];
    const text = src.replace(/\r\n?/g, '\n').replace(/\\\n/g, '');
    let i = 0, line = 1, lineStart = true;
    while (i < text.length) {
        const c = text[i]!;
        if (c === '\n') { line++; i++; lineStart = true; continue; }
        if (c === ' ' || c === '\t') { i++; continue; }
        if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const body = text.slice(i, end < 0 ? text.length : end + 2);
            line += (body.match(/\n/g) ?? []).length;
            i = end < 0 ? text.length : end + 2;
            continue;
        }
        if (c === '#' && lineStart) {
            let j = i;
            while (j < text.length && text[j] !== '\n') j++;
            out.push({ t: 'pp', v: text.slice(i, j).replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim(), line });
            i = j;
            continue;
        }
        lineStart = false;
        if (/[A-Za-z_]/.test(c)) {
            let j = i + 1;
            while (j < text.length && /\w/.test(text[j]!)) j++;
            out.push({ t: 'id', v: text.slice(i, j), line });
            i = j;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            const m = /^(0[xX][0-9a-fA-F]+[uU]?|(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?[fFuU]?)/.exec(text.slice(i))!;
            out.push({ t: 'num', v: m[0], line });
            i += m[0].length;
            continue;
        }
        const p = PUNCT.find((q) => text.startsWith(q, i));
        if (!p) throw new GlslError(`unexpected character '${c}'`, line);
        out.push({ t: 'p', v: p, line });
        i += p.length;
    }
    out.push({ t: 'eof', v: '', line });
    return out;
}

const QUALIFIERS = new Set(['in', 'out', 'inout', 'uniform', 'const', 'flat', 'smooth', 'centroid', 'highp', 'mediump', 'lowp', 'invariant']);
const DROPPED_QUALIFIERS = /^(highp|mediump|lowp|smooth|centroid|invariant)$/;
export const BASIC_TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3',
    'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'mat2x2', 'mat3x3', 'mat4x4', 'sampler2D', 'sampler2DArray', 'samplerCube',
    'sampler3D', 'isampler2D', 'usampler2D', 'sampler2DShadow']);

export interface ParseOptions {
    /** Read declarations only: a function's body is skipped, and what cannot be read is passed over (an engine header). */
    signaturesOnly?: boolean;
}

/** The tree of a token list; `knownStructs` are the type names declared before it (the engine's). */
export function parse(tokens: Token[], knownStructs: Iterable<string> = [], opts: ParseOptions = {}): { items: Node[]; structs: Set<string> } {
    let i = 0;
    const structs = new Set(knownStructs);
    const peek = (o = 0): Token => tokens[Math.min(i + o, tokens.length - 1)]!;
    const next = (): Token => {
        if (tokens[i]!.t === 'eof') throw new GlslError('unexpected end of the source', tokens[i]!.line);
        return tokens[i++]!;
    };
    const is = (v: string, o = 0): boolean => peek(o).v === v && peek(o).t !== 'num';
    const expect = (v: string): Token => { const t = next(); if (t.v !== v) throw new GlslError(`expected '${v}', found '${t.v}'`, t.line); return t; };
    const isType = (t: Token): boolean => t.t === 'id' && (BASIC_TYPES.has(t.v) || structs.has(t.v));
    const skipLayout = (o: number): number => { let d = 0; o++; do { if (peek(o).v === '(') d++; if (peek(o).v === ')') d--; o++; } while (d > 0); return o; };

    function typeSpec(): TypeSpec {
        const quals: string[] = [];
        let layout: string | null = null;
        for (;;) {
            const t = peek();
            if (t.t === 'id' && t.v === 'layout') {
                next(); expect('(');
                const parts: string[] = [];
                while (!is(')')) parts.push(next().v);
                expect(')');
                layout = parts.join('');
                continue;
            }
            if (t.t === 'id' && QUALIFIERS.has(t.v)) { quals.push(next().v); continue; }
            break;
        }
        const t = next();
        if (!isType(t)) throw new GlslError(`expected a type, found '${t.v}'`, t.line);
        let array: Node | null = null;
        if (is('[')) { next(); array = is(']') ? null : expr(); expect(']'); }
        return { quals: quals.filter((q) => !DROPPED_QUALIFIERS.test(q)), layout, type: t.v, array, line: t.line };
    }

    function startsDeclaration(): boolean {
        let o = 0;
        for (;;) {
            const t = peek(o);
            if (t.t === 'id' && t.v === 'layout') { o = skipLayout(o); continue; }
            if (t.t === 'id' && QUALIFIERS.has(t.v)) { o++; continue; }
            return isType(t) && (peek(o + 1).t === 'id' || peek(o + 1).v === '[');
        }
    }

    function declarators(spec: TypeSpec): Node {
        const decls: Node[] = [];
        for (;;) {
            const name = next();
            if (name.t !== 'id') throw new GlslError(`expected a name, found '${name.v}'`, name.line);
            let array = spec.array;
            if (is('[')) { next(); array = is(']') ? null : expr(); expect(']'); }
            let init: Node | null = null;
            if (is('=')) { next(); init = assignment(); }
            decls.push({ k: 'decl', name: name.v, array, init, line: name.line });
            if (is(',')) { next(); continue; }
            break;
        }
        expect(';');
        return { k: 'var', spec, decls, line: spec.line };
    }

    // ---- expressions (precedence climbing) ----
    const BIN = [['||'], ['^^'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    const ASSIGN = ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='];
    function expr(): Node {
        const e = assignment();
        if (is(',')) throw new GlslError('the comma operator is not supported', peek().line);
        return e;
    }
    function assignment(): Node {
        const lhs = ternary();
        const t = peek();
        if (t.t === 'p' && ASSIGN.includes(t.v)) {
            next();
            return { k: 'assign', op: t.v, lhs, rhs: assignment(), line: t.line };
        }
        return lhs;
    }
    function ternary(): Node {
        const c = binary(0);
        if (is('?')) {
            const line = next().line;
            const a = assignment();
            expect(':');
            return { k: 'cond', c, a, b: assignment(), line };
        }
        return c;
    }
    function binary(level: number): Node {
        if (level === BIN.length) return unary();
        let l = binary(level + 1);
        while (peek().t === 'p' && BIN[level]!.includes(peek().v)) {
            const op = next();
            l = { k: 'bin', op: op.v, l, r: binary(level + 1), line: op.line };
        }
        return l;
    }
    function unary(): Node {
        const t = peek();
        if (t.t === 'p' && ['+', '-', '!', '~', '++', '--'].includes(t.v)) {
            next();
            return { k: t.v === '++' || t.v === '--' ? 'preinc' : 'unary', op: t.v, e: unary(), line: t.line };
        }
        return postfix();
    }
    function postfix(): Node {
        let e = primary();
        for (;;) {
            const t = peek();
            if (t.t === 'p' && t.v === '(' && (e.k === 'id' || e.k === 'type')) {
                next();
                const args: Node[] = [];
                if (!is(')')) { for (;;) { args.push(assignment()); if (is(',')) { next(); continue; } break; } }
                expect(')');
                e = { k: 'call', name: e.name, args, line: t.line };
                continue;
            }
            if (t.t === 'p' && t.v === '[') { next(); const idx = expr(); expect(']'); e = { k: 'index', e, idx, line: t.line }; continue; }
            if (t.t === 'p' && t.v === '.') { next(); e = { k: 'field', e, f: next().v, line: t.line }; continue; }
            if (t.t === 'p' && (t.v === '++' || t.v === '--')) { next(); e = { k: 'postinc', op: t.v, e, line: t.line }; continue; }
            return e;
        }
    }
    function primary(): Node {
        const t = next();
        if (t.t === 'num') return { k: 'num', v: t.v, line: t.line };
        if (t.t === 'id') {
            if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v, line: t.line };
            return { k: isType(t) ? 'type' : 'id', name: t.v, line: t.line };
        }
        if (t.v === '(') { const e = expr(); expect(')'); return { k: 'paren', e, line: t.line }; }
        throw new GlslError(`unexpected '${t.v}' in an expression`, t.line);
    }

    // ---- statements ----
    function block(): Node {
        expect('{');
        const body: Node[] = [];
        while (!is('}')) body.push(statement());
        expect('}');
        return { k: 'block', body };
    }
    function statement(): Node {
        const t = peek();
        if (t.t === 'pp') { next(); return { k: 'pp', v: t.v, line: t.line }; }
        if (t.t === 'p' && t.v === '{') return block();
        if (t.t === 'p' && t.v === ';') { next(); return { k: 'empty' }; }
        if (t.t === 'id') {
            switch (t.v) {
                case 'if': {
                    next(); expect('('); const c = expr(); expect(')');
                    const a = statement();
                    let b: Node | null = null;
                    if (is('else')) { next(); b = statement(); }
                    return { k: 'if', c, a, b, line: t.line };
                }
                case 'for': {
                    next(); expect('(');
                    let init: Node | null = null;
                    if (startsDeclaration()) init = declarators(typeSpec());
                    else if (is(';')) next();
                    else { init = { k: 'expr', e: expr() }; expect(';'); }
                    const c = is(';') ? null : expr(); expect(';');
                    const step = is(')') ? null : expr(); expect(')');
                    return { k: 'for', init, c, step, body: statement(), line: t.line };
                }
                case 'while': {
                    next(); expect('('); const c = expr(); expect(')');
                    return { k: 'while', c, body: statement(), line: t.line };
                }
                case 'return': { next(); const e = is(';') ? null : expr(); expect(';'); return { k: 'return', e, line: t.line }; }
                case 'break': case 'continue': case 'discard': next(); expect(';'); return { k: t.v, line: t.line };
                default: break;
            }
        }
        if (startsDeclaration()) return declarators(typeSpec());
        const e = expr();
        expect(';');
        return { k: 'expr', e, line: t.line };
    }

    /** A struct's or a block's fields. A preprocessor line among them is refused in a shader's own struct (its two shapes cannot be one
     *  WGSL struct) and passed over in an engine header (read for names only). */
    function fields(strict = false): Node[] {
        const out: Node[] = [];
        while (!is('}')) {
            if (peek().t === 'pp') {
                if (strict) throw new GlslError('a preprocessor line inside a struct is not supported', peek().line);
                next();
                continue;
            }
            const spec = typeSpec();
            for (;;) {
                const name = next().v;
                let array = spec.array;
                if (is('[')) { next(); array = expr(); expect(']'); }
                out.push({ k: 'field', name, type: spec.type, array });
                if (is(',')) { next(); continue; }
                break;
            }
            expect(';');
        }
        return out;
    }

    // ---- top level ----
    function external(): Node {
        const t = peek();
        if (t.t === 'pp') { next(); return { k: 'pp', v: t.v, line: t.line }; }
        if (t.t === 'id' && t.v === 'precision') { while (!is(';')) next(); next(); return { k: 'precision' }; }
        if (t.v === ';') { next(); return { k: 'empty' }; }
        if (t.t === 'id' && t.v === 'struct') {
            next();
            const name = next().v;
            structs.add(name);
            expect('{');
            const f = fields(!opts.signaturesOnly);
            expect('}');
            expect(';');
            return { k: 'struct', name, fields: f, line: t.line };
        }
        // An interface block, `uniform Name { ... };` (the engine's headers).
        if (t.t === 'id' && (t.v === 'uniform' || t.v === 'layout')) {
            const o = t.v === 'layout' ? skipLayout(0) : 0;
            if (peek(o).v === 'uniform' && peek(o + 1).t === 'id' && peek(o + 2).v === '{') {
                i += o + 1;
                const name = next().v;
                expect('{');
                const f = fields();
                expect('}');
                const instance = peek().t === 'id' ? next().v : null;
                expect(';');
                return { k: 'block', name, fields: f, instance, line: t.line };
            }
        }
        const spec = typeSpec();
        const name = peek();
        if (name.t === 'id' && peek(1).v === '(') {
            next(); next();
            const params: Node[] = [];
            if (!is(')')) {
                if (is('void') && peek(1).v === ')') next();
                else {
                    for (;;) {
                        const ps = typeSpec();
                        let pname: string | null = null;
                        let array = ps.array;
                        if (peek().t === 'id') pname = next().v;
                        if (is('[')) { next(); array = expr(); expect(']'); }
                        params.push({ k: 'param', ...ps, name: pname, array });
                        if (is(',')) { next(); continue; }
                        break;
                    }
                }
            }
            expect(')');
            if (is(';')) { next(); return { k: 'proto', ret: spec, name: name.v, params, line: name.line }; }
            if (opts.signaturesOnly) {
                let d = 0;
                do { const tk = next(); if (tk.v === '{') d++; if (tk.v === '}') d--; } while (d > 0);
                return { k: 'proto', ret: spec, name: name.v, params, line: name.line };
            }
            return { k: 'fn', ret: spec, name: name.v, params, body: block(), line: name.line };
        }
        return declarators(spec);
    }

    const items: Node[] = [];
    while (peek().t !== 'eof') {
        if (opts.signaturesOnly) {
            // A header may hold what this subset does not read; what cannot be read is skipped to the next ';' or '}'.
            const save = i;
            try { items.push(external()); } catch {
                i = save;
                let d = 0;
                while (tokens[i]!.t !== 'eof') {
                    const tk = tokens[i++]!;
                    if (tk.v === '{') d++;
                    if (tk.v === '}') { d--; if (d <= 0) break; }
                    if (tk.v === ';' && d === 0) break;
                }
            }
            continue;
        }
        items.push(external());
    }
    return { items, structs };
}
