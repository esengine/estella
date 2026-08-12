// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-capabilities.mjs — a capability composes tools, and says how bad
 *        it is honestly.
 *
 * A capability exists to raise what a model reasons about: `configure_physics_body`
 * rather than four `add_component` / `set_field` calls. The whole reason that is
 * safe is that it composes DECLARED TOOLS and adds no editing truth of its own —
 * so it cannot drift from what the UI does, the way a second implementation of
 * the same operation always eventually does.
 *
 * Two things have to hold for that, and neither is visible at a glance:
 *
 * Every tool a capability names must exist. Nothing else checks: a step is a
 * string looked up at call time, so a renamed tool leaves a capability that
 * fails only when a model finally reaches for it — mid-conversation, having
 * already half-built something.
 *
 * A capability's declared `effect` must be no gentler than its steps'. The tiers
 * are drawn where undo stops working, and the built-in agent confirms exactly
 * the irreversible ones. A capability that runs `create_script` while calling
 * itself `undoable` walks a model straight past that prompt, and the file it
 * wrote is not coming back.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join(ROOT, 'desktop', 'shared');

const { ATOMS } = await import(pathToFileURL(path.join(SHARED, 'toolCatalog.mjs')).href);
const { CAPABILITIES, capabilityStepNames } = await import(
  pathToFileURL(path.join(SHARED, 'capabilityCatalog.mjs')).href
);

const SEVERITY = { read: 0, undoable: 1, irreversible: 2 };
const atomByName = new Map(ATOMS.map((t) => [t.name, t]));
const problems = [];

for (const cap of CAPABILITIES) {
  if (typeof cap.run !== 'function') problems.push(`${cap.name}: a capability needs a \`run(input, call)\``);
  if (!cap.description) problems.push(`${cap.name}: needs a description — it is what the model reads to choose it`);
  if (!cap.schema) problems.push(`${cap.name}: needs a schema`);
  if (atomByName.has(cap.name)) problems.push(`${cap.name}: shadows an atomic tool of the same name`);
}

let checked = 0;
for (const { name, effect, steps } of capabilityStepNames()) {
  if (steps.length === 0) {
    problems.push(`${name}: calls no tool — a capability that composes nothing is a tool, not a capability`);
  }
  for (const step of steps) {
    checked++;
    const tool = atomByName.get(step);
    if (!tool) {
      problems.push(`${name}: calls \`${step}\`, which the catalog does not have`);
      continue;
    }
    const stepEffect = tool.effect ?? 'read';
    if (SEVERITY[stepEffect] > SEVERITY[effect]) {
      problems.push(
        `${name}: declared \`${effect}\` but calls \`${step}\`, which is \`${stepEffect}\``
        + ' — the confirm gate reads the capability, not its steps',
      );
    }
  }
}

if (problems.length > 0) {
  console.log(`check-capabilities: ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-capabilities: ${CAPABILITIES.length} capabilities over ${checked} tool call(s) — every name exists, `
  + 'every effect is honest.',
);
