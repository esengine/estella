// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    transpile.ts
 * @brief   A shader's own GLSL fragment, written as the WGSL twin the engine assembles behind its injected WGSL header.
 *
 * The same body under the same `#ifdef`s, reading `mc.` for its params, `VSOut` for its varyings, and the engine's WGSL
 * functions by name. Every construct it does not know how to write is an error naming the line, never a guess: a shader the
 * transpiler cannot write keeps whatever twin it was given, and says why.
 */
import type { DomainApi, EngineShaderApi, ParamQualifier } from './api';
import { GlslError, lex, parse, type Node } from './parse';

// ---- types ----
const VEC = /^([biu]?)vec([234])$/;
const MAT = /^mat([234])(?:x([234]))?$/;
const SCALARS = new Set(['float', 'int', 'uint', 'bool']);
type Scalar = 'float' | 'int' | 'uint' | 'bool';
const SCALAR_OF_PREFIX: Record<string, Scalar> = { '': 'float', i: 'int', u: 'uint', b: 'bool' };
const PREFIX_OF_SCALAR: Record<Scalar, string> = { float: '', int: 'i', uint: 'u', bool: 'b' };
const W_SCALAR: Record<Scalar, string> = { float: 'f32', int: 'i32', uint: 'u32', bool: 'bool' };

function comps(t: string): number { const v = VEC.exec(t); if (v) return Number(v[2]); return SCALARS.has(t) ? 1 : 0; }
function scalarOf(t: string): Scalar | null {
    const v = VEC.exec(t);
    if (v) return SCALAR_OF_PREFIX[v[1]!]!;
    if (MAT.test(t)) return 'float';
    return SCALARS.has(t) ? t as Scalar : null;
}
function vecOf(scalar: Scalar, n: number): string { return n === 1 ? scalar : `${PREFIX_OF_SCALAR[scalar]}vec${n}`; }
const isVec = (t: string): boolean => VEC.test(t);
const isMat = (t: string): boolean => MAT.test(t);
const isSampler = (t: string): boolean => /^[iu]?sampler/.test(t);

function wType(t: string, array?: number | null): string {
    let w: string;
    const v = VEC.exec(t), m = MAT.exec(t);
    if (SCALARS.has(t)) w = W_SCALAR[t as Scalar];
    else if (v) w = v[1] === 'b' ? `vec${v[2]}<bool>` : `vec${v[2]}${({ '': 'f', i: 'i', u: 'u' } as Record<string, string>)[v[1]!]}`;
    else if (m) w = `mat${m[1]}x${m[2] ?? m[1]}f`;
    else if (t === 'void') w = '';
    else w = t;
    return array ? `array<${w}, ${array}>` : w;
}

/** WGSL's keywords and reserved words, and its builtins GLSL does not reserve: a GLSL name among them is written with a `_`. */
const RESERVED = new Set(('alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop ' +
    'override requires return struct switch true var while NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await ' +
    'become binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast ' +
    'consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern ' +
    'external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface ' +
    'layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective ' +
    'null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ' +
    'ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std ' +
    'subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use ' +
    'using varying virtual volatile wgsl where with writeonly yield sampler texture_2d f32 i32 u32 bool array ptr atomic ' +
    'dpdx dpdy dpdxCoarse dpdxFine dpdyCoarse dpdyFine fwidthCoarse fwidthFine select atan2 inverseSqrt bitcast faceForward ' +
    'textureSample textureSampleLevel textureSampleGrad textureSampleBias textureSampleCompare textureLoad textureStore textureDimensions ' +
    'textureNumLevels textureNumLayers arrayLength countOneBits countLeadingZeros countTrailingZeros reverseBits extractBits insertBits ' +
    'firstLeadingBit firstTrailingBit quantizeToF16 saturate vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u mat2x2f mat3x3f mat4x4f').split(' '));
const safe = (n: string): string => (RESERVED.has(n) ? `${n}_` : n);

/**
 * Engine functions whose GLSL writes `out`/`inout` parameters and whose WGSL returns them instead: the argument positions, the
 * fields that carry them, and whether the GLSL adds to what it is given (an `inout` that accumulates) or replaces it.
 */
const BRIDGES: Record<string, { outs: number[]; fields: string[]; accumulate: boolean }> = {
    shadeLight: { outs: [15, 16, 17], fields: ['lit', 'gloss', 'extra'], accumulate: true },
};

const BUILTINS: Record<string, string> = {
    abs: 'abs', sign: 'sign', floor: 'floor', ceil: 'ceil', fract: 'fract', trunc: 'trunc', round: 'round', roundEven: 'round',
    sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', exp: 'exp', log: 'log', exp2: 'exp2', log2: 'log2', sqrt: 'sqrt',
    inversesqrt: 'inverseSqrt', radians: 'radians', degrees: 'degrees', normalize: 'normalize', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    min: 'min', max: 'max', clamp: 'clamp', mix: 'mix', step: 'step', smoothstep: 'smoothstep', pow: 'pow', reflect: 'reflect',
    refract: 'refract', faceforward: 'faceForward', dFdx: 'dpdx', dFdy: 'dpdy', fwidth: 'fwidth', length: 'length', distance: 'distance',
    dot: 'dot', cross: 'cross', transpose: 'transpose', determinant: 'determinant', any: 'any', all: 'all',
};
const SPECIAL_BUILTINS = new Set(['mod', 'atan', 'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'not',
    'floatBitsToUint', 'floatBitsToInt', 'uintBitsToFloat', 'intBitsToFloat', 'inverse', 'isnan', 'isinf']);
