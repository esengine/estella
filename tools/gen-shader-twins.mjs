// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * gen-shader-twins — cook-time GLSL→WGSL twin generation (REARCH_WGSL Phase 4).
 *
 * For each user-authored .esshader that lacks a WGSL twin, this appends
 * self-contained `#pragma vertex wgsl full` / `#pragma fragment wgsl full`
 * sections so the shader runs on the WebGPU backend, via the pipeline:
 *
 *   engine wasm (esshader_cookInfo)   — assemble both GLSL stages EXACTLY as the
 *                                       runtime does (zero drift) + reflection
 *   dialect adaptation (this file)    — 300 es → 310 es, precision → highp,
 *                                       engine UBO bindings, combined samplers
 *                                       split into texture/sampler pairs at the
 *                                       group-1 unit map, explicit varying
 *                                       locations
 *   glslang (vendored wasm)           — GLSL ES 310 → SPIR-V (Vulkan semantics,
 *                                       -V --auto-map-locations equivalent)
 *   naga (vendored WASI wasm)         — SPIR-V → WGSL, in-process
 *   post (this file)                  — entry rename to vs_main/fs_main
 *
 * A material's vertex hook (`#pragma vertexoffset`) is translated the same way, as a small program of its own: the hook, the material's block and
 * a `main` that calls it. What comes out is the hook's function and the helpers it calls, under the names the engine's WGSL vertex stage injects them
 * with (`esMaterialVertex(local, localNormal, uv)`, the material block as `mc`). A hook that reads a texture is not translated.
 *
 * Both converters live in build-tools/shader-twins/ as committed wasm — the
 * pipeline needs no Vulkan SDK, no Rust toolchain, no PATH binaries.
 *
 * The emitted twins are FULL programs: ShaderParser skips its injected headers
 * for `wgsl full` sections, so the translated header declarations don't clash.
 * The engine's bind conventions ride explicit GLSL layout qualifiers:
 * group 0 = FrameConstants 0 / MaterialConstants 1 / LightConstants 2 /
 * TimeConstants 3; group 1 = texture unit u at binding (u<8 ? u : u+8) with its
 * sampler at (u<8 ? u+8 : u+16) — mirrors WebGPUMappings.
 *
 * Usage: node tools/gen-shader-twins.mjs [--check] [--force] [--derived | --strip] <file.esshader ...>
 *   --check  report what would change, write nothing (exit 1 if any)
 *   --force  regenerate even when a twin exists (replaces generated sections)
 *   --derived  for sources that carry NO generated twin and have it derived when read (the repo's own examples,
 *            fixtures and games): each must still translate, and one that commits a generated twin is reported
 *   --strip  remove the committed generated twin from a source that can derive it (the one-time migration)
 *
 * Requires: a built engine (pnpm build:web). A `#pragma switch` or feature is a
 * toggle: every combination is emitted into one body behind the same `#ifdef`
 * the GLSL side uses. Past three toggles the file is skipped and says so —
 * each one doubles the emitted programs.
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glslToSpv } from '../build-tools/shader-twins/glslang.mjs';
import { resolveWasmDir } from './lib/wasmDir.mjs';
import { spvFileToWgsl } from '../build-tools/shader-twins/naga.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WASM_GLUE = path.join(resolveWasmDir('esengine.js'), 'esengine.js');

// Engine group-0 UBO slots (Shader::compile / WebGPU bind conventions).
const BLOCK_BINDINGS = {
  FrameConstants: 0,
  MaterialConstants: 1,
  LightConstants: 2,
  TimeConstants: 3,
  // Where a draw's objects start in the frame's record texture, which the
  // injected header declares for every vertex stage that reads a record — see
  // InstanceConstants.hpp.
  InstanceConstants: 8,
  // The indirect light where a draw stands, which the injected Lit header
  // declares for every Lit fragment stage — see ProbeConstants.hpp.
  ProbeConstants: 7,
  PlanarConstants: 9,
};

/** The blocks above, as the pattern that finds them. Derived and not spelled a
 *  second time: a block added to the table but missing from a hand-written
 *  alternation is one glslang refuses for want of a binding. */
const BLOCK_DECLARATION = new RegExp(
  String.raw`layout\s*\(\s*std140\s*\)\s*uniform\s+(${Object.keys(BLOCK_BINDINGS).join('|')})\b`,
  'g',
);

