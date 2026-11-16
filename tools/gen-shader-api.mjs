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
  for (const m of text.matchAll(/\bfn\s+(\w+)\s*\(([^)]*)\)/g)) {
    if (m[1] in fns) continue;
    fns[m[1]] = m[2].split(',').map((p) => p.trim()).filter(Boolean).length;
  }
  const structs = {};
  for (const m of text.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (!(m[1] in structs)) structs[m[1]] = [...m[2].matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/g)].map((f) => f[1]);
  }
  const instances = Object.fromEntries([...text.matchAll(/var<uniform>\s+(\w+)\s*:\s*(\w+)/g)].map((m) => [m[2], m[1]]));
  const names = [...new Set([...text.matchAll(/var<private>\s+(\w+)|\bconst\s+(\w+)\s*[:=]/g)].map((m) => m[1] ?? m[2]))].sort();
  return { fns, structs, instances, names };
}

function domainApi(mod, domain, wgsl, { lex, parse }) {
  const probe = `#pragma shader "Probe"\n#pragma version 300 es\n#pragma domain ${domain}\n#pragma fragment\nprecision highp float;\nin vec2 v_texCoord;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n`;
  const info = mod.esshader_cookInfo(probe, '');
  if (!info.valid) throw new Error(`${domain}: ${info.error}`);
  const fns = {}, structs = {}, globals = {};
  for (const defined of READINGS) {
    const tree = parse(lex(preprocess(info.fragGlsl, defined)), [], { signaturesOnly: true });
    for (const it of tree.items) {
      if (it.k === 'struct' && !(it.name in structs)) structs[it.name] = it.fields.map((f) => [f.name, f.type, arraySize(f.array)]);
      if ((it.k === 'proto' || it.k === 'fn') && !(it.name in fns) && it.name !== 'main') {
        fns[it.name] = [it.ret.type, it.params.filter((p) => p.name).map((p) => [p.type, p.quals.includes('inout') ? 'inout' : p.quals.includes('out') ? 'out' : 'in', arraySize(p.array)])];
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
  const varyings = Object.fromEntries([...info.canonicalVaryings.matchAll(/(?:@[\w]+(?:\([^)]*\))?\s*)*(\w+)\s*:\s*([\w<>]+)\s*,/g)].map((m) => [m[1], m[2]]));
  // Only what the WGSL side has a counterpart for can be called from a twin.
  for (const n of Object.keys(fns)) if (!(n in wgsl.fns)) delete fns[n];
  return { fns, structs, globals, varyings };
}

const { lex, parse } = await importSdkSource('shaders/wgsl/parse.ts');
const mod = await loadTwinModule();
const wgsl = wgslHeader();
const api = { wgslArity: wgsl.fns, domains: Object.fromEntries(DOMAINS.map((d) => [d, domainApi(mod, d, wgsl, { lex, parse })])) };
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
