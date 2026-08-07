// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  componentNames.mjs — the engine's component names, from source alone.
 *
 * No SDK build required, which is the whole point: the checks that read this run
 * in seconds on every push, before anything is compiled.
 *
 * Two tools need the list and must not each carry their own idea of it. The
 * component reference derives a documentation page per component; the inspector
 * door check refuses a component name written as a literal in the panel's render
 * path. A list that drifts between them fails in the direction that hurts —
 * silently passing a component neither one knows about.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SDK_SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'sdk', 'src');

function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Comments hold example code (`defineComponent('Patrol', …)`) that would
 *  otherwise register as a component that does not exist. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * Component names, from source alone — no SDK build required.
 *
 * Matches the assignment, not the bare call: every real registration is
 * `export const X = defineComponent(…)`, while the strings that merely *mention*
 * the call are prose — a `defineComponent('MyThing', …)` inside an error message
 * teaching the argument order is not a component, and comment-stripping alone
 * does not reach it.
 */
export function componentNamesFromSource() {
  const names = new Set();
  for (const f of tsFiles(SDK_SRC)) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/=\s*define(?:Component|Builtin|Tag)(?:<[^>]*>)?\(\s*'([A-Za-z0-9_]+)'/g)) {
      names.add(m[1]);
    }
  }
  // ensureBuiltinComponentsRegistered() registers every COMPONENT_META key,
  // typed const or not, so the generated metadata is part of the set.
  const gen = readFileSync(join(SDK_SRC, 'ecs', 'component.generated.ts'), 'utf8');
  const meta = gen.slice(gen.indexOf('export const COMPONENT_META'));
  for (const m of meta.matchAll(/^ {4}([A-Za-z0-9_]+): \{$/gm)) names.add(m[1]);
  return [...names].sort();
}
