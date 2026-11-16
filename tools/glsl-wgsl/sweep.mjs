// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Dev driver: transpile shaders from a JSON map (name -> .esshader text) and compare with their hand-written twins.
//   node tools/glsl-wgsl/sweep.mjs <shaders.json> [outDir] [only]
import fs from 'node:fs';
import path from 'node:path';
import { loadTwinModule } from '../gen-shader-twins.mjs';
import { shaderEnv, pragmaParams } from './env.mjs';
import { transpileFragment } from './emit.mjs';

const [file, outDir, only] = process.argv.slice(2);
const shaders = JSON.parse(fs.readFileSync(file, 'utf8'));
const mod = await loadTwinModule();
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();
let ok = 0, hand = 0, gen = 0;
const rows = [];
for (const [name, src] of Object.entries(shaders)) {
  if (only && !only.split(',').includes(name)) continue;
  const handFrag = (src.match(/^#pragma fragment wgsl[^\n]*\n([\s\S]*?)^#pragma end/m) || [])[1] ?? '';
  const bare = src.replace(/^#pragma (vertex|fragment|vertexoffset) wgsl[^\n]*\n[\s\S]*?^#pragma end[^\n]*\n?/gm, '');
  try {
    const info = mod.esshader_cookInfo(bare, '');
    const env = shaderEnv({ assembled: info.fragGlsl, params: pragmaParams(bare), varyings: info.canonicalVaryings });
    const wgsl = transpileFragment({ source: bare, env });
    ok++;
    hand += strip(handFrag).length; gen += strip(wgsl).length;
    rows.push(`ok   ${name.padEnd(16)} hand ${String(strip(handFrag).length).padStart(6)}  generated ${String(strip(wgsl).length).padStart(6)}  ratio ${(strip(wgsl).length / Math.max(1, strip(handFrag).length)).toFixed(2)}`);
    if (outDir) fs.writeFileSync(path.join(outDir, `${name.replace(/\W/g, '_')}.wgsl`), wgsl);
  } catch (e) {
    rows.push(`FAIL ${name.padEnd(16)} ${String(e.message).split('\n')[0]}`);
  }
}
console.log(rows.join('\n'));
console.log(`${ok} of ${rows.length} | hand ${hand} generated ${gen} ratio ${(gen / Math.max(1, hand)).toFixed(2)}`);
