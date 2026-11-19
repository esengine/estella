// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * gen-shader-api — what a shader's own GLSL can name of the engine's, per domain, as the WGSL transpiler reads it.
 *
 * Read from the engine itself (esshader_cookInfo, and the WGSL in ShaderParser.cpp) into sdk/src/shaders/wgsl/engineApi.generated.ts.
 *
 *   node tools/gen-shader-api.mjs           write the table
 *   node tools/gen-shader-api.mjs --check   fail if it is stale (needs a built engine, as gen-shader-twins does)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTwinModule, liveAt } from './gen-shader-twins.mjs';
import { importSdkSource } from './lib/sdkSource.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'sdk/src/shaders/wgsl/engineApi.generated.ts');

const DOMAINS = ['Lit', 'Unlit', 'PostProcess'];
/** The define sets a header is read under: every variant the engine assembles, so a function behind any of them is seen. */
const READINGS = [
  [],
  ['MESH', 'MESH_NORMALS', 'LIT', 'ES_RECEIVE_SHADOW', 'ES_ENV_MAP', 'ES_SURFACE_3D', 'ES_LINEAR', 'ES_GBUFFER', 'MESH_TANGENTS', 'MESH_LIGHTMAP'],
  ['SKINNED', 'MESH_NORMALS', 'LIT', 'ES_LIGHT_DIRECT', 'PARTICLE'],
  // A resident 3D surface that reads no bake: the only variant that declares the probe atlas and reads it per pixel.
  ['MESH', 'MESH_NORMALS', 'LIT', 'ES_RECEIVE_SHADOW', 'ES_SURFACE_3D'],
];

function preprocess(text, defined) {
  const live = liveAt(text, new Set(defined));
  let offset = 0;
  const out = [];
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b/.test(line) && live(offset)) out.push(line);
    offset += line.length + 1;
  }
  return out.join('\n');
}

const arraySize = (a) => (a ? (a.k === 'num' ? Number(a.v) : 0) : null);

/** The engine's WGSL, from the string literals in ShaderParser.cpp. */
function wgslHeader() {
  const cpp = fs.readFileSync(path.join(ROOT, 'src/esengine/resource/ShaderParser.cpp'), 'utf8');
  const text = cpp.replace(/R"\(|\)"/g, '\n').replace(/"((?:[^"\\]|\\.)*)"/g, (_, s) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  const fns = {};
  const returns = {};
  for (const m of text.matchAll(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?/g)) {
    if (m[1] in fns) continue;
    fns[m[1]] = m[2].split(',').map((p) => p.trim()).filter(Boolean).length;
    if (m[3]) returns[m[1]] = m[3];
  }
  const structs = {};
  for (const m of text.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (!(m[1] in structs)) structs[m[1]] = [...m[2].matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/g)].map((f) => f[1]);
  }
  const instances = Object.fromEntries([...text.matchAll(/var<uniform>\s+(\w+)\s*:\s*(\w+)/g)].map((m) => [m[2], m[1]]));
  const names = [...new Set([...text.matchAll(/var<private>\s+(\w+)|\bconst\s+(\w+)\s*[:=]/g)].map((m) => m[1] ?? m[2]))].sort();
  // A function that returns a struct: its fields, which a GLSL function's out parameters of the same names are read from.
  const returnFields = Object.fromEntries(Object.entries(returns).filter(([, t]) => t in structs).map(([n, t]) => [n, structs[t]]));
  return { fns, structs, instances, names, returnFields };
}

/**
 * The units the engine binds its own samplers to, by GLSL name: a WGSL twin names a texture by its unit (`t2`, `s2`), so the name a
 * shader's GLSL reads is its unit. Read from where the engine binds them — EngineTextureUnits.hpp (every domain) and the fullscreen
 * pass's own bindings in PostProcessPipeline.cpp — never listed here.
 */
