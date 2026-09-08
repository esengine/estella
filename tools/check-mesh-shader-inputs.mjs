// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mesh-shader-inputs.mjs — `meshShaderReads` says what the Mesh shader does.
 *
 * A mesh vertex layout binds the channels the file carries; `meshShaderReads`
 * decides which of them reach it. That predicate is a claim ABOUT the shader,
 * kept in a different file and a different language, and nothing else notices
 * when the two stop agreeing. Both directions are wrong in their own way:
 *
 *   the shader declares a channel the predicate excludes
 *       the attribute is never bound and the shader reads whatever the driver
 *       leaves there — a wrong frame with nothing naming the cause
 *   the predicate admits a channel no shader declares
 *       an attribute slot from sixteen and a fetch per vertex, spent on nothing,
 *       which is the entire reason the predicate exists
 *
 * The instance record (location >= MESH_INSTANCE_FIRST_LOCATION) is not a mesh
 * channel and is skipped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENUMS = path.join('src', 'esengine', 'renderer', 'rhi', 'GfxEnums.hpp');
const SHADERS = path.join('src', 'esengine', 'renderer', 'rhi', 'ShaderEmbeds.generated.hpp');

const enums = readFileSync(path.join(ROOT, ENUMS), 'utf8');
const shaders = readFileSync(path.join(ROOT, SHADERS), 'utf8');

const problems = [];

const channels = new Map();
const body = /enum class MeshChannel\s*:[^{]*\{([^}]*)\}/m.exec(enums);
for (const [, name, value] of (body?.[1] ?? '').matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*,?\s*$/gm)) {
  channels.set(Number(value), name);
}
const firstInstance = Number(/MESH_INSTANCE_FIRST_LOCATION\s*=\s*(\d+)/.exec(enums)?.[1] ?? NaN);

/** The predicate reads as a chain of `c != MeshChannel::X`; those are the exclusions. */
const predicate = /constexpr bool meshShaderReads\(MeshChannel c\)\s*\{([^}]*)\}/m.exec(enums)?.[1] ?? '';
const excluded = new Set([...predicate.matchAll(/MeshChannel::(\w+)/g)].map((m) => m[1]));
if (!/return\b/.test(predicate) || (!excluded.size && !/return true/.test(predicate))) {
  problems.push('meshShaderReads is no longer a chain of `c != MeshChannel::X` — this check can no longer read it');
}
const claimsRead = new Set([...channels.values()].filter((n) => !excluded.has(n)));

/** The Mesh shader's own vertex inputs, below the per-object record. */
const mesh = /const char\* MESH = R"esshader\(([\s\S]*?)\)esshader"/.exec(shaders)?.[1];
if (!mesh) problems.push(`no Mesh shader found in ${SHADERS}`);
const declared = new Set();
for (const [, loc] of (mesh ?? '').matchAll(/layout\(location\s*=\s*(\d+)\)\s*in\b/g)) {
  const n = Number(loc);
  if (n >= firstInstance) continue;
  const name = channels.get(n);
  if (!name) {
    problems.push(`the Mesh shader declares location ${n}, which MeshChannel does not name`);
    continue;
  }
  declared.add(name);
}

for (const name of declared) {
  if (!claimsRead.has(name)) {
    problems.push(`the Mesh shader reads ${name} and meshShaderReads excludes it`
      + ' — the layout would never bind it, and the shader would read whatever is there');
  }
}
for (const name of claimsRead) {
  if (!declared.has(name)) {
    problems.push(`meshShaderReads admits ${name} and no Mesh shader declares it`
      + ' — an attribute slot and a fetch per vertex, spent on nothing');
  }
}

if (problems.length) {
  console.error('check-mesh-shader-inputs: the predicate and the shader disagree:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-mesh-shader-inputs: ${declared.size} mesh channel(s) both declared and admitted`
  + ` (${[...declared].join(', ')}); ${[...excluded].join(', ') || 'none'} carried but not bound.`);
