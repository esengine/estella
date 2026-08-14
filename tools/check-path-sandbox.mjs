// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-path-sandbox.mjs — one containment check, not six.
 *
 * "Is this path inside that root?" was written out by hand at six doors, each
 * with a different amount of it right; the project one was lexical, so a symlink
 * inside a project walked out of the sandbox. They now share `pathSandbox.ts`,
 * and this keeps the idiom from being open-coded again.
 *
 * A use that is NOT a boundary — classifying paths for a report, say — opts out
 * on the line above with `path-sandbox: <why>`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = 'desktop/electron/pathSandbox.ts';
const SCOPE = /^desktop\/(electron|src)\/.*\.tsx?$/;

// The two spellings of lexical containment, which is the check that is not one.
const IDIOMS = [
  { id: 'dotdot', re: /\.startsWith\(\s*['"]\.\.['"]\s*\)/ },
  { id: 'sep', re: /\.startsWith\(\s*\w[\w.]*\s*\+\s*path\.sep\s*\)/ },
];
const OPT_OUT = /path-sandbox:/;

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  // `git ls-files` lists what is TRACKED, which includes a file deleted in the
  // working tree: reading one throws and takes every later gate with it.
  .filter((f) => SCOPE.test(f) && f !== HOME && existsSync(path.join(ROOT, f)));

const findings = [];
for (const file of files) {
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const hit = IDIOMS.find((r) => r.re.test(lines[i]));
    if (!hit) continue;
    // The opt-out sits on the line itself or anywhere in the comment block above
    // it — a justification worth reading is usually more than one line.
    let j = i - 1;
    while (j >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[j])) j--;
    if (OPT_OUT.test(lines[i]) || lines.slice(j + 1, i).some((l) => OPT_OUT.test(l))) continue;
    findings.push({ file, line: i + 1, text: lines[i].trim() });
  }
}

if (findings.length === 0) {
  console.log(`check-path-sandbox: ${files.length} file(s) — containment is asked of ${HOME}, not open-coded.`);
  process.exit(0);
}
for (const f of findings) {
  console.error(`\n${f.file}:${f.line}  hand-rolled containment check`);
  console.error(`    ${f.text}`);
}
console.error(
  `\ncheck-path-sandbox: ${findings.length} finding(s). Use isInsideRoot/resolveInside from `
  + `${HOME}, or mark a non-boundary use with a "path-sandbox: <why>" comment.`,
);
process.exit(1);
