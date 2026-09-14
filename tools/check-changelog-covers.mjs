// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every user-facing commit reaches the release notes, or says why not.
 *
 * See tools/releaseNotes.mjs for why this exists. The short version: the other
 * CHANGELOG gate reads structure, this one reads whether anything was left out.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTED, NOTES_FLOOR } from './releaseNotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

/** Types whose commits change what a creator can do, so a note is owed. */
const USER_FACING = /^(feat|fix|refactor|perf)(\([^)]*\))?!?:/;

const git = (args, cwd = ROOT) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  } catch {
    return '';
  }
};

/**
 * Subjects between `from` and `to` in one repository. The submodule is read at
 * the gitlinks the two revisions point at — its commits are the editor's, and a
 * creator cannot tell which repository a feature came from.
 */
function subjects(from, to, cwd = ROOT) {
  return git(['log', '--format=%s', `${from}..${to}`], cwd)
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

const gitlinkAt = (rev) => {
  const line = git(['ls-tree', rev, 'desktop']).trim();
  return line ? line.split(/\s+/)[2] : '';
};

const problems = [];
const unclassified = [];

if (!existsSync(CHANGELOG)) {
  console.error('check-changelog-covers: no CHANGELOG.md');
  process.exit(1);
}
const changelog = readFileSync(CHANGELOG, 'utf8');

// Everything since the floor, HEAD included: a feature is owed a note from the
// moment it lands, not from the moment somebody cuts a release.
const commits = [
  ...subjects(NOTES_FLOOR, 'HEAD').map((s) => ({ subject: s, repo: 'engine' })),
];
const desktop = path.join(ROOT, 'desktop');
const [fromLink, toLink] = [gitlinkAt(NOTES_FLOOR), gitlinkAt('HEAD')];
if (fromLink && toLink && existsSync(path.join(desktop, '.git'))) {
  commits.push(...subjects(fromLink, toLink, desktop).map((s) => ({ subject: s, repo: 'editor' })));
}

let noted = 0;
let internal = 0;
for (const { subject, repo } of commits) {
  if (!USER_FACING.test(subject)) continue;
  const entry = NOTED[subject];
  if (!entry) {
    unclassified.push(`${repo}: ${subject}`);
    continue;
  }
  if (entry.internal) {
    internal++;
    continue;
  }
  // The other direction: a headline that no longer exists means the note was
  // renamed or dropped, and the classification stopped describing the release.
  if (!changelog.includes(entry.note)) {
    problems.push(`"${subject}" says it landed under "${entry.note}", which is not in the CHANGELOG`);
    continue;
  }
  noted++;
}

for (const key of Object.keys(NOTED)) {
  if (!commits.some((c) => c.subject === key)) {
    problems.push(`nothing since ${NOTES_FLOOR} carries "${key}" — the entry names no commit`);
  }
}

if (unclassified.length) {
  console.error(`check-changelog-covers: ${unclassified.length} user-facing commit(s) reach no note.`);
  console.error('Add each to tools/releaseNotes.mjs — the note it landed under, or why a creator cannot see it:\n');
  for (const u of unclassified) {
    console.error(`  '${u.replace(/^[a-z]+: /, '').replace(/'/g, "\\'")}':`);
    console.error("    { note: '' },  // or { internal: '<why no creator can observe it>' }");
  }
  console.error('');
}
for (const p of problems) console.error(`  ${p}`);

if (unclassified.length || problems.length) process.exit(1);
console.log(`check-changelog-covers: ${noted} user-facing commit(s) landed in a note`
  + ` and ${internal} said why they could not, since ${NOTES_FLOOR}.`);