// The samplers the Lit-2D header declares, on the units it pins them to. Mirrors
// LightConstants.hpp, which is where a unit is decided: a twin generated against a
// stale copy binds the wrong texture and says nothing.
const ENGINE_SAMPLERS = [
  { name: 'u_shadowMap', unit: 2 },
  { name: 'u_envMap', unit: 3 },
  { name: 'u_shadow2D', unit: 7 },
  { name: 'u_lightShape2D', unit: 6 },
  { name: 'u_lightmap', unit: 5 },
  // The two the VERTEX stage reads, pinned in MorphConstants.hpp and
  // InstanceConstants.hpp. The record sits on the TOP unit, above every unit a
  // material's own textures are handed (see GfxEnums MESH_INSTANCE_TEXTURE_UNIT).
  { name: 'u_morphDeltas', unit: 4 },
  { name: 'u_instanceData', unit: 15 },
];

// Group-1 unit map — mirrors WebGPUMappings textureBindingForUnit/samplerBindingForUnit.
const textureBindingForUnit = (u) => (u < 8 ? u : u + 8);
const samplerBindingForUnit = (u) => (u < 8 ? u + 8 : u + 16);

const bannerFor = (hash, assembled) =>
  '// GENERATED by tools/gen-shader-twins.mjs (glslang + naga) - do not edit.\n' +
  '// Regenerate after changing the GLSL stages above.\n' +
  `// source-hash: ${hash}\n` +
  `// assembled-hash: ${assembled}`;

const STORED_HASH_RE = /\/\/ source-hash:\s*([0-9a-f]+)/;
const STORED_ASSEMBLED_RE = /\/\/ assembled-hash:\s*([0-9a-f]+)/;

/**
 * Adapt an assembled GLSL ES 300 stage to the dialect glslang -V + naga accept,
 * with the engine's binding conventions made explicit.
 */
