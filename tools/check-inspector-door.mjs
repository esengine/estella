// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-inspector-door.mjs — per-component inspector UI has one door.
 *
 * Most of the Details panel is derived: the component registry says a field is a
 * vec2 or an enum, and a control renders it by TYPE. A few components need more
 * than their fields — an anchor grid, a shape switch, a "put me under a Canvas"
 * button. That extra used to be added two different ways: plugins registered it,
 * and the editor's own was a chain of `comp.name === 'UINode' ? … :
 * comp.name === 'FlexContainer' ? …` in the panel body, sitting directly above
 * the element that renders the plugin half.
 *
 * Two ways to say one thing is how they came to disagree. The panel has TWO
 * bodies — the edit inspector and the live Game inspector — each grew its own
 * chain, and the Game one ended up running an edit-model action against a realm
 * runtime id, an id space its own header calls "never mixed". Nothing failed;
 * the button was simply wired to the surface where its argument means something
 * else, and missing from the one where it works.
 *
 * So: naming a built-in component in the render path is the violation. The extra
 * goes on `componentDecorators.tsx`, which is the table — the one file where
 * naming a component is the entire point, and the only exemption here.
 *
 * DELIBERATELY NARROW, on the evidence of check-layers: a rule that is wrong even
 * occasionally teaches everyone to route around it. It flags a component name as
 * a STRING LITERAL, nothing else. It does not police `.name` comparisons in
 * general (a panel id, an asset type and a menu entry all have names), does not
 * read intent, and does not care where in the file the literal sits. The names
 * come from the same source-only enumerator the component reference uses, so a
 * component cannot be known to one check and invisible to the other.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { componentNamesFromSource } from './lib/componentNames.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The inspector's render path: what draws an entity's components. */
const GUARDED = [
  join(ROOT, 'desktop', 'src', 'panels', 'Details.tsx'),
  join(ROOT, 'desktop', 'src', 'panels', 'inspector', 'controls.tsx'),
];

/** Where naming a component IS the point — the decorator table itself. */
const EXEMPT = join(ROOT, 'desktop', 'src', 'panels', 'inspector', 'componentDecorators.tsx');

// A guard whose subject moved is a guard that protects nothing while reporting
// success — this repo has shipped that twice. Fail loudly instead.
for (const f of [...GUARDED, EXEMPT]) {
  try {
    readFileSync(f, 'utf8');
  } catch {
    console.error(`check-inspector-door: STALE — ${relative(ROOT, f)} does not exist.`);
    console.error('  The inspector moved. Update GUARDED/EXEMPT to name the files that render it.');
    process.exit(1);
  }
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const names = componentNamesFromSource();
if (names.length < 20) {
  console.error(`check-inspector-door: STALE — only ${names.length} component names found; the enumerator no longer matches the SDK.`);
  process.exit(1);
}
const nameSet = new Set(names);

const violations = [];
for (const file of GUARDED) {
  const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/'([A-Za-z0-9_]+)'/g)) {
      if (nameSet.has(m[1])) violations.push({ file, line: i + 1, name: m[1], text: line.trim() });
    }
  });
}

if (violations.length) {
  console.error(`check-inspector-door: ${violations.length} component name(s) written into the inspector's render path`);
  for (const v of violations) {
    console.error(`  ${relative(ROOT, v.file)}:${v.line}  '${v.name}'`);
    console.error(`    ${v.text.slice(0, 110)}`);
  }
  console.error('\n  Per-component UI is a decorator. Register it in');
  console.error(`  ${relative(ROOT, EXEMPT)} under owner 'core' — a render body, the`);
  console.error('  field keys it owns, and/or a header action — instead of branching here.');
  process.exit(1);
}

console.log(`check-inspector-door: the inspector names none of the ${names.length} components it renders.`);
