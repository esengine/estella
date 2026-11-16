// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a shader's own GLSL can name that it does not declare, read from the engine itself: the GLSL header the engine
 *        assembles in front of it (its functions, structs and uniform blocks) and the WGSL header it injects in front of a twin
 *        (where each of those lives on that side). Nothing here is a hand-kept list of the engine's names, so a header that grows
 *        a function or moves a field is read as it now is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex, parse } from './parse.mjs';
import { liveAt } from '../gen-shader-twins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `text` with the lines `defined` turns off removed, and the directives with them. */
export function preprocess(text, defined) {
  const live = liveAt(text, defined);
  let offset = 0;
  const out = [];
  for (const line of text.split('\n')) {
    const directive = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif)\b/.test(line);
    if (!directive && live(offset)) out.push(line);
    offset += line.length + 1;
  }
  return out.join('\n');
}

let wgslHeaderCache = null;
/** The engine's WGSL headers, from ShaderParser.cpp: its functions (name -> parameter count), structs (name -> field names in order),
 *  uniform instances (struct -> instance name) and module-scope names. */
export function engineWgsl() {
  if (wgslHeaderCache) return wgslHeaderCache;
  const cpp = fs.readFileSync(path.join(ROOT, 'src/esengine/resource/ShaderParser.cpp'), 'utf8');
  // The WGSL lives in C++ string literals, raw and quoted: read both as text.
  const text = cpp.replace(/R"\(|\)"/g, '\n').replace(/"((?:[^"\\]|\\.)*)"/g, (_, s) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  const fns = new Map();
  for (const m of text.matchAll(/\bfn\s+(\w+)\s*\(([^)]*)\)/g)) {
    if (fns.has(m[1])) continue;
    const params = m[1] && m[2].trim() ? m[2].split(',').map((p) => p.trim()).filter(Boolean) : [];
    fns.set(m[1], { params: params.map((p) => ({ name: p.split(':')[0].trim(), type: p.split(':').slice(1).join(':').trim() })) });
  }
  const structs = new Map();
  for (const m of text.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    if (structs.has(m[1])) continue;
    structs.set(m[1], [...m[2].matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/g)].map((f) => f[1]));
  }
  const instances = new Map([...text.matchAll(/var<uniform>\s+(\w+)\s*:\s*(\w+)/g)].map((m) => [m[2], m[1]]));
  const privates = new Set([...text.matchAll(/var<private>\s+(\w+)/g)].map((m) => m[1]));
  const consts = new Set([...text.matchAll(/\bconst\s+(\w+)\s*[:=]/g)].map((m) => m[1]));
  wgslHeaderCache = { fns, structs, instances, privates, consts };
  return wgslHeaderCache;
}

/** The define sets a header is read under: what each engine variant may turn on, so a function behind any of them is seen. */
const READINGS = [
  new Set(),
  new Set(['MESH', 'MESH_NORMALS', 'LIT', 'ES_RECEIVE_SHADOW', 'ES_ENV_MAP', 'ES_SURFACE_3D', 'ES_LINEAR', 'ES_GBUFFER', 'MESH_TANGENTS', 'MESH_LIGHTMAP']),
  new Set(['SKINNED', 'MESH_NORMALS', 'LIT', 'ES_LIGHT_DIRECT', 'PARTICLE']),
];

/**
 * The environment of one shader: `assembled` is the engine's assembled GLSL for its fragment stage (esshader_cookInfo().fragGlsl),
 * `params` its `#pragma param` declarations, `varyings` the VSOut struct the engine hands its fragment (canonicalVaryings).
 */
export function shaderEnv({ assembled, params, varyings }) {
  const wgsl = engineWgsl();
  const structs = new Map();
  const fns = new Map();
  const globals = new Map();
  for (const defined of READINGS) {
    const tree = parse(lex(preprocess(assembled, defined)), new Set(), { signaturesOnly: true });
    for (const it of tree.items) {
      if (it.k === 'struct' && !structs.has(it.name)) structs.set(it.name, it.fields);
      if ((it.k === 'proto' || it.k === 'fn') && !fns.has(it.name)) fns.set(it.name, { ret: it.ret.type, params: it.params });
      if (it.k === 'block') {
        const inst = it.name === 'MaterialConstants' ? 'mc' : wgsl.instances.get(it.name);
        const wFields = wgsl.structs.get(it.name);
        it.fields.forEach((f, idx) => {
          if (globals.has(f.name)) return;
          // Paired by position: the two sides lay the block out alike, and only some fields are renamed (u_camera -> camera).
          const wName = it.name === 'MaterialConstants' ? f.name : (wFields?.includes(f.name) ? f.name : wFields?.[idx]);
          globals.set(f.name, { type: f.type, array: f.array, wgsl: inst && wName ? `${inst}.${wName}` : null, from: it.name });
        });
      }
      if (it.k === 'var') {
        for (const d of it.decls) {
          if (globals.has(d.name)) continue;
          const q = it.spec.quals;
          if (q.includes('uniform') && /^sampler/.test(it.spec.type)) globals.set(d.name, { type: it.spec.type, array: d.array, sampler: true, wgsl: d.name });
          else if (q.includes('const') || q.length === 0) {
            const known = wgsl.privates.has(d.name) || wgsl.consts.has(d.name);
            globals.set(d.name, { type: it.spec.type, array: d.array, wgsl: known ? d.name : null });
          }
        }
      }
    }
  }
  const varyingFields = new Map([...varyings.matchAll(/(?:@[\w]+(?:\([^)]*\))?\s*)*(\w+)\s*:\s*([\w<>]+)\s*,/g)].map((m) => [m[1], m[2]]));
  return { structs, fns, globals, params, varyings: varyingFields, wgsl };
}

/** `#pragma param <name> <type> ...` lines: name -> { type } (texture params are samplers). */
export function pragmaParams(source) {
  const out = new Map();
  for (const m of source.matchAll(/^#pragma param\s+(\w+)\s+(\w+)/gm)) out.set(m[1], { type: m[2] });
  return out;
}
