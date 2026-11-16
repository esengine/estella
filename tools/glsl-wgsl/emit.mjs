// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A shader's own GLSL fragment, written as the WGSL twin the engine assembles behind its injected WGSL header: the same body
 *        under the same `#ifdef`s, reading `mc.` for its params, `VSOut` for its varyings, and the engine's WGSL functions by name.
 *        Every construct it does not know how to write is an error naming the line, never a guess.
 */
import { GlslError, lex, parse } from './parse.mjs';

// ---- types ----
const VEC = /^([biu]?)vec([234])$/;
const MAT = /^mat([234])(?:x([234]))?$/;
const SCALARS = new Set(['float', 'int', 'uint', 'bool']);
const scalarOfPrefix = { '': 'float', i: 'int', u: 'uint', b: 'bool' };
const prefixOfScalar = { float: '', int: 'i', uint: 'u', bool: 'b' };
const wScalar = { float: 'f32', int: 'i32', uint: 'u32', bool: 'bool' };

function comps(t) { const v = VEC.exec(t); if (v) return Number(v[2]); return SCALARS.has(t) ? 1 : 0; }
function scalarOf(t) { const v = VEC.exec(t); if (v) return scalarOfPrefix[v[1]]; if (MAT.test(t)) return 'float'; return SCALARS.has(t) ? t : null; }
function vecOf(scalar, n) { return n === 1 ? scalar : `${prefixOfScalar[scalar]}vec${n}`; }
const isVec = (t) => VEC.test(t);
const isMat = (t) => MAT.test(t);
const isSampler = (t) => /^[iu]?sampler/.test(t);

function wType(t, array) {
  let w;
  const v = VEC.exec(t), m = MAT.exec(t);
  if (SCALARS.has(t)) w = wScalar[t];
  else if (v) w = v[1] === 'b' ? `vec${v[2]}<bool>` : `vec${v[2]}${{ '': 'f', i: 'i', u: 'u' }[v[1]]}`;
  else if (m) w = `mat${m[1]}x${m[2] ?? m[1]}f`;
  else if (t === 'void') w = '';
  else w = t;
  return array ? `array<${w}, ${array}>` : w;
}

const RESERVED = new Set(('alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override ' +
  'requires return struct switch true var while NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become ' +
  'binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval ' +
  'constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external ' +
  'fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp ' +
  'macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr ' +
  'of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless ' +
  'register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super ' +
  'target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying ' +
  'virtual volatile wgsl where with writeonly yield sampler texture_2d f32 i32 u32 bool array ptr atomic ' +
  // WGSL's builtins that GLSL does not reserve: a GLSL name like these would hide the builtin the twin calls.
  'dpdx dpdy dpdxCoarse dpdxFine dpdyCoarse dpdyFine fwidthCoarse fwidthFine select atan2 inverseSqrt bitcast faceForward ' +
  'textureSample textureSampleLevel textureSampleGrad textureSampleBias textureSampleCompare textureLoad textureStore textureDimensions ' +
  'textureNumLevels textureNumLayers arrayLength countOneBits countLeadingZeros countTrailingZeros reverseBits extractBits insertBits ' +
  'firstLeadingBit firstTrailingBit quantizeToF16 saturate vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u mat2x2f mat3x3f mat4x4f').split(' '));
const safe = (n) => (RESERVED.has(n) ? `${n}_` : n);

/** Engine functions whose GLSL writes `out`/`inout` parameters and whose WGSL returns them: positions, fields, and whether the
 *  GLSL adds to what it was given (inout that accumulates) or replaces it. */
const BRIDGES = {
  shadeLight: { outs: [15, 16, 17], fields: ['lit', 'gloss', 'extra'], accumulate: true },
};

