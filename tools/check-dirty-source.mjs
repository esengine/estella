// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-dirty-source.mjs — "is there unsaved work" has one answer.
 *
 * The editor holds several documents at once: the scene, and every open asset
 * editor (tileset, flipbook, FSM, behaviour tree, material graph, timeline).
 * Each tracks its own dirt; DirtyRegistry aggregates them, and discardGuard says
 * the rule outright — a guard reads "the DirtyRegistry aggregate (scene + every
 * open asset editor), NOT just the scene's EditorHistory".
 *
 * Four doors in the automation surface each restated that rule by hand, and one
 * drifted: `open_scene` asked EditorHistory alone, so opening a scene over an
 * unsaved material graph was refused through `open_asset` and waved through here
 * — same operation, opposite answers, and no failure anywhere to notice. They go
 * through one `requireDiscardable` now, and this keeps it that way.
 *
 * The rule: the AUTOMATION SURFACE may not read a single document's dirty state.
 * It is the surface with no human to prompt, so a wrong answer there is silent
 * data loss rather than a dialog someone can cancel.
 *
 * NARROW, on the evidence of check-layers. It does not police EditorHistory
 * everywhere — asking one document about itself is legitimate and common: the
 * scene registers into the aggregate with it (dirtyDocs), reloading the scene
 * from disk discards only the scene's edits (ProjectStore), and the Save command
 * asks the panel it is about (editorCommands). Those are per-document questions
 * with a person present. This checks the one file where neither is true.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The automation surface: what MCP and the built-in agent drive the editor through. */
const SURFACE = join(ROOT, 'desktop', 'src', 'main.tsx');
/** Where the aggregate is defined, and where the rule is written down. */
const REGISTRY = join(ROOT, 'desktop', 'src', 'document', 'DirtyRegistry.ts');
const GUARD = join(ROOT, 'desktop', 'src', 'project', 'discardGuard.ts');

for (const f of [SURFACE, REGISTRY, GUARD]) {
  try {
    readFileSync(f, 'utf8');
  } catch {
    console.error(`check-dirty-source: STALE — ${relative(ROOT, f)} does not exist.`);
    console.error('  Update SURFACE/REGISTRY/GUARD to name the files that hold the rule.');
    process.exit(1);
  }
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// The aggregate must still BE an aggregate: a registry that stopped reading the
// scene would make every guard below it pass while seeing nothing.
if (!/EditorHistory/.test(readFileSync(join(ROOT, 'desktop', 'src', 'document', 'dirtyDocs.ts'), 'utf8'))) {
  console.error('check-dirty-source: STALE — dirtyDocs no longer registers the scene into DirtyRegistry.');
  process.exit(1);
}

const src = stripComments(readFileSync(SURFACE, 'utf8'));
const violations = [];
src.split(/\r?\n/).forEach((line, i) => {
  if (/\bEditorHistory\b/.test(line)) violations.push({ line: i + 1, text: line.trim() });
});

if (violations.length) {
  console.error(`check-dirty-source: the automation surface reads one document's dirty state (${violations.length})`);
  for (const v of violations) console.error(`  ${relative(ROOT, SURFACE)}:${v.line}  ${v.text.slice(0, 100)}`);
  console.error('\n  A door that swaps the open document calls requireDiscardable, which asks');
  console.error('  DirtyRegistry — the scene AND every open asset editor. One document\'s');
  console.error('  history is not that answer; see discardGuard.ts.');
  process.exit(1);
}

console.log('check-dirty-source: the automation surface asks the registry, not one document.');