function adaptGlsl(glsl, textures) {
  let out = glsl;

  // Strip comments first: GLSL has no string literals, so this is always safe,
  // and it keeps the rewrites below from matching declaration text quoted in
  // comments (a real fixture hit this).
  out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // 310 es: the minimum ES version glslang emits SPIR-V for; a superset of the
  // authored 300 es dialect.
  out = out.replace(/#version\s+300\s+es/, '#version 310 es');

  // Precision: force highp everywhere. mediump/lowp emit RelaxedPrecision
  // SPIR-V decorations naga rejects; raising precision is semantically safe.
  out = out.replace(/precision\s+(lowp|mediump)\s+float\s*;/g, 'precision highp float;');
  out = out.replace(/\b(lowp|mediump)\s+/g, 'highp ');
  if (!/precision\s+highp\s+float\s*;/.test(out)) {
    out = out.replace(/(#version[^\n]*\n)/, '$1precision highp float;\n');
  }

  // Engine UBO slots as explicit bindings (SPIR-V descriptor set 0 = WGSL group 0).
  out = out.replace(
    BLOCK_DECLARATION,
    (m, name) => `layout(std140, binding = ${BLOCK_BINDINGS[name]}) uniform ${name}`,
  );

  // Combined samplers → split texture/sampler pairs (naga's SPIR-V frontend has
  // no combined-image-sampler support; WebGPU has no such object either).
  // Vulkan GLSL only allows the sampler2D(t, s) constructor DIRECTLY at a
  // sampling call, so every use form is rewritten explicitly:
  //   - sampling builtins: texture(N, ..) → texture(sampler2D(N_est, N_ess), ..)
  //   - functions taking sampler2D params: the param splits into a
  //     texture2D/sampler pair, and call sites pass both halves.
  const combined = new Set();  // names that split into <name>_est / <name>_ess
  const splitUniformDecl = (name, unit) =>
    `layout(set = 1, binding = ${textureBindingForUnit(unit)}) uniform highp texture2D ${name}_est;\n` +
    `layout(set = 1, binding = ${samplerBindingForUnit(unit)}) uniform highp sampler ${name}_ess;`;

  // Batch texture contract: `uniform sampler2D u_textures[8];` = engine units 0..7.
  out = out.replace(/uniform\s+(?:highp\s+)?sampler2D\s+u_textures\s*\[\s*8\s*\]\s*;/g, () => {
    const decls = [];
    for (let u = 0; u < 8; u++) {
      decls.push(splitUniformDecl(`es_bt${u}`, u));
      combined.add(`es_bt${u}`);
    }
    return decls.join('\n');
  });
  // Constant-indexed accesses (the only legal ES 3.00 form) become unit names,
  // handled by the generic use rewrites below.
  out = out.replace(/\bu_textures\s*\[\s*(\d)\s*\]/g, (m, d) => `es_bt${d}`);
  if (/\bu_textures\b/.test(out)) {
    throw new Error('u_textures indexed with a non-literal expression - cannot split for WGSL');
  }

  // Reflected texture params (assembled as `uniform highp sampler2D <name>;`)
  // at their reflected material units, then the ones the injected header brings.
  for (const { name, unit } of [...textures, ...ENGINE_SAMPLERS]) {
    const declRe = new RegExp(`uniform\\s+(?:highp\\s+)?sampler2D\\s+${name}\\s*;`);
    if (!declRe.test(out)) continue;
    out = out.replace(declRe, splitUniformDecl(name, unit));
    combined.add(name);
  }

  // Any remaining combined sampler DECLARATION (not a function param) has no
  // known unit - refuse loudly rather than emit colliding bindings.
  const leftover = out.match(/uniform\s+(?:highp\s+)?sampler2D\s+(\w+)/);
  if (leftover) {
    throw new Error(`sampler '${leftover[1]}' has no reflected unit - declare it via #pragma param`);
  }

  // Functions taking sampler2D parameters: split the param into a pair and
  // remember which argument positions carry samplers, so call sites can pass
  // both halves (constructors are not legal as call arguments).
  const samplerFns = new Map();  // fname → [param indices]
  out = out.replace(/\b(\w+)\s*\(([^()]*\bsampler2D\b[^()]*)\)/g, (m, fname, params) => {
    if (fname === 'sampler2D') return m;
    const parts = params.split(',');
    const positions = [];
    const rewritten = parts.map((p, i) => {
      const pm = p.match(/^(\s*)(?:in\s+)?(?:highp\s+)?sampler2D\s+(\w+)\s*$/);
      if (!pm) return p;
      positions.push(i);
      combined.add(pm[2]);
      return `${pm[1]}in highp texture2D ${pm[2]}_est, in highp sampler ${pm[2]}_ess`;
    });
    samplerFns.set(fname, positions);
    return `${fname}(${rewritten.join(',')})`;
  });

  // Call sites of those functions: split each sampler-position argument (a
  // combined name after the rewrites above) into its two halves.
  for (const [fname, positions] of samplerFns) {
    out = rewriteCalls(out, fname, (args) => {
      for (const i of positions) {
        const name = (args[i] ?? '').trim();
        if (combined.has(name)) args[i] = ` ${name}_est, ${name}_ess`;
      }
      return args;
    });
  }

  // Sampling builtins: the constructor at point of use (the one legal form).
  const builtins = 'texture|textureLod|textureProj|textureGrad|textureOffset|texelFetch|textureSize';
  for (const name of combined) {
    out = out.replace(
      new RegExp(`\\b(${builtins})\\s*\\(\\s*${name}\\s*,`, 'g'),
      (m, fn) => `${fn}(sampler2D(${name}_est, ${name}_ess),`,
    );
  }

  return out;
}

/**
 * Rewrite every call of @p fname (skipping its definition, which was already
 * rewritten) by mapping its paren-balanced argument list through @p mapArgs.
 */
function rewriteCalls(src, fname, mapArgs) {
  const re = new RegExp(`\\b${fname}\\s*\\(`, 'g');
  let result = '';
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    // Find the balanced closing paren.
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const inner = src.slice(open + 1, i - 1);
    // A definition/prototype (already handled) declares types - skip anything
    // whose argument list still contains a type keyword pair pattern.
    if (/\b(?:in|out|inout)\s+\w|texture2D\s+\w|sampler\s+\w/.test(inner)) {
      result += src.slice(last, i);
      last = i;
      continue;
    }
    // Split top-level commas.
    const args = [];
    let depth2 = 0;
    let start = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === '(') depth2++;
      else if (inner[k] === ')') depth2--;
      else if (inner[k] === ',' && depth2 === 0) {
        args.push(inner.slice(start, k));
        start = k + 1;
      }
    }
    args.push(inner.slice(start));
    result += src.slice(last, m.index) + `${fname}(${mapArgs(args).join(',')})`;
    last = i;
  }
  return result + src.slice(last);
}

