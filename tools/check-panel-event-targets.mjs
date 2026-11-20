#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'desktop/src';

const MAIN_WINDOW_ONLY = new Map([
  ['desktop/src/App.tsx', 'the shell flushes the session when the main window unloads'],
  ['desktop/src/engine/backgroundThrottle.ts', 'the throttle follows the main window\'s focus'],
  ['desktop/src/layout/MenuBar.tsx', 'the menu bar is main-window chrome and never sits in a dock panel'],
  ['desktop/src/layout/SubsystemIndicator.tsx', 'the status bar is main-window chrome and never sits in a dock panel'],
  ['desktop/src/playHost.ts', 'the play realm is its own document, not a dock panel'],
  ['desktop/src/project/ToolsStore.ts', 'a store has no DOM and follows the main window\'s focus'],
  ['desktop/src/store/userPrefs.ts', 'preferences are written when the main window goes, which ends the editor; a panel closing must not'],
]);

const RULES = [
  {
    pattern: /(?<![.\w$])(window|document)\.(addEventListener|removeEventListener)\b/g,
    fix: 'listen on eventWindow(e), usePanelWindow() or the element\'s ownerDocument',
  },
  {
    pattern: /(?<![.\w$])document\.activeElement\b/g,
    fix: 'read the element\'s ownerDocument.activeElement',
  },
  {
    pattern: /(?<![.\w$])(window|document)\.getSelection\b/g,
    fix: 'read eventWindow(e).getSelection() or usePanelWindow().getSelection()',
  },
];

if (!existsSync(path.join(ROOT, 'desktop', 'package.json'))) {
  console.error('check-panel-event-targets: the editor is not checked out, and its panels');
  console.error('  are the subject of this check.');
  console.error('  git submodule update --init desktop   (private; you need access)');
  process.exit(2);
}

const everyFile = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') everyFile(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const blank = (m) => m.replace(/[^\n]/g, ' ');
const uncomment = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(?<![:'"`\\])\/\/[^\n]*/g, blank);

const files = everyFile(path.join(ROOT, SRC));
if (files.length === 0) {
  console.error(`check-panel-event-targets: no sources under ${SRC} — the editor moved.`);
  process.exit(1);
}

const problems = [];
const exempted = new Set();
for (const file of files) {
  const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const text = uncomment(readFileSync(file, 'utf8'));
  for (const { pattern, fix } of RULES) {
    for (const m of text.matchAll(pattern)) {
      if (MAIN_WINDOW_ONLY.has(rel)) { exempted.add(rel); continue; }
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${line}: ${m[0]} is the main window's, and a popped-out panel lives in another — ${fix}`);
    }
  }
}

for (const [rel, why] of MAIN_WINDOW_ONLY) {
  if (!exempted.has(rel)) problems.push(`${rel}: exempted (${why}) but no longer touches the main window's globals — drop it from MAIN_WINDOW_ONLY`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-panel-event-targets: ${problems.length} finding(s).`);
  process.exit(1);
}
console.log(`check-panel-event-targets: ${files.length} files, ${MAIN_WINDOW_ONLY.size} main-window exemptions, no panel code on the main window's globals.`);