const FLOAT_RESULT = new Set(['length', 'distance', 'dot', 'determinant']);
const DERIVATIVE = /\b(textureSample|textureSampleBias|dpdx|dpdy|fwidth)\(/;

/** `#pragma param` types as the material block declares them. */
const PARAM_TYPES: Record<string, string> = { float: 'float', int: 'int', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4', color: 'vec4', texture: 'sampler2D', textureArray: 'sampler2DArray' };

// ---- the environment ----
interface Field { name: string; type: string; array: number | null }
interface FnSig { ret: string; params: { type: string; qual: ParamQualifier; array: number | null }[] }
interface Global { type: string; array: number | null; wgsl: string | null }
interface Env {
    domain: string;
    structs: Map<string, Field[]>;
    fns: Map<string, FnSig>;
    globals: Map<string, Global>;
    params: Map<string, string>;
    varyings: Map<string, string>;
    arity: Record<string, number>;
}

function envOf(api: EngineShaderApi, source: string): Env {
    const domain = /^#pragma domain\s+(\w+)/m.exec(source)?.[1] ?? 'Unlit';
    const d: DomainApi | undefined = api.domains[domain];
    if (!d) throw new GlslError(`domain '${domain}' is not one the transpiler knows`);
    const params = new Map<string, string>();
    for (const m of source.matchAll(/^#pragma param\s+(\w+)\s+(\w+)/gm)) {
        const t = PARAM_TYPES[m[2]!];
        if (!t) throw new GlslError(`#pragma param type '${m[2]}' is not one the transpiler knows`);
        params.set(m[1]!, t);
    }
    return {
        domain,
        structs: new Map(Object.entries(d.structs).map(([n, f]) => [n, f.map(([name, type, array]) => ({ name, type, array }))])),
        fns: new Map(Object.entries(d.fns).map(([n, [ret, ps]]) => [n, { ret, params: ps.map(([type, qual, array]) => ({ type, qual, array })) }])),
        globals: new Map(Object.entries(d.globals).map(([n, [type, array, wgsl]]) => [n, { type, array, wgsl }])),
        params,
        varyings: new Map(Object.entries(d.varyings)),
        arity: api.wgslArity,
    };
}

// ---- values ----
interface Val { code: string; type: string; abstract?: boolean; array?: number | null }
interface LVal { code: string; type: string; base?: string; swizzle?: string; ptr?: string; array?: number | null }
interface Binding { type: string; array?: number | null; code: string; ptr?: string; sampler?: SamplerPair }
interface SamplerPair { tex: string; smp: string }
interface Output { name: string; type: string; location: number; guard: { cond: string; neg: boolean; elif?: boolean }[] }

class Scope {
    private readonly vars = new Map<string, Binding>();
    constructor(private readonly parent: Scope | null = null) {}
    child(): Scope { return new Scope(this); }
    set(n: string, v: Binding): void { this.vars.set(n, v); }
    get(n: string): Binding | undefined { return this.vars.get(n) ?? this.parent?.get(n); }
}

/**
 * The WGSL twin of a shader's GLSL fragment section, for the engine to assemble behind its WGSL header (a `#pragma fragment wgsl`
 * body). `api` is the engine's header as engineApi.generated.ts reads it. Throws a GlslError naming what it cannot write.
 */
export function transpileFragment(source: string, api: EngineShaderApi): string {
    const sections = [...source.matchAll(/^#pragma fragment[ \t]*\r?\n([\s\S]*?)^#pragma end/gm)];
    if (sections.length !== 1) throw new GlslError(`expected one GLSL fragment section, found ${sections.length}`);
    const env = envOf(api, source);
    if (env.varyings.size === 0) throw new GlslError(`the ${env.domain} domain gives a fragment no VSOut the transpiler knows`);
    const tree = parse(lex(sections[0]![1]!), env.structs.keys());
    return new Emitter(env, tree.items).run();
}

class Emitter {
    private readonly structs: Map<string, Field[]>;
    private readonly consts = new Map<string, Global & { value?: number }>();
    private readonly fns = new Map<string, { ret: string; params: Node[]; node: Node; wname: string }[]>();
    private readonly outputs: Output[] = [];
    private readonly samplers = new Map<string, SamplerPair>();
    private readonly helpers = new Map<string, string>();
    private usesFront = false;
    private tmp = 0;
    private ret = 'void';
    private assigned = new Set<string>();

    constructor(private readonly env: Env, private readonly items: Node[]) {
        this.structs = new Map(env.structs);
    }

    private err(msg: string, line?: number): never { throw new GlslError(msg, line); }

    run(): string {
        const out: string[] = [];
        const ppStack: Output['guard'] = [];
        for (const it of this.items) {
            if (it.k === 'struct') this.structs.set(it.name, it.fields.map((f: Node) => ({ name: f.name, type: f.type, array: f.array ? this.constInt(f.array) : null })));
            if (it.k === 'fn') {
                const list = this.fns.get(it.name) ?? [];
                list.push({ ret: it.ret.type, params: it.params, node: it, wname: '' });
                this.fns.set(it.name, list);
            }
        }
        for (const [name, list] of this.fns) list.forEach((f, i) => { f.wname = name === 'main' ? 'es_main' : safe(list.length > 1 ? `${name}_${i}` : name); });
        if (!this.fns.has('main')) this.err('a fragment section without main()');

        for (const it of this.items) {
            switch (it.k) {
                case 'pp': this.trackPp(ppStack, it); out.push(it.v); break;
                case 'precision': case 'empty': case 'proto': break;
                case 'struct': {
                    const fields = this.structs.get(it.name)!;
                    out.push(`struct ${it.name} {\n${fields.map((f) => `    ${safe(f.name)} : ${wType(f.type, f.array)},`).join('\n')}\n};`);
                    break;
                }
                case 'block': this.err('an interface block in a shader body is not supported', it.line); break;
                case 'var': out.push(...this.globalVar(it, ppStack)); break;
                case 'fn': out.push(this.fn(it)); break;
                default: this.err(`unexpected ${it.k}`, it.line);
            }
        }
        if (ppStack.length) this.err('an #if without its #endif');
        out.push(...this.entry());
        const declared: Output[] = [];
        for (const o of this.outputs) {
            const prior = declared.find((d) => d.name === o.name);
            if (prior && prior.type !== o.type) this.err(`output '${o.name}' is declared as ${prior.type} and as ${o.type}`);
            if (!prior) declared.push(o);
        }
        // Declared once, at the top, whatever branch declared them: the body writes them under conditions of its own.
        const outputs = declared.map((o) => `var<private> ${safe(o.name)} : ${wType(o.type)};`);
        return dropEmptyConditionals([...this.helpers.values(), ...outputs, ...out].join('\n'));
    }

    private trackPp(stack: Output['guard'], it: Node): void {
        const m = /^#\s*(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/.exec(it.v);
        if (!m) this.err(`preprocessor line '${it.v}' is not supported`, it.line);
        const top = stack[stack.length - 1];
        switch (m[1]) {
            case 'ifdef': stack.push({ cond: `defined(${m[2]})`, neg: false }); break;
            case 'ifndef': stack.push({ cond: `defined(${m[2]})`, neg: true }); break;
            case 'if': stack.push({ cond: `(${m[2]})`, neg: false }); break;
            case 'else': if (top) top.neg = !top.neg; break;
            case 'elif': if (top) top.elif = true; break;
            default: stack.pop();
        }
    }

    private constInt(e: Node): number {
        if (e.k === 'num') return Number.parseInt(e.v, 10);
        if (e.k === 'id' && this.consts.get(e.name)?.value !== undefined) return this.consts.get(e.name)!.value!;
        return this.err('an array size must be a literal or a const of the shader', e.line);
    }

    private globalVar(it: Node, ppStack: Output['guard']): string[] {
        const q: string[] = it.spec.quals;
        const type: string = it.spec.type;
        const lines: string[] = [];
        for (const d of it.decls as Node[]) {
            const array = d.array ? this.constInt(d.array) : null;
            if (q.includes('in')) {
                if (!this.env.varyings.has(d.name)) this.err(`varying '${d.name}' is not one the engine's VSOut carries`, d.line);
                continue;
            }
            if (q.includes('out')) {
                if (ppStack.some((f) => f.elif)) this.err('an output declared under #elif is not supported', d.line);
                const loc = /location=(\d+)/.exec(it.spec.layout ?? '');
                this.outputs.push({ name: d.name, type, location: loc ? Number(loc[1]) : 0, guard: ppStack.map((f) => ({ ...f })) });
                continue;
            }
            if (q.includes('uniform')) {
                if (isSampler(type)) {
                    if (type !== 'sampler2D') this.err(`${type} is not supported yet`, d.line);
                    if (d.name === 'u_textures') {
                        for (let u = 0; u < (array ?? 1); u++) this.samplers.set(`u_textures[${u}]`, { tex: `t${u}`, smp: `s${u}` });
                    } else this.samplers.set(d.name, { tex: d.name, smp: `${d.name}_s` });
                    continue;
                }
                if (!this.env.params.has(d.name)) this.err(`uniform '${d.name}' is not a #pragma param, so the engine gives it no place in the material block`, d.line);
                continue;
            }
            if (q.includes('const')) {
                if (!d.init) this.err('a const without a value', d.line);
                const init = this.convert(this.expr(d.init, new Scope()), type, d.line);
                const value = d.init.k === 'num' && /^\d+$/.test(d.init.v) ? Number(d.init.v) : undefined;
                this.consts.set(d.name, { type, array, wgsl: safe(d.name), value });
                lines.push(`const ${safe(d.name)} : ${wType(type, array)} = ${init.code};`);
            } else {
                this.consts.set(d.name, { type, array, wgsl: safe(d.name) });
                const init = d.init ? ` = ${this.convert(this.expr(d.init, new Scope()), type, d.line).code}` : '';
                lines.push(`var<private> ${safe(d.name)} : ${wType(type, array)}${init};`);
            }
        }
        return lines;
    }

    // ---- functions ----
    private fn(it: Node): string {
        const f = this.fns.get(it.name)!.find((x) => x.node === it)!;
        this.assigned = assignedNames(it.body, (name) => this.writtenArgs(name));
        const scope = new Scope();
        const params: string[] = [];
        const prologue: string[] = [];
        for (const p of it.params as Node[]) {
            if (!p.name) continue;
            const array = p.array ? this.constInt(p.array) : null;
            const name = safe(p.name);
            if (isSampler(p.type)) {
                params.push(`${name} : texture_2d<f32>`, `${name}_s : sampler`);
                scope.set(p.name, { type: p.type, code: name, sampler: { tex: name, smp: `${name}_s` } });
                continue;
            }
            if (p.quals.includes('out') || p.quals.includes('inout')) {
                params.push(`${name} : ptr<function, ${wType(p.type, array)}>`);
                scope.set(p.name, { type: p.type, array, code: `(*${name})`, ptr: name });
                continue;
            }
            if (this.assigned.has(p.name)) {
                // A WGSL parameter cannot be written; the GLSL one can, so it becomes a variable of the same name.
                params.push(`${name}_in : ${wType(p.type, array)}`);
                prologue.push(`    var ${name} = ${name}_in;`);
            } else params.push(`${name} : ${wType(p.type, array)}`);
            scope.set(p.name, { type: p.type, array, code: name });
        }
        this.ret = it.ret.type;
        const body = this.block(it.body.body, scope, 1);
        const ret = it.ret.type === 'void' ? '' : ` -> ${wType(it.ret.type)}`;
        const text = `fn ${f.wname}(${params.join(', ')})${ret} {\n${[...prologue, ...body].join('\n')}\n}`;
        // A texture read in a branch is as defined as GLSL leaves it; WGSL would refuse it, so the check is off where one is.
        return DERIVATIVE.test(text) ? `@diagnostic(off, derivative_uniformity)\n${text}` : text;
    }

    /** The argument positions a call of `name` writes: the source's own out/inout parameters, a bridged engine function's outs. */
    private writtenArgs(name: string): Set<number> {
        const own = this.fns.get(name);
        if (own) return new Set(own.flatMap((f) => f.params.map((p, i) => (p.quals.includes('out') || p.quals.includes('inout') ? i : -1))).filter((i) => i >= 0));
        return new Set(BRIDGES[name]?.outs ?? []);
    }

    private block(stmts: Node[], scope: Scope, depth: number): string[] {
        const inner = scope.child();
        return stmts.flatMap((s) => this.stmt(s, inner, depth));
    }

    private body(s: Node, scope: Scope, depth: number): string[] {
        return s.k === 'block' ? this.block(s.body, scope, depth + 1) : this.stmt(s, scope.child(), depth + 1);
    }

    private stmt(s: Node, scope: Scope, depth: number): string[] {
        const ind = '    '.repeat(depth);
        switch (s.k) {
            case 'pp':
                if (!/^#\s*(ifdef|ifndef|if|elif|else|endif)\b/.test(s.v)) this.err(`preprocessor line '${s.v}' is not supported`, s.line);
                return [s.v];
            case 'empty': return [];
            case 'block': return [`${ind}{`, ...this.block(s.body, scope, depth + 1), `${ind}}`];
            case 'var': return this.localVar(s, scope, ind);
            case 'expr': return this.exprStmt(s.e, scope, ind, s.line);
            case 'if': {
                const out = [`${ind}if (${strip(this.convert(this.expr(s.c, scope), 'bool', s.line).code)}) {`, ...this.body(s.a, scope, depth)];
                let b: Node | null = s.b;
                while (b) {
                    if (b.k === 'if') {
                        out.push(`${ind}} else if (${strip(this.convert(this.expr(b.c, scope), 'bool', b.line).code)}) {`, ...this.body(b.a, scope, depth));
                        b = b.b;
                    } else { out.push(`${ind}} else {`, ...this.body(b, scope, depth)); b = null; }
                }
                out.push(`${ind}}`);
                return out;
            }
            case 'for': {
                const inner = scope.child();
                let init = '';
                if (s.init?.k === 'var') {
                    if (s.init.decls.length !== 1) this.err('one variable in a for loop\'s start', s.line);
                    const d = s.init.decls[0];
                    const type: string = s.init.spec.type;
                    const e = this.convert(this.expr(d.init, inner), type, s.line);
                    inner.set(d.name, { type, code: safe(d.name) });
                    init = `var ${safe(d.name)} : ${wType(type)} = ${e.code}`;
                } else if (s.init) init = this.simpleStmt(s.init.e, inner, s.line);
                const c = s.c ? strip(this.convert(this.expr(s.c, inner), 'bool', s.line).code) : '';
                const step = s.step ? this.simpleStmt(s.step, inner, s.line) : '';
                return [`${ind}for (${init}; ${c}; ${step}) {`, ...this.body(s.body, inner, depth), `${ind}}`];
            }
            case 'while':
                return [`${ind}while (${strip(this.convert(this.expr(s.c, scope), 'bool', s.line).code)}) {`, ...this.body(s.body, scope, depth), `${ind}}`];
            case 'return':
                return s.e ? [`${ind}return ${strip(this.convert(this.expr(s.e, scope), this.ret, s.line).code)};`] : [`${ind}return;`];
            case 'break': case 'continue': case 'discard': return [`${ind}${s.k};`];
            default: return this.err(`unexpected ${s.k}`, s.line);
        }
    }

    private localVar(s: Node, scope: Scope, ind: string): string[] {
        const out: string[] = [];
        const type: string = s.spec.type;
        for (const d of s.decls as Node[]) {
            const array = d.array ? this.constInt(d.array) : null;
            // A name declared again in one scope can only be the other branch of an #if (GLSL allows nothing else), so it keeps its name.
            const name = safe(d.name);
            if (!d.init) out.push(`${ind}var ${name} : ${wType(type, array)};`);
            else {
                const e = this.convert(this.expr(d.init, scope), type, d.line, array);
                // A literal of the declared kind infers it (0.0 is f32, 0 is i32); anything else says its type.
                const typed = e.type !== type || array ? ` : ${wType(type, array)}` : '';
                out.push(`${ind}${this.assigned.has(d.name) ? 'var' : 'let'} ${name}${typed} = ${strip(e.code)};`);
            }
            scope.set(d.name, { type, array, code: name });
        }
        return out;
    }

    /** A statement with no `;` or indent (a for loop's start or step). */
    private simpleStmt(e: Node, scope: Scope, line?: number): string {
        const lines = this.exprStmt(e, scope, '', line);
        if (lines.length !== 1) this.err('this cannot be a for loop\'s step', line);
        return lines[0]!.replace(/;$/, '');
    }

    private exprStmt(e: Node, scope: Scope, ind: string, line?: number): string[] {
        if (e.k === 'preinc' || e.k === 'postinc') return [`${ind}${this.lvalue(e.e, scope).code}${e.op};`];
        if (e.k === 'assign') return this.assign(e, scope, ind);
        if (e.k === 'call') {
            const bridged = this.bridgedCall(e, scope, ind);
            if (bridged) return bridged;
            const c = this.expr(e, scope);
            return [`${ind}${this.fns.has(e.name) && this.fns.get(e.name)![0]!.ret === 'void' ? c.code : `_ = ${c.code}`};`];
        }
        return this.err('this expression does nothing as a statement', line);
    }

    private assign(e: Node, scope: Scope, ind: string): string[] {
        const lhs = this.lvalue(e.lhs, scope);
        let rhs = this.expr(e.rhs, scope);
        const op: string = e.op;
        if (op === '%=' && scalarOf(lhs.type) === 'float') this.err('%= on floats is not supported', e.line);
        // WGSL takes `v op= s` for a vector and a scalar as GLSL does, so only `=` needs the scalar spread.
        if (op !== '=' && comps(rhs.type) === 1 && comps(lhs.type) > 1) rhs = this.convert(rhs, scalarOf(lhs.type)!, e.line);
        else if (op === '=' || op === '+=' || op === '-=' || op === '/=') rhs = this.convert(rhs, lhs.type, e.line);
        else if (op === '*=' && !isMat(lhs.type) && !(isVec(lhs.type) && isMat(rhs.type))) rhs = this.convert(rhs, lhs.type, e.line);
        if (lhs.swizzle && lhs.swizzle.length > 1) {
            // WGSL writes one component at a time; a scalar on the right (`v.rgb *= s`) reaches each as itself.
            const t = `es_t${this.tmp++}`;
            const scalar = comps(rhs.type) === 1;
            const parts = [...lhs.swizzle].map((c, i) => `${lhs.base}.${c} ${op} ${scalar ? t : `${t}.${'xyzw'[i]}`};`);
            return [`${ind}{ let ${t} = ${strip(rhs.code)}; ${parts.join(' ')} }`];
        }
        if ((op === '<<=' || op === '>>=') && scalarOf(rhs.type) === 'int') rhs = { code: `u32(${strip(rhs.code)})`, type: 'uint' };
        return [`${ind}${lhs.code} ${op} ${strip(rhs.code)};`];
    }

    private lvalue(e: Node, scope: Scope): LVal {
        if (e.k === 'paren') return this.lvalue(e.e, scope);
        if (e.k === 'id') {
            const v = scope.get(e.name);
            if (v) return { code: v.code, type: v.type, ptr: v.ptr, array: v.array };
            if (this.outputs.some((x) => x.name === e.name)) return { code: safe(e.name), type: this.outputs.find((x) => x.name === e.name)!.type };
            const c = this.consts.get(e.name);
            if (c) return { code: c.wgsl!, type: c.type, array: c.array };
            const g = this.env.globals.get(e.name);
            if (g?.wgsl && !g.wgsl.includes('.')) return { code: g.wgsl, type: g.type };
            return this.err(`'${e.name}' cannot be written`, e.line);
        }
        if (e.k === 'field') {
            const base = this.lvalue(e.e, scope);
            if (isVec(base.type) || SCALARS.has(base.type)) {
                const sw = swizzle(e.f, e.line);
                return { code: `${base.code}.${sw}`, type: vecOf(scalarOf(base.type)!, sw.length), base: base.code, swizzle: sw };
            }
            const ft = this.fieldType(base.type, e.f, e.line);
            return { code: `${base.code}.${safe(e.f)}`, type: ft.type, array: ft.array };
        }
        if (e.k === 'index') {
            const base = this.lvalue(e.e, scope);
            return { code: `${base.code}[${strip(this.expr(e.idx, scope).code)}]`, type: indexType(base, e.line) };
        }
        return this.err('this cannot be written to', e.line);
    }

    // ---- expressions ----
    private expr(e: Node, scope: Scope): Val {
        switch (e.k) {
            case 'num': {
                const v: string = e.v;
                if (/[uU]$/.test(v)) return { code: v, type: 'uint' };
                if (/^0[xX]/.test(v) || /^\d+$/.test(v)) return { code: v, type: 'int', abstract: true };
                let f = v.replace(/[fF]$/, '');
                if (f.startsWith('.')) f = `0${f}`;
                if (f.endsWith('.')) f = `${f}0`;
                return { code: f, type: 'float', abstract: true };
            }
            case 'bool': return { code: e.v, type: 'bool' };
            case 'paren': { const x = this.expr(e.e, scope); return { ...x, code: `(${strip(x.code)})` }; }
            case 'id': return this.ident(e, scope);
            case 'field': return this.field(e, scope);
            case 'index': {
                if (e.e.k === 'id' && e.e.name === 'u_textures') this.err('u_textures is read only by a texture function', e.line);
                const base = this.expr(e.e, scope);
                return { code: `${base.code}[${strip(this.expr(e.idx, scope).code)}]`, type: indexType(base, e.line) };
            }
            case 'unary': {
                const x = this.expr(e.e, scope);
                if (e.op === '!') return { code: `!${wrap(x.code)}`, type: 'bool' };
                if (e.op === '-') return { code: `-${wrap(x.code)}`, type: x.type, abstract: x.abstract };
                if (e.op === '~') return { code: `~${wrap(x.code)}`, type: x.type };
                return x;
            }
            case 'bin': return this.binary(e, scope);
            case 'cond': {
                const c = this.convert(this.expr(e.c, scope), 'bool', e.line);
                let a = this.expr(e.a, scope), b = this.expr(e.b, scope);
                const t = a.abstract && !b.abstract ? b.type : a.type;
                a = this.convert(a, t, e.line); b = this.convert(b, t, e.line);
                return { code: `select(${strip(b.code)}, ${strip(a.code)}, ${strip(c.code)})`, type: t };
            }
            case 'call': return this.call(e, scope);
            case 'assign': case 'preinc': case 'postinc': return this.err('an assignment or ++/-- inside an expression is not supported', e.line);
            case 'type': return this.err(`'${e.name}' used as a value`, e.line);
            default: return this.err(`unexpected ${e.k}`, e.line);
        }
    }

    private ident(e: Node, scope: Scope): Val {
        const n: string = e.name;
        const v = scope.get(n);
        if (v) {
            if (v.sampler) this.err(`sampler '${n}' is read only by a texture function`, e.line);
            return { code: v.code, type: v.type, array: v.array };
        }
        if (n === 'gl_FragCoord') return { code: 'es_v.pos', type: 'vec4' };
        if (n === 'gl_FrontFacing') { this.usesFront = true; return { code: 'es_front', type: 'bool' }; }
        const c = this.consts.get(n);
        if (c) return { code: c.wgsl!, type: c.type, array: c.array };
        const varying = this.env.varyings.get(n);
        if (varying) return { code: `es_v.${n}`, type: glslOfWgsl(varying) };
        const o = this.outputs.find((x) => x.name === n);
        if (o) return { code: safe(n), type: o.type };
        const param = this.env.params.get(n);
        if (param && !isSampler(param)) return { code: `mc.${n}`, type: param };
        if (param || this.samplers.has(n)) this.err(`sampler '${n}' is read only by a texture function`, e.line);
        const g = this.env.globals.get(n);
        if (g) {
            if (!g.wgsl) this.err(`'${n}' is the engine's in GLSL and has no WGSL counterpart it can be read as`, e.line);
            return { code: g.wgsl, type: g.type, array: g.array };
        }
        return this.err(`'${n}' is not declared`, e.line);
    }

    private field(e: Node, scope: Scope): Val {
        const base = this.expr(e.e, scope);
        if (isVec(base.type) || SCALARS.has(base.type)) {
            const sw = swizzle(e.f, e.line);
            return { code: `${wrap(base.code)}.${sw}`, type: vecOf(scalarOf(base.type)!, sw.length) };
        }
        if (e.f === 'length' && base.array) this.err('.length() is not supported', e.line);
        const ft = this.fieldType(base.type, e.f, e.line);
        return { code: `${wrap(base.code)}.${safe(e.f)}`, type: ft.type, array: ft.array };
    }

    private fieldType(structName: string, f: string, line?: number): Field {
        const field = this.structs.get(structName)?.find((x) => x.name === f);
        return field ?? this.err(`'${structName}' has no field '${f}'`, line);
    }

    private binary(e: Node, scope: Scope): Val {
        const l = this.expr(e.l, scope), r = this.expr(e.r, scope);
        const op: string = e.op;
        if (op === '&&' || op === '||') return { code: `${wrapBin(l.code)} ${op} ${wrapBin(r.code)}`, type: 'bool' };
        if (op === '^^') return { code: `${wrapBin(l.code)} != ${wrapBin(r.code)}`, type: 'bool' };
        if (['<', '>', '<=', '>=', '==', '!='].includes(op)) {
            const [a, b] = this.unify(l, r, e.line);
            const code = `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`;
            // GLSL compares vectors whole; WGSL compares them per component.
            if ((op === '==' || op === '!=') && isVec(a.type)) return { code: `${op === '==' ? 'all' : 'any'}(${code})`, type: 'bool' };
            return { code, type: 'bool' };
        }
        if (op === '<<' || op === '>>') {
            const amount = scalarOf(r.type) === 'int' && !r.abstract ? `u32(${strip(r.code)})` : wrapBin(r.code);
            return { code: `${wrapBin(l.code)} ${op} ${amount}`, type: l.type };
        }
        if (op === '&' || op === '|' || op === '^') {
            const [a, b] = this.unify(l, r, e.line);
            return { code: `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`, type: a.type, abstract: a.abstract && b.abstract };
        }
        if (op === '%' && scalarOf(l.type) === 'float') {
            const t = comps(l.type) >= comps(r.type) ? l.type : r.type;
            return { code: `${this.modHelper(t)}(${strip(this.convert(l, t, e.line).code)}, ${strip(this.convert(r, t, e.line).code)})`, type: t };
        }
        if (isMat(l.type) || isMat(r.type)) {
            let type: string;
            if (isMat(l.type) && isMat(r.type)) type = l.type;
            else if (isMat(l.type) && isVec(r.type)) type = r.type;
            else if (isVec(l.type) && isMat(r.type)) type = l.type;
            else type = isMat(l.type) ? l.type : r.type;
            return { code: `${wrapBin(l.code)} ${op} ${wrapBin(r.code)}`, type };
        }
        const [a, b] = this.unify(l, r, e.line, true);
        const type = comps(a.type) >= comps(b.type) ? a.type : b.type;
        return { code: `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`, type, abstract: a.abstract && b.abstract };
    }

    /** Two operands made the same scalar type (a literal takes the other's); vector and scalar may mix where `mixedOk`. */
    private unify(a: Val, b: Val, line?: number, mixedOk = false): [Val, Val] {
        const sa = scalarOf(a.type), sb = scalarOf(b.type);
        if (sa !== sb) {
            if (a.abstract && sb) a = { ...a, type: vecOf(sb, comps(a.type)), abstract: false };
            else if (b.abstract && sa) b = { ...b, type: vecOf(sa, comps(b.type)), abstract: false };
            else this.err(`${a.type} and ${b.type} mixed in one operation`, line);
        }
        if (!mixedOk && comps(a.type) !== comps(b.type)) {
            if (comps(a.type) === 1) a = this.convert(a, b.type, line);
            else if (comps(b.type) === 1) b = this.convert(b, a.type, line);
        }
        return [a, b];
    }

    /** `x` as a value of `type`: a literal or a scalar spreads or converts; anything else must already be it. */
    private convert(x: Val, type: string, line?: number, array?: number | null): Val {
        if (array || x.type === type || !type || type === 'void') return x;
        const n = comps(type), s = scalarOf(type);
        if (!s) {
            if (x.type !== type) this.err(`${x.type} where ${type} is wanted`, line);
            return x;
        }
        if (x.abstract && comps(x.type) === 1) {
            if (n === 1) return s === 'float' && scalarOf(x.type) === 'int' ? { code: `${x.code}.0`, type } : { ...x, type, abstract: true };
            return { code: `${wType(type)}(${strip(x.code)})`, type };
        }
        if (comps(x.type) === 1 && n > 1) {
            const inner = scalarOf(x.type) === s ? strip(x.code) : `${W_SCALAR[s]}(${strip(x.code)})`;
            return { code: `${wType(type)}(${inner})`, type };
        }
        if (comps(x.type) === n) return { code: `${wType(type)}(${strip(x.code)})`, type };
        return this.err(`${x.type} where ${type} is wanted`, line);
    }

    /** GLSL's mod (floored), which WGSL's `%` is not (truncated): one helper per width, written once. */
    private modHelper(t: string): string {
        const name = `es_mod${comps(t)}`;
        if (!this.helpers.has(name)) {
            const w = wType(t);
            this.helpers.set(name, `fn ${name}(x : ${w}, y : ${w}) -> ${w} { return x - y * floor(x / y); }`);
        }
        return name;
    }

    // ---- calls ----
    private call(e: Node, scope: Scope): Val {
        const n: string = e.name;
        if (VEC.test(n) || MAT.test(n) || SCALARS.has(n)) return this.construct(e, scope);
        if (this.structs.has(n) && !this.fns.has(n)) {
            const fields = this.structs.get(n)!;
            const args = (e.args as Node[]).map((a, i) => strip(this.convert(this.expr(a, scope), fields[i]?.type ?? '', e.line).code));
            return { code: `${n}(${args.join(', ')})`, type: n };
        }
        if (/^(texture|textureLod|texelFetch|textureSize|textureGrad)$/.test(n)) return this.texture(e, scope);
        if (this.fns.has(n)) return this.userCall(e, scope);
        if (n in BUILTINS || SPECIAL_BUILTINS.has(n)) return this.builtin(e, scope);
        if (this.env.fns.has(n)) return this.engineCall(e, scope);
        return this.err(`function '${n}' is not declared`, e.line);
    }

    private construct(e: Node, scope: Scope): Val {
        const t = ({ mat2x2: 'mat2', mat3x3: 'mat3', mat4x4: 'mat4' } as Record<string, string>)[e.name] ?? e.name as string;
        const args = (e.args as Node[]).map((a) => this.expr(a, scope));
        if (SCALARS.has(t)) {
            const s = t as Scalar;
            if (args.length !== 1) this.err(`${t}() takes one argument`, e.line);
            const a = args[0]!;
            if (a.type === t) return { code: strip(a.code), type: t };
            if (comps(a.type) > 1) return { code: `${W_SCALAR[s]}(${wrap(a.code)}.x)`, type: t };
            return { code: `${W_SCALAR[s]}(${strip(a.code)})`, type: t };
        }
        if (isVec(t)) {
            const n = comps(t), s = scalarOf(t)!;
            const first = args[0]!;
            if (args.length === 1 && comps(first.type) > n && isVec(first.type)) {
                // GLSL takes the first components of a longer vector; WGSL wants them named.
                const sub = `${wrap(first.code)}.${'xyzw'.slice(0, n)}`;
                return scalarOf(first.type) === s ? { code: sub, type: t } : { code: `${wType(t)}(${sub})`, type: t };
            }
            if (args.length === 1 && isMat(first.type)) this.err('a vector made from a matrix is not supported', e.line);
            const parts = args.map((a) => {
                if (scalarOf(a.type) === s || a.abstract) return strip(a.code);
                return comps(a.type) === 1 ? `${W_SCALAR[s]}(${strip(a.code)})` : `${wType(vecOf(s, comps(a.type)))}(${strip(a.code)})`;
            });
            return { code: `${wType(t)}(${parts.join(', ')})`, type: t };
        }
        const n = Number(MAT.exec(t)![1]);
        const first = args[0]!;
        if (args.length === 1 && comps(first.type) === 1) {
            const d = strip(first.code);
            const cols = Array.from({ length: n }, (_, c) => Array.from({ length: n }, (__, r) => (r === c ? d : '0.0')).join(', '));
            return { code: `${wType(t)}(${cols.join(', ')})`, type: t };
        }
        if (args.length === 1 && isMat(first.type)) {
            const k = Number(MAT.exec(first.type)![1]);
            if (k === n) return { code: strip(first.code), type: t };
            if (k > n) {
                const src = wrap(first.code);
                return { code: `${wType(t)}(${Array.from({ length: n }, (_, c) => `${src}[${c}].${'xyzw'.slice(0, n)}`).join(', ')})`, type: t };
            }
            this.err('a larger matrix made from a smaller one is not supported', e.line);
        }
        return { code: `${wType(t)}(${args.map((a) => strip(a.code)).join(', ')})`, type: t };
    }

    private builtin(e: Node, scope: Scope): Val {
        const n: string = e.name;
        let args = (e.args as Node[]).map((a) => this.expr(a, scope));
        const first = (): Val => args[0]!;
        const widest = (): string => args.reduce((t, a) => (comps(a.type) > comps(t) ? a.type : t), first().type);
        const spreadTo = (t: string): void => {
            args = args.map((a) => (comps(a.type) === 1 && comps(t) > 1 ? this.convert(a, t, e.line) : this.convert(a, vecOf(scalarOf(t)!, comps(a.type)), e.line)));
        };
        const codes = (): string => args.map((a) => strip(a.code)).join(', ');
        const bvec = (k: number): string => (k > 1 ? `bvec${k}` : 'bool');
        switch (n) {
            case 'mod': { const t = widest(); spreadTo(t); return { code: `${this.modHelper(t)}(${codes()})`, type: t }; }
            case 'atan':
                if (args.length === 2) { const t = widest(); spreadTo(t); return { code: `atan2(${codes()})`, type: t }; }
                return { code: `atan(${codes()})`, type: first().type };
            case 'lessThan': case 'lessThanEqual': case 'greaterThan': case 'greaterThanEqual': case 'equal': case 'notEqual': {
                const op = ({ lessThan: '<', lessThanEqual: '<=', greaterThan: '>', greaterThanEqual: '>=', equal: '==', notEqual: '!=' } as Record<string, string>)[n];
                return { code: `(${wrapBin(first().code)} ${op} ${wrapBin(args[1]!.code)})`, type: bvec(comps(first().type)) };
            }
            case 'not': return { code: `!${wrap(first().code)}`, type: first().type };
            case 'floatBitsToUint': case 'floatBitsToInt': case 'uintBitsToFloat': case 'intBitsToFloat': {
                const to: Scalar = n === 'floatBitsToUint' ? 'uint' : n === 'floatBitsToInt' ? 'int' : 'float';
                const t = vecOf(to, comps(first().type));
                return { code: `bitcast<${wType(t)}>(${codes()})`, type: t };
            }
            case 'isnan': return { code: `(${wrapBin(first().code)} != ${wrapBin(first().code)})`, type: bvec(comps(first().type)) };
            case 'inverse': case 'isinf': return this.err(`${n}() has no WGSL builtin and is not supported yet`, e.line);
            default: break;
        }
        const w = BUILTINS[n]!;
        if (FLOAT_RESULT.has(n)) return { code: `${w}(${codes()})`, type: 'float' };
        if (n === 'cross') return { code: `cross(${codes()})`, type: 'vec3' };
        if (n === 'any' || n === 'all') return { code: `${w}(${codes()})`, type: 'bool' };
        if (n === 'mix') {
            if (scalarOf(args[2]!.type) === 'bool') {
                const t = widest();
                return { code: `select(${strip(this.convert(args[0]!, t, e.line).code)}, ${strip(this.convert(args[1]!, t, e.line).code)}, ${strip(args[2]!.code)})`, type: t };
            }
            const t = comps(args[0]!.type) >= comps(args[1]!.type) ? args[0]!.type : args[1]!.type;
            args[0] = this.convert(args[0]!, t, e.line);
            args[1] = this.convert(args[1]!, t, e.line);
            args[2] = this.convert(args[2]!, comps(args[2]!.type) === 1 ? scalarOf(t)! : t, e.line);
            return { code: `mix(${codes()})`, type: t };
        }
        if (['step', 'smoothstep', 'min', 'max', 'clamp', 'pow'].includes(n)) {
            const t = widest();
            spreadTo(t);
            return { code: `${w}(${codes()})`, type: t };
        }
        return { code: `${w}(${codes()})`, type: first().type };
    }

    /** A sampler argument: its texture and its sampler. */
    private sampler(a: Node, scope: Scope, line?: number): SamplerPair {
        if (a.k === 'index' && a.e.k === 'id' && a.e.name === 'u_textures' && a.idx.k === 'num') {
            return this.samplers.get(`u_textures[${a.idx.v}]`) ?? this.err(`u_textures[${a.idx.v}] is past the units the shader declares`, line);
        }
        if (a.k === 'id') {
            const v = scope.get(a.name);
            if (v?.sampler) return v.sampler;
            const own = this.samplers.get(a.name);
            if (own) return own;
            if (this.env.params.get(a.name) === 'sampler2D') return { tex: a.name, smp: `${a.name}_s` };
            if (this.env.globals.get(a.name)) this.err(`engine sampler '${a.name}' has no WGSL name the transpiler knows`, line);
        }
        return this.err('a texture function reads a sampler named directly', line);
    }

    private isSamplerArg(a: Node, scope: Scope): boolean {
        if (a.k === 'index' && a.e.k === 'id' && a.e.name === 'u_textures') return true;
        if (a.k !== 'id') return false;
        return Boolean(scope.get(a.name)?.sampler || this.samplers.has(a.name) || this.env.params.get(a.name) === 'sampler2D');
    }

    private texture(e: Node, scope: Scope): Val {
        const s = this.sampler(e.args[0], scope, e.line);
        const rest = (e.args as Node[]).slice(1).map((a) => this.expr(a, scope));
        const c = (i: number, t: string): string => strip(this.convert(rest[i] ?? this.err(`${e.name} is missing an argument`, e.line), t, e.line).code);
        switch (e.name) {
            case 'texture':
                return rest.length === 2
                    ? { code: `textureSampleBias(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'float')})`, type: 'vec4' }
                    : { code: `textureSample(${s.tex}, ${s.smp}, ${c(0, 'vec2')})`, type: 'vec4' };
            case 'textureLod': return { code: `textureSampleLevel(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'float')})`, type: 'vec4' };
            case 'textureGrad': return { code: `textureSampleGrad(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'vec2')}, ${c(2, 'vec2')})`, type: 'vec4' };
            case 'texelFetch': return { code: `textureLoad(${s.tex}, ${c(0, 'ivec2')}, ${c(1, 'int')})`, type: 'vec4' };
            default: return { code: `vec2i(textureDimensions(${s.tex}, ${c(0, 'int')}))`, type: 'ivec2' };
        }
    }

    private userCall(e: Node, scope: Scope): Val {
        const list = this.fns.get(e.name)!;
        const args = (e.args as Node[]).map((a) => (this.isSamplerArg(a, scope) ? null : this.expr(a, scope)));
        const f = list.length === 1 ? list[0] : list.find((x) => x.params.length === e.args.length
            && x.params.every((p, i) => (args[i] === null ? isSampler(p.type) : p.type === args[i]!.type || args[i]!.abstract)));
        if (!f) return this.err(`no '${e.name}' takes these arguments`, e.line);
        const out: string[] = [];
        f.params.forEach((p, i) => {
            if (isSampler(p.type)) { const s = this.sampler(e.args[i], scope, e.line); out.push(s.tex, s.smp); return; }
            if (p.quals.includes('out') || p.quals.includes('inout')) { out.push(this.address(e.args[i], scope, e.line)); return; }
            out.push(strip(this.convert(args[i]!, p.type, e.line, p.array ? this.constInt(p.array) : null).code));
        });
        return { code: `${f.wname}(${out.join(', ')})`, type: f.ret };
    }

    /** `&x` for an out argument: a variable, a field or an element of one; a pointer parameter passes on as itself. */
    private address(a: Node, scope: Scope, line?: number): string {
        const lv = this.lvalue(a, scope);
        if (lv.swizzle) this.err('a swizzle as an out argument is not supported', line);
        if (lv.ptr && a.k === 'id') return lv.ptr;
        return `&${lv.code}`;
    }

    private engineCall(e: Node, scope: Scope): Val {
        const n: string = e.name;
        const sig = this.env.fns.get(n)!;
        if (BRIDGES[n]) this.err(`'${n}' writes its arguments; it can only be called as a statement of its own`, e.line);
        if (sig.params.some((p) => p.qual !== 'in')) this.err(`engine function '${n}' writes an argument and has no bridge`, e.line);
        const out: string[] = [];
        sig.params.forEach((p, i) => {
            if (isSampler(p.type)) { const s = this.sampler(e.args[i], scope, e.line); out.push(s.tex, s.smp); return; }
            out.push(strip(this.convert(this.expr(e.args[i], scope), p.type, e.line).code));
        });
        const arity = this.env.arity[n];
        if (arity !== out.length) this.err(`engine function '${n}' takes ${arity} arguments in WGSL and ${out.length} in GLSL`, e.line);
        return { code: `${n}(${out.join(', ')})`, type: sig.ret };
    }

    private bridgedCall(e: Node, scope: Scope, ind: string): string[] | null {
        const b = BRIDGES[e.name];
        if (!b || this.fns.has(e.name)) return null;
        const sig = this.env.fns.get(e.name);
        if (!sig) return null;
        const ins: string[] = [], outs: LVal[] = [];
        sig.params.forEach((p, i) => {
            if (b.outs.includes(i)) { outs.push(this.lvalue(e.args[i], scope)); return; }
            ins.push(strip(this.convert(this.expr(e.args[i], scope), p.type, e.line).code));
        });
        const t = `es_t${this.tmp++}`;
        const writes = outs.map((o, k) => `${o.code} ${b.accumulate ? '+=' : '='} ${t}.${b.fields[k]};`);
        return [`${ind}{ let ${t} = ${e.name}(${ins.join(', ')}); ${writes.join(' ')} }`];
    }

    // ---- the entry ----
    private entry(): string[] {
        const lines = ['var<private> es_v : VSOut;'];
        if (this.usesFront) lines.push('var<private> es_front : bool;');
        // One entry per combination of the conditions the outputs are declared under.
        const conds = [...new Set(this.outputs.flatMap((o) => o.guard.map((g) => g.cond)))];
        if (conds.length > 3) this.err('outputs declared under more than three conditions');
        const combos = conds.length
            ? Array.from({ length: 1 << conds.length }, (_, m) => conds.map((cond, i) => ({ cond, on: Boolean(m & (1 << i)) })))
            : [[]];
        for (const combo of combos) {
            const active: Output[] = [];
            for (const o of this.outputs) {
                const live = o.guard.every((g) => combo.find((c) => c.cond === g.cond)!.on !== g.neg);
                if (live && !active.some((a) => a.name === o.name)) active.push(o);
            }
            if (active.length === 0) continue;
            const guard = combo.map((c) => (c.on ? c.cond : `!${c.cond}`)).join(' && ');
            const params = ['es_in : VSOut', ...(this.usesFront ? ['@builtin(front_facing) es_ff : bool'] : [])].join(', ');
            const setup = `    es_v = es_in;${this.usesFront ? ' es_front = es_ff;' : ''}\n    es_main();`;
            let fn: string;
            if (active.length === 1 && active[0]!.location === 0) {
                fn = `@fragment fn fs_main(${params}) -> @location(0) ${wType(active[0]!.type)} {\n${setup}\n    return ${safe(active[0]!.name)};\n}`;
            } else {
                const sorted = [...active].sort((a, b) => a.location - b.location);
                const struct = `struct es_FragOut {\n${sorted.map((o) => `    @location(${o.location}) ${safe(o.name)} : ${wType(o.type)},`).join('\n')}\n};`;
                fn = `${struct}\n@fragment fn fs_main(${params}) -> es_FragOut {\n${setup}\n    return es_FragOut(${sorted.map((o) => safe(o.name)).join(', ')});\n}`;
            }
            lines.push(...(guard ? [`#if ${guard}`, fn, '#endif'] : [fn]));
        }
        return lines;
    }
}

/** Names a function body writes: assigned, incremented, or handed to a parameter that writes it. */
function assignedNames(body: Node, writtenArgs: (name: string) => Set<number>): Set<string> {
    const out = new Set<string>();
    const root = (e: Node | null): string | null => {
        while (e && (e.k === 'field' || e.k === 'index' || e.k === 'paren')) e = e.e;
        return e?.k === 'id' ? e.name : null;
    };
    const visit = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(visit); return; }
        const node = n as Node;
        if (node.k === 'assign' || node.k === 'preinc' || node.k === 'postinc') { const r = root(node.lhs ?? node.e); if (r) out.add(r); }
        if (node.k === 'call') {
            const writes = writtenArgs(node.name);
            (node.args as Node[]).forEach((a, i) => { if (writes.has(i)) { const r = root(a); if (r) out.add(r); } });
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    visit(body);
    return out;
}

function swizzle(f: string, line?: number): string {
    if (!/^([xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/.test(f)) throw new GlslError(`'.${f}' is not a swizzle`, line);
    return f.replace(/[stpq]/g, (c) => 'xyzw'['stpq'.indexOf(c)]!);
}

function indexType(base: { type: string; array?: number | null }, line?: number): string {
    if (base.array) return base.type;
    if (isVec(base.type)) return scalarOf(base.type)!;
    const m = MAT.exec(base.type);
    if (m) return `vec${m[2] ?? m[1]}`;
    throw new GlslError(`${base.type} cannot be indexed`, line);
}

function glslOfWgsl(w: string): string {
    const m = /^vec([234])([fiu])$/.exec(w);
    if (m) return `${({ f: '', i: 'i', u: 'u' } as Record<string, string>)[m[2]!]}vec${m[1]}`;
    return ({ f32: 'float', i32: 'int', u32: 'uint', bool: 'bool' } as Record<string, string>)[w] ?? w;
}

/** An expression with its outermost redundant parentheses taken off. */
function strip(code: string): string {
    if (!code.startsWith('(') || !code.endsWith(')')) return code;
    let d = 0;
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '(') d++;
        else if (code[i] === ')') { d--; if (d === 0 && i < code.length - 1) return code; }
    }
    return code.slice(1, -1);
}

/**
 * Whether `code` is one primary term — a literal, a name, a call, a parenthesised group — with any member or index after it, so
 * it needs no parentheses as an operand. `f(a) + g(b)` is not: its first group closes before the end.
 */
function isAtom(code: string): boolean {
    if (/^\d[\w.]*(?:[eE][+-]?\d+)?[uf]?$/.test(code)) return true;
    let i = 0;
    const m = /^[A-Za-z_]\w*(?:<[\w<>, ]+>)?/.exec(code);
    if (m) i = m[0].length;
    else if (code[0] !== '(') return false;
    for (;;) {
        if (i === code.length) return true;
        const c = code[i];
        if (c === '.') { const f = /^\.\w+/.exec(code.slice(i)); if (!f) return false; i += f[0].length; continue; }
        if (c === '(' || c === '[') {
            const close = c === '(' ? ')' : ']';
            let d = 0, j = i;
            for (; j < code.length; j++) { if (code[j] === c) d++; else if (code[j] === close) { d--; if (d === 0) break; } }
            if (j === code.length) return false;
            i = j + 1;
            continue;
        }
        return false;
    }
}
const wrap = (code: string): string => (isAtom(code) ? code : `(${code})`);
const wrapBin = (code: string): string => (isAtom(code) || /^-[\w.]+$/.test(code) ? code : `(${code})`);

/** `#ifdef X` / `#else` / `#endif` groups left with nothing in them, gone, and an empty `#else` with them. */
export function dropEmptyConditionals(text: string): string {
    let prev: string;
    do {
        prev = text;
        text = text.replace(/^#\s*(?:ifdef|ifndef|if)\b[^\n]*\n(?:#\s*else[^\n]*\n)?#\s*endif[^\n]*(?:\n|$)/gm, '');
        text = text.replace(/^#\s*else[^\n]*\n(#\s*endif)/gm, '$1');
    } while (text !== prev);
    return text;
}