const VARYING_DECL = /^([ \t]*)(flat\s+)?(out|in)\s+((?:highp\s+)?(?:float|int|uint|[iu]?vec[234]|mat[234]))\s+(\w+)\s*;/gm;

/**
 * Whether the text at an offset is live under the permutation being translated, given the toggles it switches on. Only `#ifdef` / `#ifndef` / `#else` / `#endif` are
 * read, and a name that is not one of the permutation's own is undefined, as it is to glslang later: the engine's fragment prelude declares a varying inside an
 * `#ifdef` for a vertex stage that may not write it, and a declaration that conditional is not a varying of this program. A conditional it cannot read counts as live.
 */
export function liveAt(src, defined) {
  const edges = [];   // [offset, live] from each directive on, in order
  const stack = [];
  let live = true;
  let offset = 0;
  for (const line of src.split('\n')) {
    const m = /^\s*#\s*(ifdef|ifndef|else|endif)\b\s*(\w+)?/.exec(line);
    if (m) {
      if (m[1] === 'ifdef' || m[1] === 'ifndef') {
        stack.push({ outer: live, cond: m[1] === 'ifdef' ? defined.has(m[2]) : !defined.has(m[2]) });
        live = stack[stack.length - 1].outer && stack[stack.length - 1].cond;
      } else if (m[1] === 'else' && stack.length > 0) {
        const top = stack[stack.length - 1];
        live = top.outer && !top.cond;
      } else if (m[1] === 'endif' && stack.length > 0) {
        live = stack.pop().outer;
      }
      edges.push([offset + line.length + 1, live]);
    }
    offset += line.length + 1;
  }
  return (at) => {
    let state = true;
    for (const [from, value] of edges) { if (from > at) break; state = value; }
    return state;
  };
}

/**
 * Assign explicit, name-stable varying locations across both stages: glslang's
 * --auto-map-locations numbers each stage independently by declaration order,
 * which silently mismatches when the fragment lists varyings in another order.
 */
function assignVaryingLocations(vert, frag, defined = new Set()) {
  const order = [];
  const vertLive = liveAt(vert, defined);
  const vertOut = vert.replace(VARYING_DECL, (m, ws, flat, dir, type, name, at) => {
    if (dir !== 'out' || !vertLive(at)) return m;
    order.push(name);
    return `${ws}layout(location = ${order.length - 1}) ${flat ?? ''}out ${type} ${name};`;
  });
  return { vert: vertOut, frag: locateFragmentVaryings(frag, new Map(order.map((n, i) => [n, i])), defined) };
}

/** The locations of the engine's WGSL varying struct, by name. */
export function varyingLocations(struct) {
  return new Map([...struct.matchAll(/@location\((\d+)\)\s*(?:@interpolate\([^)]*\)\s*)?(\w+)\s*:/g)]
    .map((m) => [m[2], Number(m[1])]));
}

function locateFragmentVaryings(frag, locations, defined = new Set()) {
  const fragLive = liveAt(frag, defined);
  const fragIn = frag.replace(VARYING_DECL, (m, ws, flat, dir, type, name, at) => {
    if (dir !== 'in' || !fragLive(at)) return m;
    const loc = locations.get(name);
    if (loc === undefined) throw new Error(`fragment varying '${name}' has no matching vertex output`);
    return `${ws}layout(location = ${loc}) ${flat ?? ''}in ${type} ${name};`;
  });
  // Fragment outputs: sequential locations (single fragColor = location 0).
  let fragLoc = 0;
  return fragIn.replace(VARYING_DECL, (m, ws, flat, dir, type, name) => {
    if (dir !== 'out') return m;
    return `${ws}layout(location = ${fragLoc++}) ${flat ?? ''}out ${type} ${name};`;
  });
}