function engineSamplerUnits() {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const units = read('src/esengine/renderer/store/EngineTextureUnits.hpp');
  const consts = { ...Object.fromEntries([...units.matchAll(/constexpr\s+u32\s+(\w+)\s*=\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])),
    ...Object.fromEntries([...read('src/esengine/renderer/store/MaterialConstants.hpp').matchAll(/constexpr\s+u32\s+(\w+)\s*=\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])) };
  const all = {};
  for (const m of units.matchAll(/constexpr\s+const\s+char\*\s+(\w+)_SAMPLER\s*=\s*"(\w+)"/g)) {
    const unit = consts[`${m[1]}_TEXTURE_UNIT`];
    if (unit !== undefined) all[m[2]] = [unit, 'color'];
  }
  const post = { ...all };
  for (const m of read('src/esengine/renderer/frame/PostProcessPipeline.cpp').matchAll(/setUniform\("(u_\w+)",\s*(?:static_cast<i32>\()?(\w+)\)?\)/g)) {
    const unit = /^\d+$/.test(m[2]) ? Number(m[2]) : consts[m[2]];
    if (unit === undefined) continue;
    // The scene's depth is a depth texture: no sampler under it, read by texel (see wgslBatchTextureDecls).
    post[m[1]] = [unit, m[2] === 'kSceneDepthUnit' ? 'depth' : 'color'];
  }
  return { all, post };
}

/** The VSOut a fullscreen pass hands its fragment, from wgslPPVSOut in ShaderParser.cpp. */
function postProcessVaryings() {
  const cpp = fs.readFileSync(path.join(ROOT, 'src/esengine/resource/ShaderParser.cpp'), 'utf8');
  const body = /std::string wgslPPVSOut\(\)\s*\{([\s\S]*?)\n\}/.exec(cpp)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:\s*([\w<>]+)\s*,/g)].map((m) => [m[1], m[2]]));
}

const FRAGMENT_HEADERS = { Lit: ['kLitHeaderWGSL'], Unlit: [], PostProcess: [] };

