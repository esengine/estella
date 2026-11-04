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
 * The MCP GUIDE. It names tools in prose, and a name that goes stale there is
 * worse than one in a script: whoever reads it — a person, or an agent handed the
 * page — is TAUGHT to reach for something that does not exist. (This half read the
 * built-in agent's system prompt until that agent was removed.)
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
 * The MCP guide names tools in prose, for the agents and people who read it — a stale name there teaches a call that
 * does not exist. Only backticked snake_case is read: that is how the guide spells a tool, and anything else with an
 * underscore in backticks is one too, apart from what the front itself answers (`enable_tools`) and shader names.
 */
const SHADER_IDENT = /^[uv]_/;
const FRONT_TOOLS = new Set(['enable_tools']);
const GUIDES = [
  path.join(ROOT, 'docs', 'astro', 'src', 'content', 'docs', 'agents', 'mcp.mdx'),
  path.join(ROOT, 'docs', 'astro', 'src', 'content', 'docs', 'zh-cn', 'agents', 'mcp.mdx'),
];
for (const guide of GUIDES) {
  const text = readFileSync(guide, 'utf8');
  const where = path.relative(ROOT, guide);
  for (const [, token] of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
    if (SHADER_IDENT.test(token) || FRONT_TOOLS.has(token)) continue;
    checked++;
    if (!declared.has(token)) problems.push(`${where}: the guide names "${token}", which is not a tool the catalog has`);
  }
}

if (problems.length > 0) {
  console.log(`check-tool-calls: ${problems.length} name(s) the catalog does not have:`);
  for (const p of problems) console.log('  ' + p);
  console.log('\nFix the name, or declare it in desktop/shared/toolCatalog.mjs.');
  process.exit(1);
}
console.log(`check-tool-calls: ${checked} name(s) in scripts and the MCP guide are tools the catalog has.`);