/** GLSL (adapted) → WGSL via the vendored glslang + naga wasm, renaming the entry. */
async function glslToWgsl(glsl, stage, entryName, workDir) {
  const spv = path.join(workDir, `stage.${stage}.spv`);
  const wgsl = path.join(workDir, `stage.${stage}.wgsl`);
  await writeFile(spv, await glslToSpv(glsl, stage));
  await spvFileToWgsl(spv, wgsl);
  const text = await readFile(wgsl, 'utf8');
  // naga emits `fn main(` as the entry (the inner body lands in main_1) - the
  // engine's twin contract names entries vs_main/fs_main.
  return text.replace(/\bfn main\(/, `fn ${entryName}(`);
}

/** The authored GLSL vertex hook of a shader (its `#pragma vertexoffset` section), or null. */
function glslHookOf(source) {
  const m = /#pragma vertexoffset[ \t]*\r?\n([\s\S]*?)#pragma end/.exec(source);
  return m ? m[1] : null;
}

/** Whether the shader carries a hook twin written by hand: such a twin is authored, and is not replaced. */
function hasAuthoredHookTwin(source) {
  return /#pragma vertexoffset wgsl\r?\n(?!\/\/ GENERATED)/.test(source);
}

/**
 * One permutation of a shader's vertex hook as WGSL: the hook is compiled as a vertex program of its own (the material's block, the vertex inputs, a
 * `main` that calls it), and what the engine's vertex stage needs of the result is taken out of it. Null when the hook reads a texture, which
 * the engine's stage binds on units a program of this size does not know.
 */
async function translateHook(hookGlsl, materialBlock, on, textures, workDir) {
  if (textures.some((t) => new RegExp(`\\b${t.name ?? t}\\b`).test(hookGlsl))) return null;
  const defines = on.map((n) => `#define ${n}`).join('\n');
  const glsl = adaptGlsl([
    '#version 300 es',
    defines,
    'layout(std140) uniform TimeConstants { highp vec4 u_time; highp vec4 u_viewport; };',
    materialBlock,
    'layout(location = 0) in vec3 a_position;',
    'layout(location = 1) in vec3 a_normal;',
    'layout(location = 2) in vec2 a_texCoord;',
    'highp vec4 es_vertexColor;',
    hookGlsl,
    'void main() {',
    '  vec3 l = a_position; vec3 n = a_normal;',
    '  es_vertexColor = vec4(1.0);',
    '  esMaterialVertex(l, n, a_texCoord);',
    '  gl_Position = vec4(l + n * 0.0, 1.0);',
    '}',
  ].join('\n'), []);
  const spv = path.join(workDir, 'hook.spv');
  const wgslFile = path.join(workDir, 'hook.wgsl');
  await writeFile(spv, await glslToSpv(glsl, 'vert'));
  await spvFileToWgsl(spv, wgslFile);
  const text = await readFile(wgslFile, 'utf8');
  // Everything but what the engine's stage declares itself: the material block (it is `mc`), the stage's inputs and outputs, and `main`.
  const uniformNames = new Map([...text.matchAll(/var<uniform> (\w+): (\w+);/g)].map((m) => [m[1], { MaterialConstants: 'mc', TimeConstants: 'tc' }[m[2]] ?? m[1]]));
  const keep = [];
  const blocks = text.split(/\n(?=fn |struct |var<|const |@group)/);
  let entryName = null;
  for (const block of blocks) {
    const fn = /^fn (\w+)\(/.exec(block);
    if (fn) {
      if (fn[1] === 'main_1' || fn[1] === 'main') continue;
      if (fn[1].startsWith('esMaterialVertex_u0028_')) { entryName = fn[1]; }
      keep.push(block);
      continue;
    }
    if (/^struct (MaterialConstants|TimeConstants|gl_PerVertex)\b/.test(block)) continue;
    if (/^@group\(\d+\)/.test(block)) continue;
    if (/^var<uniform>/.test(block)) continue;
    if (/^var<private> (a_position_1|a_normal_1|a_texCoord_1|es_vertexColor\w*)\b/.test(block) || /^var<private> unnamed_\d+: gl_PerVertex/.test(block)) continue;
    keep.push(block);
  }
  if (!entryName) throw new Error('the translated hook has no esMaterialVertex');
  let body = keep.join('\n');
  for (const [from, to] of uniformNames) body = body.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  body = body
    // naga hands every function parameter over as a pointer, and the engine's stage hands the hook its uv by value.
    .replace(new RegExp(`\\b${entryName}\\b`, 'g'), 'esMaterialVertexBody')
    .replace(/\bes_vertexColor_1\b/g, 'es_vertexColor');
  return `${body.trimEnd()}\n\nfn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {\n    var uvArg = uv;\n    esMaterialVertexBody(local, localNormal, &uvArg);\n}`;
}

/** Strip previously generated `wgsl full` sections (for --force / stale regen). */
function stripGeneratedTwins(source) {
  return source
    .replace(/\n?#pragma (?:vertex|fragment) wgsl full\n[\s\S]*?#pragma end\n?/g, '\n')
    .replace(/\n?#pragma vertexoffset wgsl\n\/\/ GENERATED[\s\S]*?#pragma end\n?/g, '\n');
}

/** Hash of a shader's AUTHORED content — everything but the generated twins, i.e.
 *  what changes when someone edits the GLSL. Stored in the generated banner so a
 *  stale twin (GLSL changed, twin not regenerated) is detectable without running
 *  the converter toolchain. */
export function sourceHash(source) {
  // trim(): stripping the twin leaves trailing newlines, and the writer trimEnds
  // before appending — normalize both so generate-then-check round-trips exactly.
  return createHash('sha256').update(stripGeneratedTwins(source).trim()).digest('hex').slice(0, 16);
}

/** Whether `source` needs a (re)generated WGSL twin: it has no twin, or its
 *  GENERATED twin's stored source-hash no longer matches the authored GLSL
 *  (stale). A hand-authored `wgsl` twin (builtins) is left alone — it is
 *  authored, not derived. Pure + cheap (no engine), so the editor's on-open scan
 *  and CI --check share one definition of "stale". */
export function needsTwin(source) {
  if (isAuthoredTwin(source)) return false;
  if (/#pragma (?:vertex|fragment) wgsl[ \t]+full\b/.test(source)) {
    const m = source.match(STORED_HASH_RE);
    return !m || m[1] !== sourceHash(source);
  }
  return true;
}

/** A twin written by hand (the builtins) is authored, not derived: no hash of
 *  ours describes it and nothing here may replace it. */
function isAuthoredTwin(source) {
  return /#pragma (?:vertex|fragment) wgsl(?![ \t]+full)/.test(source)
    && !/#pragma (?:vertex|fragment) wgsl[ \t]+full\b/.test(source);
}

/** Hash of the GLSL the twin is a TRANSLATION of: authored stages with the
 *  engine's injected header in place. `sourceHash` moves when the shader is
 *  edited, this also when the ENGINE's blocks move — a Light2D that grew a fifth
 *  vec4 left every twin reading LightConstants at the old stride. */
function assembledHash(info) {
  return createHash('sha256').update(`${info.vertGlsl}\n${info.fragGlsl}`).digest('hex').slice(0, 16);
}

/** Load the engine wasm module (esshader_cookInfo) the twin pipeline assembles
 *  through — shared by the CLI and the editor's on-open generation. */
export async function loadTwinModule() {
  const { default: createModule } = await import(pathToFileURL(WASM_GLUE).href);
  return createModule();
}

/** An emscripten val array as a JS array of strings. */
function valStrings(v) {
  const out = [];
  for (let i = 0; i < (v?.length ?? 0); i++) out.push(v[i]);
  return out;
}

/**
 * How many toggles a twin may carry. Each one doubles the emitted programs, and
 * WGSL has no preprocessor to share between them — at four the body is sixteen
 * copies of the shader, which is a size nobody asked for silently.
 */
const MAX_TOGGLES = 3;

/** Every on/off combination of `toggles`, as arrays of the ones that are ON. */
export function permutationsOf(toggles) {
  const out = [];
  for (let mask = 0; mask < (1 << toggles.length); mask++) {
    out.push(toggles.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
}

const permutationKey = (on) => [...on].sort().join(',');

/**
 * One body carrying every permutation, selected by the same `#ifdef` the GLSL
 * side gets from real defines — `preprocessConditionals` resolves it at assembly, so
 * both targets see identical variant logic.
 */
export function composePermutations(toggles, bodies, remaining = toggles, on = []) {
  if (remaining.length === 0) return bodies.get(permutationKey(on)).trimEnd();
  const [head, ...rest] = remaining;
  const whenOn = composePermutations(toggles, bodies, rest, [...on, head]);
  const whenOff = composePermutations(toggles, bodies, rest, on);
  return `#ifdef ${head}\n${whenOn}\n#else\n${whenOff}\n#endif`;
}

/**
 * The file text with its WGSL twin derived from the authored GLSL, or a status saying why there is nothing to add. Pure in its inputs: it reads and
 * writes no file, so whatever serves a shader (the cook, a dev server, the editor) can ask for the same text the CLI would have written.
 */
export async function deriveTwin(module, original, opts = {}) {
  if (isAuthoredTwin(original)) return { status: 'has-twin' };
  // The twin is generated FROM the authored stages, so an old one is dropped
  // before anything is cooked — its hashes and its body are replaced together.
  let source = stripGeneratedTwins(original);

  const info = module.esshader_cookInfo(source, '');
  if (!info.valid) throw new Error(`parse failed: ${info.error}`);
  const assembled = assembledHash(info);
  // On the engine's vertex stage, the engine keeps that stage in every language: a
  // translated copy is frozen at the batch source and cannot follow a material to
  // a mesh. Only the fragment is generated, reading the engine's varying locations.
  const engineVertex = info.canonicalVaryings !== '';
  const staleVertex = engineVertex && /#pragma vertex wgsl full\b/.test(original);
  if (!opts.force && !needsTwin(original) && !staleVertex
      && original.match(STORED_ASSEMBLED_RE)?.[1] === assembled) {
    return { status: 'has-twin' };
  }

  // A switch or a feature changes the assembled GLSL, so each combination is its
  // own program to translate.
  const toggles = [...valStrings(info.switches), ...valStrings(info.features)];
  if (toggles.length > MAX_TOGGLES) {
    return { status: `skipped-${toggles.length}-toggles` };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'esshader-twin-'));
  try {
    const vert = new Map();
    const frag = new Map();
    for (const on of permutationsOf(toggles)) {
      const key = permutationKey(on);
      const cooked = toggles.length === 0 ? info : module.esshader_cookInfo(source, key);
      if (!cooked.valid) throw new Error(`parse failed for [${key}]: ${cooked.error}`);
      const textures = [];
      for (let i = 0; i < cooked.textures.length; i++) textures.push(cooked.textures[i]);
      // The stage tag is what glslang reads the shader stage from; the
      // permutations reuse it in turn rather than each taking a name of its own.
      if (engineVertex) {
        const located = locateFragmentVaryings(
          adaptGlsl(cooked.fragGlsl, textures), varyingLocations(info.canonicalVaryings), new Set(on));
        frag.set(key, await glslToWgsl(located, 'frag', 'fs_main', workDir));
        continue;
      }
      const adapted = assignVaryingLocations(
        adaptGlsl(cooked.vertGlsl, textures),
        adaptGlsl(cooked.fragGlsl, textures),
        new Set(on),
      );
      vert.set(key, await glslToWgsl(adapted.vert, 'vert', 'vs_main', workDir));
      frag.set(key, await glslToWgsl(adapted.frag, 'frag', 'fs_main', workDir));
    }

    const banner = bannerFor(sourceHash(source), assembled);
    // A vertex hook is translated beside the stages, unless one was written by hand or it reads a texture.
    let hookTwin = '';
    const hookGlsl = glslHookOf(source);
    if (hookGlsl !== null && !hasAuthoredHookTwin(source)) {
      const block = (/layout\s*\(\s*std140\s*\)\s*uniform\s+MaterialConstants\s*\{[\s\S]*?\}\s*;/.exec(info.vertGlsl) ?? [''])[0];
      const hooks = new Map();
      let translatable = true;
      for (const on of permutationsOf(toggles)) {
        const cooked = toggles.length === 0 ? info : module.esshader_cookInfo(source, permutationKey(on));
        const textures = [];
        for (let i = 0; i < cooked.textures.length; i++) textures.push(cooked.textures[i]);
        const text = await translateHook(hookGlsl, block, on, textures, workDir);
        if (text === null) { translatable = false; break; }
        hooks.set(permutationKey(on), text);
      }
      if (translatable) hookTwin = `\n#pragma vertexoffset wgsl\n${banner}\n${composePermutations(toggles, hooks)}\n#pragma end\n`;
    }
    const fragBody = composePermutations(toggles, frag);
    const twin =
      (engineVertex ? '' : `\n#pragma vertex wgsl full\n${banner}\n${composePermutations(toggles, vert)}\n#pragma end\n`) +
      `\n#pragma fragment wgsl full\n${banner}\n${fragBody}\n#pragma end\n` + hookTwin;

    return { status: 'generated', text: source.trimEnd() + '\n' + twin };
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

/** `source` with a fresh generated twin when it needs one; `source` itself when it has one, wants none, or cannot be translated (the caller sees the throw). */
export async function withGeneratedTwin(module, source) {
  const r = await deriveTwin(module, source, {});
  return r.status === 'generated' ? r.text : source;
}

export async function processFile(module, file, opts) {
  const original = await readFile(file, 'utf8');
  // A source that derives its twin (the repo's own examples and fixtures) carries none: a committed one is what made every engine header edit a
  // diff across dozens of files. It must still TRANSLATE, which is what deriving it here proves. A file that keeps a hand-written twin beside a
  // generated one has nothing to derive once the generated one is gone, so it is left as it is.
  if (opts.derived || opts.strip) {
    const committed = /#pragma (?:vertex|fragment) wgsl[ \t]+full\b/.test(original);
    const bare = committed ? stripGeneratedTwins(original).trimEnd() + '\n' : original;
    const d = await deriveTwin(module, bare, {});
    if (d.status !== 'generated') {
      // A hand-written twin beside a generated one: the generated one stays, so it has to be current like any committed twin.
      const kept = committed ? await deriveTwin(module, original, {}) : d;
      return { file, status: kept.status === 'generated' ? 'would-generate' : kept.status };
    }
    if (opts.strip && committed) {
      await writeFile(file, bare, 'utf8');
      return { file, status: 'stripped' };
    }
    return { file, status: committed ? 'committed-twin' : 'derivable' };
  }
  const r = await deriveTwin(module, original, opts);
  if (r.status !== 'generated') return { file, status: r.status };
  if (opts.check) return { file, status: 'would-generate' };
  await writeFile(file, r.text, 'utf8');
  return { file, status: 'generated' };
}

/** Every .esshader under a directory, or the file itself. A caller that had to
 *  list them needed a shell to do it, and `find` on Windows is a text search that
 *  answers "File not found" and exits 0 -- so the gate ran on an empty list. */
async function expand(arg) {
  if (!(await stat(arg)).isDirectory()) return [arg];
  const out = [];
  for (const e of await readdir(arg, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith('.esshader')) out.push(path.join(e.parentPath ?? e.path, e.name));
  }
  return out.sort();
}

async function main() {
  const args = process.argv.slice(2);
  const opts = { check: args.includes('--check'), force: args.includes('--force'), derived: args.includes('--derived'), strip: args.includes('--strip') };
  const roots = args.filter((a) => !a.startsWith('--'));
  if (roots.length === 0) {
    console.error('usage: node tools/gen-shader-twins.mjs [--check] [--force] <file.esshader | dir ...>');
    process.exit(2);
  }
  const files = (await Promise.all(roots.map(expand))).flat();
  if (files.length === 0) {
    console.error(`gen-shader-twins: no .esshader under ${roots.join(', ')}`);
    process.exit(2);
  }

  const module = await loadTwinModule();

  let pending = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const r = await processFile(module, file, opts);
      console.log(`[twin] ${r.status}: ${file}`);
      if (r.status === 'would-generate' || r.status === 'committed-twin') pending++;
    } catch (e) {
      failed++;
      console.error(`[twin] FAIL: ${file}\n  ${e.message.replace(/\n/g, '\n  ')}`);
    }
  }
  // Graceful exit (exitCode, not process.exit): a hard exit races the live
  // emscripten runtimes' teardown on Windows (STATUS_STACK_BUFFER_OVERRUN).
  process.exitCode = failed > 0 || pending > 0 ? 1 : 0;
}

// Run as a CLI only when invoked directly (`node tools/gen-shader-twins.mjs …`);
// stays importable as a module (the editor's on-open twin generation).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