function handoffs(domain, canonicalVaryings) {
  const cpp = fs.readFileSync(path.join(ROOT, 'src/esengine/resource/ShaderParser.cpp'), 'utf8');
  const privates = new Set(FRAGMENT_HEADERS[domain].flatMap((name) => {
    const body = new RegExp(`const char\\*\\s+${name}\\s*=\\s*R"\\(([\\s\\S]*?)\\)";`).exec(cpp)?.[1];
    if (body === undefined) throw new Error(`gen-shader-api: ${name} is not in ShaderParser.cpp`);
    return [...body.matchAll(/var<private>\s+g_(\w+)/g)].map((m) => m[1]);
  }));
  const out = {};
  const guards = [];
  for (const line of canonicalVaryings.split('\n')) {
    const open = /^\s*#\s*ifdef\s+(\w+)/.exec(line);
    if (open) { guards.push(open[1]); continue; }
    if (/^\s*#\s*if/.test(line)) { guards.push(null); continue; }
    if (/^\s*#\s*endif/.test(line)) { guards.pop(); continue; }
    const field = /(?:@[\w]+(?:\([^)]*\))?\s*)*v_(\w+)\s*:/.exec(line);
    if (!field || !privates.has(field[1])) continue;
    if (guards.length > 1 || guards[0] === null) throw new Error(`gen-shader-api: v_${field[1]} is declared under a condition the hand-off cannot repeat`);
    out[`g_${field[1]}`] = [`v_${field[1]}`, guards[0] ?? null];
  }
  return out;
}

function domainApi(mod, domain, wgsl, { lex, parse }) {
  // A fullscreen pass that asks for the lights (`#pragma lights`) is given the light header too: the table holds both.
  const probes = [''].concat(domain === 'PostProcess' ? ['#pragma lights\n'] : []).map((extra) =>
    `#pragma shader "Probe"\n#pragma version 300 es\n#pragma domain ${domain}\n${extra}#pragma fragment\nprecision highp float;\nin vec2 v_texCoord;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n`);
  const infos = probes.map((p) => mod.esshader_cookInfo(p, ''));
  for (const info of infos) if (!info.valid) throw new Error(`${domain}: ${info.error}`);
  const info = infos[0];
  // A material's vertex hook is assembled into the engine's vertex stage, which has helpers of its own (the per-object records the
  // hook names as esInstance*, given only to a stage that names them): read from a probe whose hook names them.
  const stages = infos.map((inf) => inf.fragGlsl);
  if (domain !== 'PostProcess') {
    const hooked = mod.esshader_cookInfo(probes[0].replace('#pragma fragment',
      '#pragma vertexoffset\n// esInstance\nvoid esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {}\n#pragma end\n#pragma fragment'), '');
    if (!hooked.valid) throw new Error(`${domain} vertex probe: ${hooked.error}`);
    stages.push(hooked.vertGlsl);
  }
  const fns = {}, structs = {}, globals = {};
  for (const [defined, glsl] of stages.flatMap((g) => READINGS.map((d) => [d, g]))) {
    const tree = parse(lex(preprocess(glsl, defined)), [], { signaturesOnly: true });
    for (const it of tree.items) {
      if (it.k === 'struct' && !(it.name in structs)) structs[it.name] = it.fields.map((f) => [f.name, f.type, arraySize(f.array)]);
      if ((it.k === 'proto' || it.k === 'fn') && !(it.name in fns) && it.name !== 'main') {
        fns[it.name] = [it.ret.type, it.params.filter((p) => p.name).map((p) => [p.type, p.quals.includes('inout') ? 'inout' : p.quals.includes('out') ? 'out' : 'in', arraySize(p.array), p.name])];
      }
      if (it.k === 'block' && it.name !== 'MaterialConstants') {
        const inst = wgsl.instances[it.name];
        const fields = wgsl.structs[it.name] ?? [];
        it.fields.forEach((f, i) => {
          if (f.name in globals) return;
          // Paired by position: both sides lay a block out alike, and only some fields are renamed (u_camera -> camera).
          const w = fields.includes(f.name) ? f.name : fields[i];
          if (inst && w) globals[f.name] = [f.type, arraySize(f.array), `${inst}.${w}`];
        });
      }
      if (it.k === 'var') {
        for (const d of it.decls) {
          if (d.name in globals) continue;
          const q = it.spec.quals;
          if (q.includes('uniform') && /^sampler/.test(it.spec.type)) globals[d.name] = [it.spec.type, arraySize(d.array), null];
          else if ((q.includes('const') || q.length === 0) && wgsl.names.includes(d.name)) globals[d.name] = [it.spec.type, arraySize(d.array), d.name];
        }
      }
    }
  }
  const varyings = domain === 'PostProcess'
    ? postProcessVaryings()
    : Object.fromEntries([...info.canonicalVaryings.matchAll(/(?:@[\w]+(?:\([^)]*\))?\s*)*(\w+)\s*:\s*([\w<>]+)\s*,/g)].map((m) => [m[1], m[2]]));
  // Only what the WGSL side has a counterpart for can be called from a twin.
  for (const n of Object.keys(fns)) if (!(n in wgsl.fns)) delete fns[n];
  const units = engineSamplerUnits();
  const samplers = domain === 'PostProcess' ? units.post : units.all;
  // A sampler is the engine's by its unit, not a global with a WGSL name.
  for (const n of Object.keys(samplers)) delete globals[n];
  return { fns, structs, globals, varyings, samplers, handoffs: domain === 'PostProcess' ? {} : handoffs(domain, info.canonicalVaryings) };
}

const { lex, parse } = await importSdkSource('shaders/wgsl/parse.ts');
const mod = await loadTwinModule();
const wgsl = wgslHeader();
const api = { wgslArity: wgsl.fns, wgslReturnFields: wgsl.returnFields, domains: Object.fromEntries(DOMAINS.map((d) => [d, domainApi(mod, d, wgsl, { lex, parse })])) };
const text = `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// GENERATED by tools/gen-shader-api.mjs from the engine's shader headers — do not edit. Regenerate after changing ShaderParser.cpp.
/* eslint-disable */
import type { EngineShaderApi } from './api';

export const ENGINE_SHADER_API: EngineShaderApi = ${JSON.stringify(api)};
`;
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== text) {
    console.error('gen-shader-api: sdk/src/shaders/wgsl/engineApi.generated.ts is stale — run node tools/gen-shader-api.mjs');
    process.exit(1);
  }
  console.log('gen-shader-api: current.');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  const sizes = Object.entries(api.domains).map(([d, a]) => `${d}: ${Object.keys(a.fns).length} fns, ${Object.keys(a.globals).length} globals`).join('; ');
  console.log(`gen-shader-api: wrote ${path.relative(ROOT, OUT)} (${(text.length / 1024).toFixed(1)} KB) — ${sizes}`);
}
