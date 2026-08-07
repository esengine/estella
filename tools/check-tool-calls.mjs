// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-tool-calls.mjs — a tool we name is a tool that exists.
 *
 * Two places name the editor's tools outside the catalog itself, and both used
 * to be able to name one that was not there.
 *
 * The SCRIPTS that drive the editor. An argument a tool never declared was
 * dropped in silence, so a script could ask for something that had never
 * happened and still pass: `prefab-instance-name` spent a day telling
 * `create_prefab_from_entity` to write to a path — a tool that takes no path —
 * and reported green for a prefab that landed somewhere else. The tool refuses
 * an unknown argument now, but it refuses it SEVEN SECONDS INTO AN ELECTRON
 * BOOT, in the suite people run last, and only on the branch that happened to be
 * exercised. Both names are readable from here in a second.
 *
 * The agent's SYSTEM PROMPT. It names its tools in prose, and a name that goes
 * stale there is worse than one in a script: the model is TAUGHT to reach for
 * something that does not exist, in every conversation, and the only symptom is
 * an agent that keeps trying a call it never gets to make. This repo has already
 * shipped a prompt teaching an API that had not compiled in six months.
 *
 * Deliberately narrow in both halves. A call is inspected only when it can be
 * read with certainty — a literal tool name and a literal object of arguments;
 * one assembled from variables is left alone rather than guessed at. A gate that
 * is wrong even occasionally is one people learn to route around.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'desktop');
/** Where the repo drives the editor through its own tool catalog. */
const SCANNED = [path.join(DESKTOP, 'scripts')];

// A bare absolute path is not a module specifier on Windows: `F:\...` reads as a
// URL with scheme `f:`, and the ESM loader refuses it. pathToFileURL is the only
// spelling that works on both.
const { TOOLS } = await import(
  pathToFileURL(path.join(DESKTOP, 'shared', 'toolCatalog.mjs')).href
);
const declared = new Map(
  TOOLS.map((t) => [t.name, new Set(Object.keys(t.schema?.properties ?? {}))]),
);

/** `ed.call('tool', { a: 1, b: 2 }` — both parts literal, no nesting. */
const CALL = /\.(?:call|json)\(\s*'([a-z_0-9]+)'\s*,\s*\{([^{}]*)\}/g;
/** A key at the top level of that object literal. */
const KEY = /(?:^|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g;

function scripts(dir, out = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) scripts(abs, out);
    else if (entry.name.endsWith('.mjs')) out.push(abs);
  }
  return out;
}

const problems = [];
let checked = 0;

for (const file of SCANNED.flatMap((d) => scripts(d))) {
  const source = readFileSync(file, 'utf8');
  const where = path.relative(ROOT, file);
  for (const [, tool, args] of source.matchAll(CALL)) {
    const known = declared.get(tool);
    if (!known) {
      problems.push(`${where}: no tool named "${tool}"`);
      continue;
    }
    checked++;
    for (const [, key] of args.matchAll(KEY)) {
      if (!known.has(key)) {
        problems.push(`${where}: ${tool} takes no "${key}" — it takes ${[...known].join(', ') || '(nothing)'}`);
      }
    }
  }
}

/**
 * The prompt names its tools in prose, so every snake_case identifier in it is
 * one — with one documented exception: shader code, whose varyings and uniforms
 * carry the `v_`/`u_` prefix by convention. Anything else with an underscore in
 * a system prompt is an identifier, and the only identifiers this prompt has
 * business naming are tools.
 */
const SHADER_IDENT = /^[uv]_/;
const PROMPT = path.join(DESKTOP, 'electron', 'agent', 'prompt.ts');
const prompt = readFileSync(PROMPT, 'utf8');
const promptWhere = path.relative(ROOT, PROMPT);
for (const token of new Set(prompt.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])) {
  if (SHADER_IDENT.test(token)) continue;
  checked++;
  if (!declared.has(token)) {
    problems.push(`${promptWhere}: the prompt teaches "${token}", which is not a tool the catalog has`);
  }
}

if (problems.length > 0) {
  console.log(`check-tool-calls: ${problems.length} name(s) the catalog does not have:`);
  for (const p of problems) console.log('  ' + p);
  console.log('\nFix the name, or declare it in desktop/shared/toolCatalog.mjs.');
  process.exit(1);
}
console.log(`check-tool-calls: ${checked} name(s) in scripts and the agent prompt are tools the catalog has.`);