// Builtins: GLSL name -> WGSL name, and how the result type follows the arguments.
const SAME = (a) => a[0];
const BUILTINS = {
  abs: 'abs', sign: 'sign', floor: 'floor', ceil: 'ceil', fract: 'fract', trunc: 'trunc', round: 'round', roundEven: 'round',
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', exp: 'exp', log: 'log', exp2: 'exp2', log2: 'log2', sqrt: 'sqrt',
  inversesqrt: 'inverseSqrt', radians: 'radians', degrees: 'degrees', normalize: 'normalize', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  min: 'min', max: 'max', clamp: 'clamp', mix: 'mix', step: 'step', smoothstep: 'smoothstep', pow: 'pow', reflect: 'reflect',
  refract: 'refract', faceforward: 'faceForward', dFdx: 'dpdx', dFdy: 'dpdy', fwidth: 'fwidth', length: 'length', distance: 'distance',
  dot: 'dot', cross: 'cross', transpose: 'transpose', determinant: 'determinant', any: 'any', all: 'all',
};
const FLOAT_RESULT = new Set(['length', 'distance', 'dot', 'determinant']);
const DERIVATIVE = /\b(textureSample|textureSampleBias|dpdx|dpdy|fwidth)\(/;

export function transpileFragment({ source, env }) {
  const sections = [...source.matchAll(/^#pragma fragment[ \t]*\r?\n([\s\S]*?)^#pragma end/gm)];
  if (sections.length !== 1) throw new GlslError(`expected one GLSL fragment section, found ${sections.length}`);
  const tree = parse(lex(sections[0][1]), new Set(env.structs.keys()));
  return new Emitter(env, tree).run();
}

class Emitter {
  constructor(env, tree) {
    this.env = env;
    this.tree = tree;
    this.structs = new Map(env.structs);
    this.consts = new Map();        // module-scope consts / privates of the source: name -> type info
    this.fns = new Map();           // the source's functions: name -> [{ ret, params, wname }]
    this.outputs = [];              // { name, type, location, guard }
    this.samplerParams = new Map(); // material texture params and batch units: glsl name -> { tex, smp }
    this.helpers = new Map();
    this.usesFront = false;
    this.usesFragCoord = false;
    this.tmp = 0;
  }

  err(msg, line) { throw new GlslError(msg, line); }

  run() {
    const out = [];
    const ppStack = [];
    // Pass 1: what the source declares at module scope.
    for (const it of this.tree.items) {
      if (it.k === 'struct') this.structs.set(it.name, it.fields);
      if (it.k === 'fn') {
        const list = this.fns.get(it.name) ?? [];
        list.push({ ret: it.ret.type, params: it.params, node: it });
        this.fns.set(it.name, list);
      }
    }
    for (const [name, list] of this.fns) list.forEach((f, i) => { f.wname = name === 'main' ? 'es_main' : safe(list.length > 1 ? `${name}_${i}` : name); });

    // Pass 2: write.
    for (const it of this.tree.items) {
      switch (it.k) {
        case 'pp': this.trackPp(ppStack, it); out.push(it.v); break;
        case 'precision': case 'empty': case 'proto': break;
        case 'struct':
          out.push(`struct ${it.name} {\n${it.fields.map((f) => `    ${safe(f.name)} : ${wType(f.type, f.array && this.constInt(f.array))},`).join('\n')}\n};`);
          break;
        case 'block': this.err('an interface block in a shader body is not supported', it.line); break;
        case 'var': out.push(...this.globalVar(it, ppStack)); break;
        case 'fn': out.push(this.fn(it)); break;
        default: this.err(`unexpected ${it.k}`, it.line);
      }
    }
    if (ppStack.length) this.err('an #if without its #endif');
    out.push(...this.entry());
    const declared = [];
    for (const o of this.outputs) {
      const prior = declared.find((d) => d.name === o.name);
      if (prior && prior.type !== o.type) this.err(`output '${o.name}' is declared as ${prior.type} and as ${o.type}`);
      if (!prior) declared.push(o);
    }
    const outputs = declared.map((o) => `var<private> ${safe(o.name)} : ${wType(o.type)};`);
    const text = [...this.helpers.values(), ...outputs, ...out].join('\n');
    return dropEmptyConditionals(text);
  }

  trackPp(stack, it) {
    const m = /^#\s*(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/.exec(it.v);
    if (!m) this.err(`preprocessor line '${it.v}' is not supported`, it.line);
    if (m[1] === 'ifdef') stack.push({ cond: `defined(${m[2]})` , neg: false });
    else if (m[1] === 'ifndef') stack.push({ cond: `defined(${m[2]})`, neg: true });
    else if (m[1] === 'if') stack.push({ cond: `(${m[2]})`, neg: false });
    else if (m[1] === 'else') stack[stack.length - 1].neg = !stack[stack.length - 1].neg;
    else if (m[1] === 'elif') stack[stack.length - 1].elif = true;
    else if (m[1] === 'endif') stack.pop();
  }

  constInt(e) {
    if (e.k === 'num') return Number.parseInt(e.v, 10);
    if (e.k === 'id' && this.consts.get(e.name)?.value !== undefined) return this.consts.get(e.name).value;
    this.err('an array size must be a literal or a const of the shader', e.line);
  }

  globalVar(it, ppStack) {
    const q = it.spec.quals;
    const lines = [];
    for (const d of it.decls) {
      const array = d.array ? this.constInt(d.array) : null;
      if (q.includes('in')) {
        if (!this.env.varyings.has(d.name)) this.err(`varying '${d.name}' is not one the engine's VSOut carries`, d.line);
        continue;
      }
      if (q.includes('out')) {
        if (ppStack.some((f) => f.elif)) this.err('an output declared under #elif is not supported', d.line);
        const loc = /location=(\d+)/.exec(it.spec.layout ?? '');
        // Declared once, at the top, whatever branch declared it: the body writes it under conditions of its own.
        this.outputs.push({ name: d.name, type: it.spec.type, location: loc ? Number(loc[1]) : 0, guard: ppStack.map((f) => ({ ...f })) });
        continue;
      }
      if (q.includes('uniform')) {
        if (isSampler(it.spec.type)) {
          if (it.spec.type !== 'sampler2D') this.err(`${it.spec.type} is not supported yet`, d.line);
          if (d.name === 'u_textures') {
            for (let u = 0; u < (array ?? 1); u++) this.samplerParams.set(`u_textures[${u}]`, { tex: `t${u}`, smp: `s${u}` });
          } else {
            this.samplerParams.set(d.name, { tex: d.name, smp: `${d.name}_s` });
          }
          continue;
        }
        if (!this.env.params.has(d.name)) this.err(`uniform '${d.name}' is not a #pragma param, so the engine gives it no place in the material block`, d.line);
        continue;
      }
      const type = it.spec.type;
      if (q.includes('const')) {
        if (!d.init) this.err('a const without a value', d.line);
        const init = this.convert(this.expr(d.init, new Scope()), type, d.line);
        const value = d.init.k === 'num' && /^\d+$/.test(d.init.v) ? Number(d.init.v) : undefined;
        this.consts.set(d.name, { type, array, value, wgsl: safe(d.name) });
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
  fn(it) {
    const f = this.fns.get(it.name).find((x) => x.node === it);
    const assigned = assignedNames(it.body, (name) => this.writtenArgs(name));
    const scope = new Scope();
    const params = [];
    const prologue = [];
    for (const p of it.params) {
      if (!p.name) continue;
      const array = p.array ? this.constInt(p.array) : null;
      if (isSampler(p.type)) {
        params.push(`${safe(p.name)} : texture_2d<f32>`, `${safe(p.name)}_s : sampler`);
        scope.set(p.name, { type: p.type, sampler: { tex: safe(p.name), smp: `${safe(p.name)}_s` } });
        continue;
      }
      if (p.quals.includes('out') || p.quals.includes('inout')) {
        params.push(`${safe(p.name)} : ptr<function, ${wType(p.type, array)}>`);
        scope.set(p.name, { type: p.type, array, code: `(*${safe(p.name)})`, ptr: safe(p.name) });
        continue;
      }
      if (assigned.has(p.name)) {
        // A WGSL parameter cannot be written; the GLSL one can, so it becomes a variable of the same name.
        params.push(`${safe(p.name)}_in : ${wType(p.type, array)}`);
        prologue.push(`    var ${safe(p.name)} = ${safe(p.name)}_in;`);
      } else params.push(`${safe(p.name)} : ${wType(p.type, array)}`);
      scope.set(p.name, { type: p.type, array, code: safe(p.name) });
    }
    this.ret = it.ret.type;
    this.assigned = assigned;
    const body = this.block(it.body.body, scope, 1);
    const ret = it.ret.type === 'void' ? '' : ` -> ${wType(it.ret.type)}`;
    const text = `fn ${f.wname}(${params.join(', ')})${ret} {\n${[...prologue, ...body].join('\n')}\n}`;
    // A texture read in a branch is as defined as GLSL leaves it; WGSL would refuse it, so the check is off where one is.
    return DERIVATIVE.test(text) ? `@diagnostic(off, derivative_uniformity)\n${text}` : text;
  }

  /** The argument positions a call of `name` writes: a function of the source's out/inout parameters, a bridged engine function's outs. */
  writtenArgs(name) {
    const own = this.fns.get(name);
    if (own) return new Set(own.flatMap((f) => f.params.map((p, i) => (p.quals.includes('out') || p.quals.includes('inout') ? i : -1))).filter((i) => i >= 0));
    if (BRIDGES[name]) return new Set(BRIDGES[name].outs);
    return new Set();
  }

  block(stmts, scope, depth) {
    const inner = scope.child();
    const out = [];
    for (const s of stmts) out.push(...this.stmt(s, inner, depth));
    return out;
  }

  stmt(s, scope, depth) {
    const ind = '    '.repeat(depth);
    switch (s.k) {
      case 'pp': {
        if (!/^#\s*(ifdef|ifndef|if|elif|else|endif)\b/.test(s.v)) this.err(`preprocessor line '${s.v}' is not supported`, s.line);
        return [s.v];
      }
      case 'empty': return [];
      case 'block': return [`${ind}{`, ...this.block(s.body, scope, depth + 1), `${ind}}`];
      case 'var': return this.localVar(s, scope, ind);
      case 'expr': return this.exprStmt(s.e, scope, ind, s.line);
      case 'if': {
        const c = this.convert(this.expr(s.c, scope), 'bool', s.line);
        const out = [`${ind}if (${strip(c.code)}) {`, ...this.body(s.a, scope, depth)];
        let b = s.b;
        while (b) {
          if (b.k === 'if') {
            const cc = this.convert(this.expr(b.c, scope), 'bool', b.line);
            out.push(`${ind}} else if (${strip(cc.code)}) {`, ...this.body(b.a, scope, depth));
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
          const e = this.convert(this.expr(d.init, inner), s.init.spec.type, s.line);
          inner.set(d.name, { type: s.init.spec.type, code: safe(d.name) });
          init = `var ${safe(d.name)} : ${wType(s.init.spec.type)} = ${e.code}`;
        } else if (s.init) init = this.simpleStmt(s.init.e, inner, s.line);
        const c = s.c ? strip(this.convert(this.expr(s.c, inner), 'bool', s.line).code) : '';
        const step = s.step ? this.simpleStmt(s.step, inner, s.line) : '';
        return [`${ind}for (${init}; ${c}; ${step}) {`, ...this.body(s.body, inner, depth), `${ind}}`];
      }
      case 'while': {
        const c = this.convert(this.expr(s.c, scope), 'bool', s.line);
        return [`${ind}while (${strip(c.code)}) {`, ...this.body(s.body, scope, depth), `${ind}}`];
      }
      case 'return': {
        if (!s.e) return [`${ind}return;`];
        return [`${ind}return ${this.convert(this.expr(s.e, scope), this.ret, s.line).code};`];
      }
      case 'break': case 'continue': case 'discard': return [`${ind}${s.k};`];
      default: this.err(`unexpected ${s.k}`, s.line);
    }
  }

  body(s, scope, depth) {
    return s.k === 'block' ? this.block(s.body, scope, depth + 1) : this.stmt(s, scope.child(), depth + 1);
  }

  localVar(s, scope, ind) {
    const out = [];
    const type = s.spec.type;
    for (const d of s.decls) {
      const array = d.array ? this.constInt(d.array) : null;
      // A name declared again in one scope can only be the other branch of an #if (GLSL allows nothing else), so it keeps its name.
      const name = safe(d.name);
      if (!d.init) {
        out.push(`${ind}var ${name} : ${wType(type, array)};`);
      } else {
        const e = this.convert(this.expr(d.init, scope), type, d.line, array);
        const reassigned = this.assigned.has(d.name);
        // A literal of the declared kind infers it (0.0 is f32, 0 is i32); anything else says its type.
        const typed = e.type !== type || array;
        if (!reassigned) out.push(`${ind}let ${name}${typed ? ` : ${wType(type, array)}` : ''} = ${e.code};`);
        else out.push(`${ind}var ${name}${typed ? ` : ${wType(type, array)}` : ''} = ${e.code};`);
      }
      scope.set(d.name, { type, array, code: name });
    }
    return out;
  }

  /** A statement with no `;` or indent (a for loop's start or step). */
  simpleStmt(e, scope, line) {
    const lines = this.exprStmt(e, scope, '', line);
    if (lines.length !== 1) this.err('this cannot be a for loop\'s step', line);
    return lines[0].replace(/;$/, '');
  }

  exprStmt(e, scope, ind, line) {
    if (e.k === 'preinc' || e.k === 'postinc') {
      const t = this.lvalue(e.e, scope);
      return [`${ind}${t.code}${e.op};`];
    }
    if (e.k === 'assign') return this.assign(e, scope, ind);
    if (e.k === 'call') {
      const bridged = this.bridgedCall(e, scope, ind);
      if (bridged) return bridged;
      const c = this.expr(e, scope);
      return [`${ind}${c.code.startsWith('(') ? `_ = ${c.code}` : c.code};`];
    }
    this.err('this expression does nothing as a statement', line);
  }

  assign(e, scope, ind) {
    const lhs = this.lvalue(e.lhs, scope);
    let rhs = this.expr(e.rhs, scope);
    const op = e.op;
    if (op === '%=' && scalarOf(lhs.type) === 'float') this.err('%= on floats is not supported', e.line);
    // WGSL takes `v op= s` for a vector and a scalar as GLSL does, so only `=` needs the scalar spread.
    const scalarOnVector = op !== '=' && comps(rhs.type) === 1 && comps(lhs.type) > 1;
    if (scalarOnVector) rhs = this.convert(rhs, scalarOf(lhs.type), e.line);
    else if (op === '=' || op === '+=' || op === '-=' || op === '/=') rhs = this.convert(rhs, lhs.type, e.line);
    else if (op === '*=' && !isMat(lhs.type) && !(isVec(lhs.type) && isMat(rhs.type))) rhs = this.convert(rhs, lhs.type, e.line);
    if (lhs.swizzle && lhs.swizzle.length > 1) {
      // WGSL writes one component at a time.
      const t = `es_t${this.tmp++}`;
      // A scalar on the right (`v.rgb *= s`) reaches every component as itself.
      const scalar = comps(rhs.type) === 1;
      const parts = [...lhs.swizzle].map((c, i) => `${lhs.base}.${c} ${op} ${scalar ? t : `${t}.${'xyzw'[i]}`};`);
      return [`${ind}{ let ${t} = ${strip(rhs.code)}; ${parts.join(' ')} }`];
    }
    if ((op === '<<=' || op === '>>=') && scalarOf(rhs.type) === 'int') rhs = { code: `u32(${strip(rhs.code)})`, type: 'uint' };
    return [`${ind}${lhs.code} ${op} ${strip(rhs.code)};`];
  }

  /** What can be written: { code, type, base?, swizzle?, ptr? }. */
  lvalue(e, scope) {
    if (e.k === 'paren') return this.lvalue(e.e, scope);
    if (e.k === 'id') {
      const v = scope.get(e.name);
      if (v) return { code: v.code, type: v.type, ptr: v.ptr, array: v.array };
      const o = this.outputs.find((x) => x.name === e.name);
      if (o) return { code: safe(e.name), type: o.type };
      const c = this.consts.get(e.name);
      if (c) return { code: c.wgsl, type: c.type, array: c.array };
      const g = this.env.globals.get(e.name);
      if (g && g.wgsl && !g.from) return { code: g.wgsl, type: g.type };
      this.err(`'${e.name}' cannot be written`, e.line);
    }
    if (e.k === 'field') {
      const base = this.lvalue(e.e, scope);
      if (isVec(base.type) || SCALARS.has(base.type)) {
        const sw = swizzle(e.f, e.line);
        const t = vecOf(scalarOf(base.type), sw.length);
        return { code: `${base.code}.${sw}`, type: t, base: base.code, swizzle: sw };
      }
      const ft = this.fieldType(base.type, e.f, e.line);
      return { code: `${base.code}.${safe(e.f)}`, type: ft.type, array: ft.array };
    }
    if (e.k === 'index') {
      const base = this.lvalue(e.e, scope);
      const idx = this.expr(e.idx, scope);
      return { code: `${base.code}[${strip(idx.code)}]`, type: indexType(base, e.line) };
    }
    this.err('this cannot be written to', e.line);
  }

  // ---- expressions: { code, type, abstract? } ----
  expr(e, scope) {
    switch (e.k) {
      case 'num': {
        const v = e.v;
        if (/[uU]$/.test(v)) return { code: v, type: 'uint', abstract: false };
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
        const idx = this.expr(e.idx, scope);
        return { code: `${base.code}[${strip(idx.code)}]`, type: indexType(base, e.line) };
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
      case 'assign': case 'preinc': case 'postinc': this.err('an assignment or ++/-- inside an expression is not supported', e.line);
      // falls through
      case 'type': this.err(`'${e.name}' used as a value`, e.line);
      // falls through
      default: this.err(`unexpected ${e.k}`, e.line);
    }
  }

  ident(e, scope) {
    const n = e.name;
    const v = scope.get(n);
    if (v) {
      if (v.sampler) this.err(`sampler '${n}' is read only by a texture function`, e.line);
      return { code: v.code, type: v.type, array: v.array };
    }
    if (n === 'gl_FragCoord') { this.usesFragCoord = true; return { code: 'es_v.pos', type: 'vec4' }; }
    if (n === 'gl_FrontFacing') { this.usesFront = true; return { code: 'es_front', type: 'bool' }; }
    const c = this.consts.get(n);
    if (c) return { code: c.wgsl, type: c.type, array: c.array };
    if (this.env.varyings.has(n)) return { code: `es_v.${n}`, type: glslOfWgsl(this.env.varyings.get(n)) };
    const o = this.outputs.find((x) => x.name === n);
    if (o) return { code: safe(n), type: o.type };
    if (this.env.params.has(n) && this.env.params.get(n).type !== 'texture') return { code: `mc.${n}`, type: this.paramType(n, e.line) };
    if (this.samplerParams.has(n) || this.env.params.get(n)?.type === 'texture') this.err(`sampler '${n}' is read only by a texture function`, e.line);
    const g = this.env.globals.get(n);
    if (g) {
      if (!g.wgsl) this.err(`'${n}' is the engine's in GLSL and has no WGSL counterpart it can be read as`, e.line);
      return { code: g.wgsl, type: g.type, array: g.array ? this.constIntOrEnv(g.array) : null };
    }
    this.err(`'${n}' is not declared`, e.line);
  }

  constIntOrEnv(a) { return a.k === 'num' ? Number(a.v) : 1; }

  paramType(n, line) {
    const g = this.env.globals.get(n);
    if (g) return g.type;
    this.err(`param '${n}' has no type the engine gives it`, line);
  }

  field(e, scope) {
    const base = this.expr(e.e, scope);
    if (isVec(base.type) || SCALARS.has(base.type)) {
      const sw = swizzle(e.f, e.line);
      return { code: `${wrap(base.code)}.${sw}`, type: vecOf(scalarOf(base.type), sw.length) };
    }
    if (e.f === 'length' && base.array) this.err('.length() is not supported', e.line);
    const ft = this.fieldType(base.type, e.f, e.line);
    return { code: `${wrap(base.code)}.${safe(e.f)}`, type: ft.type, array: ft.array };
  }

  fieldType(structName, f, line) {
    const s = this.structs.get(structName);
    if (!s) this.err(`'${structName}' has no field '${f}'`, line);
    const field = s.find((x) => x.name === f);
    if (!field) this.err(`'${structName}' has no field '${f}'`, line);
    return { type: field.type, array: field.array ? this.constIntOrEnv(field.array) : null };
  }

  binary(e, scope) {
    const l = this.expr(e.l, scope), r = this.expr(e.r, scope);
    const op = e.op;
    const lc = wrapBin(l.code), rc = wrapBin(r.code);
    if (op === '&&' || op === '||') return { code: `${lc} ${op} ${rc}`, type: 'bool' };
    if (op === '^^') return { code: `${lc} != ${rc}`, type: 'bool' };
    if (['<', '>', '<=', '>='].includes(op)) {
      const [a, b] = this.unify(l, r, e.line);
      return { code: `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`, type: 'bool' };
    }
    if (op === '==' || op === '!=') {
      const [a, b] = this.unify(l, r, e.line);
      const code = `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`;
      if (isVec(a.type)) return { code: `${op === '==' ? 'all' : 'any'}(${code})`, type: 'bool' };
      return { code, type: 'bool' };
    }
    if (op === '<<' || op === '>>') {
      const amount = scalarOf(r.type) === 'int' && !r.abstract ? `u32(${strip(r.code)})` : rc;
      return { code: `${lc} ${op} ${wrapBin(amount)}`, type: l.type };
    }
    if (op === '&' || op === '|' || op === '^') {
      const [a, b] = this.unify(l, r, e.line);
      return { code: `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`, type: a.type, abstract: a.abstract && b.abstract };
    }
    if (op === '%' && scalarOf(l.type) === 'float') {
      const t = comps(l.type) >= comps(r.type) ? l.type : r.type;
      return { code: `${this.modHelper(t)}(${strip(this.convert(l, t, e.line).code)}, ${strip(this.convert(r, t, e.line).code)})`, type: t };
    }
    // Arithmetic.
    if (isMat(l.type) || isMat(r.type)) {
      let type;
      if (isMat(l.type) && isMat(r.type)) type = l.type;
      else if (isMat(l.type) && isVec(r.type)) type = r.type;
      else if (isVec(l.type) && isMat(r.type)) type = l.type;
      else type = isMat(l.type) ? l.type : r.type;
      return { code: `${lc} ${op} ${rc}`, type };
    }
    const [a, b] = this.unify(l, r, e.line, true);
    const type = comps(a.type) >= comps(b.type) ? a.type : b.type;
    return { code: `${wrapBin(a.code)} ${op} ${wrapBin(b.code)}`, type, abstract: a.abstract && b.abstract };
  }

  /** Two operands made the same scalar type (a literal takes the other's), vector and scalar mixed where `mixedOk`. */
  unify(a, b, line, mixedOk = false) {
    const sa = scalarOf(a.type), sb = scalarOf(b.type);
    if (sa !== sb) {
      if (a.abstract) a = { ...a, type: vecOf(sb, comps(a.type)), abstract: false };
      else if (b.abstract) b = { ...b, type: vecOf(sa, comps(b.type)), abstract: false };
      else this.err(`${a.type} and ${b.type} mixed in one operation`, line);
    }
    if (!mixedOk && comps(a.type) !== comps(b.type)) {
      if (comps(a.type) === 1) a = this.convert(a, b.type, line);
      else if (comps(b.type) === 1) b = this.convert(b, a.type, line);
    }
    return [a, b];
  }

  /** `x` as a value of `type`: a literal or a constructor's argument converts; anything else must already be it. */
  convert(x, type, line, array) {
    if (array || x.type === type || !type || type === 'void') return x;
    const n = comps(type), s = scalarOf(type);
    if (!s) {
      if (x.type !== type) this.err(`${x.type} where ${type} is wanted`, line);
      return x;
    }
    if (x.abstract && comps(x.type) === 1) {
      if (n === 1) {
        if (s === 'float' && scalarOf(x.type) === 'int') return { code: `${x.code}.0`.replace(/^(-?)(\d+)\.0$/, '$1$2.0'), type };
        return { ...x, type, abstract: true };
      }
      return { code: `${wType(type)}(${strip(x.code)})`, type };
    }
    if (comps(x.type) === 1 && n > 1) {
      const inner = scalarOf(x.type) === s ? strip(x.code) : `${wScalar[s]}(${strip(x.code)})`;
      return { code: `${wType(type)}(${inner})`, type };
    }
    if (comps(x.type) === n) return { code: `${wType(type)}(${strip(x.code)})`, type };
    this.err(`${x.type} where ${type} is wanted`, line);
  }

  modHelper(t) {
    const name = `es_mod${comps(t)}`;
    if (!this.helpers.has(name)) {
      const w = wType(t);
      this.helpers.set(name, `fn ${name}(x : ${w}, y : ${w}) -> ${w} { return x - y * floor(x / y); }`);
    }
    return name;
  }

  // ---- calls ----
  call(e, scope) {
    const n = e.name;
    if (VEC.test(n) || MAT.test(n) || SCALARS.has(n)) return this.construct(e, scope);
    if (this.structs.has(n) && !this.fns.has(n)) {
      const fields = this.structs.get(n);
      const args = e.args.map((a, i) => strip(this.convert(this.expr(a, scope), fields[i]?.type, e.line).code));
      return { code: `${n}(${args.join(', ')})`, type: n };
    }
    if (/^(texture|textureLod|texelFetch|textureSize|textureGrad)$/.test(n)) return this.texture(e, scope);
    if (this.fns.has(n)) return this.userCall(e, scope);
    if (n in BUILTINS || ['mod', 'atan', 'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'not',
      'floatBitsToUint', 'floatBitsToInt', 'uintBitsToFloat', 'intBitsToFloat', 'inverse', 'isnan', 'isinf'].includes(n)) return this.builtin(e, scope);
    if (this.env.fns.has(n)) return this.engineCall(e, scope);
    this.err(`function '${n}' is not declared`, e.line);
  }

  construct(e, scope) {
    const t = e.name === 'mat2x2' ? 'mat2' : e.name === 'mat3x3' ? 'mat3' : e.name === 'mat4x4' ? 'mat4' : e.name;
    const args = e.args.map((a) => this.expr(a, scope));
    if (SCALARS.has(t)) {
      if (args.length !== 1) this.err(`${t}() takes one argument`, e.line);
      const a = args[0];
      if (a.type === t) return { code: strip(a.code), type: t };
      if (comps(a.type) > 1) return { code: `${wScalar[t]}(${wrap(a.code)}.x)`, type: t };
      if (a.abstract && t === 'float') return { code: `f32(${strip(a.code)})`, type: t };
      return { code: `${wScalar[t]}(${strip(a.code)})`, type: t };
    }
    if (isVec(t)) {
      const n = comps(t), s = scalarOf(t);
      if (args.length === 1 && comps(args[0].type) > n && isVec(args[0].type)) {
        // GLSL takes the first components of a longer vector; WGSL wants them named.
        const sub = `${wrap(args[0].code)}.${'xyzw'.slice(0, n)}`;
        return scalarOf(args[0].type) === s ? { code: sub, type: t } : { code: `${wType(t)}(${sub})`, type: t };
      }
      if (args.length === 1 && isMat(args[0].type)) this.err('a vector made from a matrix is not supported', e.line);
      const parts = args.map((a) => {
        if (scalarOf(a.type) === s || a.abstract) return strip(a.code);
        return comps(a.type) === 1 ? `${wScalar[s]}(${strip(a.code)})` : `${wType(vecOf(s, comps(a.type)))}(${strip(a.code)})`;
      });
      return { code: `${wType(t)}(${parts.join(', ')})`, type: t };
    }
    // Matrices.
    const m = MAT.exec(t);
    const n = Number(m[1]);
    if (args.length === 1 && comps(args[0].type) === 1) {
      const d = strip(args[0].code);
      const cols = [];
      for (let c = 0; c < n; c++) cols.push(Array.from({ length: n }, (_, r) => (r === c ? d : '0.0')).join(', '));
      return { code: `${wType(t)}(${cols.join(', ')})`, type: t };
    }
    if (args.length === 1 && isMat(args[0].type)) {
      const k = Number(MAT.exec(args[0].type)[1]);
      if (k === n) return { code: strip(args[0].code), type: t };
      if (k > n) {
        const src = wrap(args[0].code);
        return { code: `${wType(t)}(${Array.from({ length: n }, (_, c) => `${src}[${c}].${'xyzw'.slice(0, n)}`).join(', ')})`, type: t };
      }
      this.err('a larger matrix made from a smaller one is not supported', e.line);
    }
    return { code: `${wType(t)}(${args.map((a) => strip(a.code)).join(', ')})`, type: t };
  }

  builtin(e, scope) {
    const n = e.name;
    let args = e.args.map((a) => this.expr(a, scope));
    const vecType = () => args.reduce((t, a) => (comps(a.type) > comps(t) ? a.type : t), args[0].type);
    const splatTo = (t) => { args = args.map((a) => (comps(a.type) === 1 && comps(t) > 1 ? this.convert(a, t, e.line) : this.convert(a, comps(a.type) === comps(t) ? vecOf(scalarOf(t), comps(a.type)) : a.type, e.line))); };
    const codes = () => args.map((a) => strip(a.code)).join(', ');
    switch (n) {
      case 'mod': { const t = vecType(); splatTo(t); return { code: `${this.modHelper(t)}(${codes()})`, type: t }; }
      case 'atan': {
        if (args.length === 2) { const t = vecType(); splatTo(t); return { code: `atan2(${codes()})`, type: t }; }
        return { code: `atan(${codes()})`, type: args[0].type };
      }
      case 'lessThan': case 'lessThanEqual': case 'greaterThan': case 'greaterThanEqual': case 'equal': case 'notEqual': {
        const op = { lessThan: '<', lessThanEqual: '<=', greaterThan: '>', greaterThanEqual: '>=', equal: '==', notEqual: '!=' }[n];
        return { code: `(${wrapBin(args[0].code)} ${op} ${wrapBin(args[1].code)})`, type: `bvec${comps(args[0].type)}` };
      }
      case 'not': return { code: `!${wrap(args[0].code)}`, type: args[0].type };
      case 'floatBitsToUint': return { code: `bitcast<${wType(vecOf('uint', comps(args[0].type)))}>(${codes()})`, type: vecOf('uint', comps(args[0].type)) };
      case 'floatBitsToInt': return { code: `bitcast<${wType(vecOf('int', comps(args[0].type)))}>(${codes()})`, type: vecOf('int', comps(args[0].type)) };
      case 'uintBitsToFloat': case 'intBitsToFloat': return { code: `bitcast<${wType(vecOf('float', comps(args[0].type)))}>(${codes()})`, type: vecOf('float', comps(args[0].type)) };
      case 'isnan': return { code: `(${wrapBin(args[0].code)} != ${wrapBin(args[0].code)})`, type: comps(args[0].type) > 1 ? `bvec${comps(args[0].type)}` : 'bool' };
      case 'inverse': case 'isinf': this.err(`${n}() has no WGSL builtin and is not supported yet`, e.line);
      // falls through
      default: break;
    }
    const w = BUILTINS[n];
    if (FLOAT_RESULT.has(n)) return { code: `${w}(${codes()})`, type: 'float' };
    if (n === 'cross') return { code: `cross(${codes()})`, type: 'vec3' };
    if (n === 'any' || n === 'all') return { code: `${w}(${codes()})`, type: 'bool' };
    if (n === 'mix' && args.length === 3 && scalarOf(args[2].type) === 'bool') {
      const t = vecType();
      return { code: `select(${strip(this.convert(args[0], t, e.line).code)}, ${strip(this.convert(args[1], t, e.line).code)}, ${strip(args[2].code)})`, type: t };
    }
    if (n === 'mix') {
      const t = comps(args[0].type) >= comps(args[1].type) ? args[0].type : args[1].type;
      args[0] = this.convert(args[0], t, e.line); args[1] = this.convert(args[1], t, e.line);
      if (comps(args[2].type) !== 1) args[2] = this.convert(args[2], t, e.line);
      else args[2] = this.convert(args[2], scalarOf(t), e.line);
      return { code: `mix(${codes()})`, type: t };
    }
    if (n === 'step' || n === 'smoothstep' || n === 'min' || n === 'max' || n === 'clamp' || n === 'pow') {
      const t = vecType();
      splatTo(t);
      return { code: `${w}(${codes()})`, type: t };
    }
    if (n === 'transpose') return { code: `transpose(${codes()})`, type: args[0].type };
    return { code: `${w}(${codes()})`, type: args[0].type, abstract: false };
  }

  /** A sampler argument as { tex, smp }. */
  sampler(a, scope, line) {
    if (a.k === 'index' && a.e.k === 'id' && a.e.name === 'u_textures' && a.idx.k === 'num') {
      const s = this.samplerParams.get(`u_textures[${a.idx.v}]`);
      if (!s) this.err(`u_textures[${a.idx.v}] is past the units the shader declares`, line);
      return s;
    }
    if (a.k === 'id') {
      const v = scope.get(a.name);
      if (v?.sampler) return v.sampler;
      if (this.samplerParams.has(a.name)) return this.samplerParams.get(a.name);
      if (this.env.params.get(a.name)?.type === 'texture') return { tex: a.name, smp: `${a.name}_s` };
      const g = this.env.globals.get(a.name);
      if (g?.sampler) this.err(`engine sampler '${a.name}' has no WGSL name this knows`, line);
    }
    this.err('a texture function reads a sampler named directly', line);
  }

  texture(e, scope) {
    const s = this.sampler(e.args[0], scope, e.line);
    const rest = e.args.slice(1).map((a) => this.expr(a, scope));
    const c = (i, t) => strip(this.convert(rest[i], t, e.line).code);
    switch (e.name) {
      case 'texture':
        if (rest.length === 2) return { code: `textureSampleBias(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'float')})`, type: 'vec4' };
        return { code: `textureSample(${s.tex}, ${s.smp}, ${c(0, 'vec2')})`, type: 'vec4' };
      case 'textureLod': return { code: `textureSampleLevel(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'float')})`, type: 'vec4' };
      case 'textureGrad': return { code: `textureSampleGrad(${s.tex}, ${s.smp}, ${c(0, 'vec2')}, ${c(1, 'vec2')}, ${c(2, 'vec2')})`, type: 'vec4' };
      case 'texelFetch': return { code: `textureLoad(${s.tex}, ${c(0, 'ivec2')}, ${c(1, 'int')})`, type: 'vec4' };
      case 'textureSize': return { code: `vec2i(textureDimensions(${s.tex}, ${c(0, 'int')}))`, type: 'ivec2' };
      default: this.err(`${e.name} is not supported`, e.line);
    }
  }

  userCall(e, scope) {
    const list = this.fns.get(e.name);
    const args = e.args.map((a) => (isSamplerArg(a, this, scope) ? null : this.expr(a, scope)));
    const f = list.length === 1 ? list[0] : list.find((x) => x.params.length === e.args.length && x.params.every((p, i) => args[i] === null ? isSampler(p.type) : p.type === args[i].type || args[i].abstract));
    if (!f) this.err(`no '${e.name}' takes these arguments`, e.line);
    const out = [];
    f.params.forEach((p, i) => {
      if (isSampler(p.type)) { const s = this.sampler(e.args[i], scope, e.line); out.push(s.tex, s.smp); return; }
      if (p.quals.includes('out') || p.quals.includes('inout')) { out.push(this.address(e.args[i], scope, e.line)); return; }
      out.push(strip(this.convert(args[i], p.type, e.line, p.array && this.constInt(p.array)).code));
    });
    return { code: `${f.wname}(${out.join(', ')})`, type: f.ret };
  }

  /** `&x` for an out argument: a variable, a field or an element of one; a pointer parameter passes on as itself. */
  address(a, scope, line) {
    const lv = this.lvalue(a, scope);
    if (lv.swizzle) this.err('a swizzle as an out argument is not supported', line);
    if (lv.ptr && a.k === 'id') return lv.ptr;
    return `&${lv.code}`;
  }

  engineCall(e, scope) {
    const n = e.name;
    const sig = this.env.fns.get(n);
    const wsig = this.env.wgsl.fns.get(n);
    if (!wsig) this.err(`engine function '${n}' has no WGSL counterpart`, e.line);
    if (BRIDGES[n]) this.err(`'${n}' writes its arguments; it can only be called as a statement of its own`, e.line);
    if (sig.params.some((p) => p.quals.includes('out') || p.quals.includes('inout'))) this.err(`engine function '${n}' writes an argument and has no bridge`, e.line);
    const out = [];
    sig.params.forEach((p, i) => {
      if (isSampler(p.type)) { const s = this.sampler(e.args[i], scope, e.line); out.push(s.tex, s.smp); return; }
      out.push(strip(this.convert(this.expr(e.args[i], scope), p.type, e.line).code));
    });
    if (out.length !== wsig.params.length) this.err(`engine function '${n}' takes ${wsig.params.length} arguments in WGSL and ${out.length} in GLSL`, e.line);
    return { code: `${n}(${out.join(', ')})`, type: sig.ret };
  }

  bridgedCall(e, scope, ind) {
    const b = BRIDGES[e.name];
    if (!b || this.fns.has(e.name)) return null;
    const sig = this.env.fns.get(e.name);
    const ins = [], outs = [];
    sig.params.forEach((p, i) => {
      if (b.outs.includes(i)) { outs.push(this.lvalue(e.args[i], scope)); return; }
      ins.push(strip(this.convert(this.expr(e.args[i], scope), p.type, e.line).code));
    });
    const t = `es_t${this.tmp++}`;
    const writes = outs.map((o, k) => `${o.code} ${b.accumulate ? '+=' : '='} ${t}.${b.fields[k]};`);
    return [`${ind}{ let ${t} = ${e.name}(${ins.join(', ')}); ${writes.join(' ')} }`];
  }

  // ---- the entry ----
  entry() {
    const lines = [];
    lines.push('var<private> es_v : VSOut;');
    if (this.usesFront) lines.push('var<private> es_front : bool;');
    // One entry per combination of the conditions the outputs are declared under.
    const conds = [...new Set(this.outputs.flatMap((o) => o.guard.map((g) => g.cond)))];
    if (conds.length > 3) this.err('outputs declared under more than three conditions');
    const combos = conds.length ? Array.from({ length: 1 << conds.length }, (_, m) => conds.map((c, i) => ({ cond: c, on: Boolean(m & (1 << i)) }))) : [[]];
    for (const combo of combos) {
      const active = [];
      for (const o of this.outputs) {
        const live = o.guard.every((g) => combo.find((c) => c.cond === g.cond).on !== g.neg);
        if (live && !active.some((a) => a.name === o.name)) active.push(o);
      }
      const guard = combo.map((c) => (c.on ? c.cond : `!${c.cond}`)).join(' && ');
      const params = ['es_in : VSOut', ...(this.usesFront ? ['@builtin(front_facing) es_ff : bool'] : [])].join(', ');
      const setup = `    es_v = es_in;${this.usesFront ? ' es_front = es_ff;' : ''}\n    es_main();`;
      let fn;
      if (active.length === 1 && active[0].location === 0) {
        fn = `@fragment fn fs_main(${params}) -> @location(0) ${wType(active[0].type)} {\n${setup}\n    return ${safe(active[0].name)};\n}`;
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

class Scope {
  constructor(parent = null) { this.parent = parent; this.vars = new Map(); }
  child() { return new Scope(this); }
  set(n, v) { this.vars.set(n, v); }
  get(n) { return this.vars.get(n) ?? this.parent?.get(n); }
  has(n) { return this.vars.has(n); }
}

function isSamplerArg(a, emitter, scope) {
  if (a.k === 'index' && a.e.k === 'id' && a.e.name === 'u_textures') return true;
  if (a.k !== 'id') return false;
  return Boolean(scope.get(a.name)?.sampler || emitter.samplerParams.has(a.name) || emitter.env.params.get(a.name)?.type === 'texture');
}

/** Names a function body writes: assigned, incremented, or handed to a parameter that writes it. */
function assignedNames(body, writtenArgs) {
  const out = new Set();
  const root = (e) => { while (e && (e.k === 'field' || e.k === 'index' || e.k === 'paren')) e = e.e; return e?.k === 'id' ? e.name : null; };
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (n.k === 'assign' || n.k === 'preinc' || n.k === 'postinc') { const r = root(n.lhs ?? n.e); if (r) out.add(r); }
    if (n.k === 'call') {
      const writes = writtenArgs(n.name);
      n.args.forEach((a, i) => { if (writes.has(i)) { const r = root(a); if (r) out.add(r); } });
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
  };
  visit(body);
  return out;
}

function swizzle(f, line) {
  if (!/^([xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/.test(f)) throw new GlslError(`'.${f}' is not a swizzle`, line);
  return f.replace(/[stpq]/g, (c) => 'xyzw'['stpq'.indexOf(c)]);
}

function indexType(base, line) {
  if (base.array) return base.type;
  if (isVec(base.type)) return scalarOf(base.type);
  const m = MAT.exec(base.type);
  if (m) return `vec${m[2] ?? m[1]}`;
  throw new GlslError(`${base.type} cannot be indexed`, line);
}

function glslOfWgsl(w) {
  const m = /^vec([234])([fiu])$/.exec(w);
  if (m) return `${{ f: '', i: 'i', u: 'u' }[m[2]]}vec${m[1]}`;
  return { f32: 'float', i32: 'int', u32: 'uint', bool: 'bool' }[w] ?? w;
}

/** An expression with its outermost redundant parentheses taken off. */
function strip(code) {
  if (!code.startsWith('(') || !code.endsWith(')')) return code;
  let d = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '(') d++;
    else if (code[i] === ')') { d--; if (d === 0 && i < code.length - 1) return code; }
  }
  return code.slice(1, -1);
}
/**
 * Whether `code` is one primary term — a literal, a name, a call, a parenthesised group — with any member or index after it,
 * so it needs no parentheses as an operand. `f(a) + g(b)` is not: its first group closes before the end.
 */
function isAtom(code) {
  if (/^\d[\w.]*(?:[eE][+-]?\d+)?[uf]?$/.test(code) || /^\.\d/.test(code) && /^[\w.]+(?:[eE][+-]?\d+)?$/.test(code)) return true;
  let i = 0;
  const m = /^[A-Za-z_][\w]*(?:<[\w<>, ]+>)?/.exec(code);
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
const wrap = (code) => (isAtom(code) ? code : `(${code})`);
const wrapBin = (code) => (isAtom(code) || /^-[\w.]+$/.test(code) ? code : `(${code})`);

/** `#ifdef X` / `#else` / `#endif` groups left with nothing in them, gone. */
export function dropEmptyConditionals(text) {
  let prev;
  do {
    prev = text;
    text = text.replace(/^#\s*(?:ifdef|ifndef|if)\b[^\n]*\n(?:#\s*else[^\n]*\n)?#\s*endif[^\n]*(?:\n|$)/gm, '');
    text = text.replace(/^#\s*else[^\n]*\n(#\s*endif)/gm, '$1');
  } while (text !== prev);
  return text;
}
