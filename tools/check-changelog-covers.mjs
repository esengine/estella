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
import { NOTED, NOTES_FLOOR } from './releaseNotes.mjs';
import { ROOT } from './lib/repo.mjs';
import { FRAGMENT_DIR, notedByFragments, readFragments } from './lib/changelogFragments.mjs';

const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

/** Types whose commits change what a creator can do, so a note is owed. */
const USER_FACING = /^(feat|fix|refactor|perf)(\([^)]*\))?!?:/;

const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...HERE } = process.env;

const git = (args, cwd = ROOT) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: HERE });
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

// A checkout without the history cannot answer: every entry would read as naming
// no commit. A shallow CI clone reported thirty of them before this said so.
const hasCommit = (rev, cwd = ROOT) => !!rev && !!git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], cwd).trim();
const desktopGit = existsSync(path.join(ROOT, 'desktop', '.git'));
const unreadable = [
  ...(hasCommit(NOTES_FLOOR) ? [] : [`${NOTES_FLOOR} is not in this checkout`]),
  ...(!desktopGit || hasCommit(gitlinkAt(NOTES_FLOOR), path.join(ROOT, 'desktop'))
    ? [] : [`the editor commit ${NOTES_FLOOR} points at is not in desktop/`]),
];
if (unreadable.length) {
  console.error(`check-changelog-covers: cannot read the history it judges — ${unreadable.join('; ')}.`
    + ' Fetch both repositories whole (fetch-depth: 0, and the editor without --depth).');
  process.exit(2);
}

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

// The notes no release has been cut from yet are files of their own (changelog.d/), and say their commits themselves.
const fragments = readFragments();
for (const fragment of fragments) for (const problem of fragment.problems) problems.push(`${fragment.file} ${problem}`);
const pending = notedByFragments(fragments);
const headlines = fragments.filter((f) => !f.problems.length && f.headline).map((f) => f.headline);
const noteExists = (note) => changelog.includes(note) || headlines.some((headline) => headline.startsWith(note));
for (const [subject, entry] of Object.entries(pending)) {
  if (NOTED[subject]) problems.push(`${entry.file} names "${subject}", which tools/releaseNotes.mjs already places`);
}

/**
 * A note is written as a fragment, never into CHANGELOG.md or the table in releaseNotes.mjs: any two pull requests that
 * added to those conflicted. Only a release writes them, and a release is the change that adds a version's heading.
 */
function writtenInPlace() {
  const base = git(['merge-base', 'HEAD', 'origin/master']).trim();
  if (!base || base === git(['rev-parse', 'HEAD']).trim()) return [];
  const added = (file) => git(['diff', '--unified=0', base, 'HEAD', '--', file]).split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const notes = added('CHANGELOG.md');
  if (notes.some((line) => /^\+## \[\d+\.\d+\.\d+\]/.test(line))) return [];
  // A release being re-cut before its tag is out (the tag was withdrawn to take later commits) adds notes to the newest version
  // heading, which is already there: that is still the release writing them.
  const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'))?.[1];
  if (newest && !git(['tag', '--list', `v${newest}`]).trim() && !git(['ls-remote', '--tags', 'origin', `v${newest}`]).trim()) return [];
  const found = [];
  if (notes.some((line) => line.startsWith('+- '))) found.push('CHANGELOG.md gained a note');
  if (added('tools/releaseNotes.mjs').some((line) => /^\+\s*\{\s*(note|internal):/.test(line))) found.push('tools/releaseNotes.mjs gained an entry');
  return found;
}
for (const where of writtenInPlace()) {
  problems.push(`${where}: write it as a file in ${FRAGMENT_DIR}/ instead (see ${FRAGMENT_DIR}/README.md), which no other pull request's note can conflict with`);
}

let noted = 0;
let internal = 0;
for (const { subject, repo } of commits) {
  if (!USER_FACING.test(subject)) continue;
  const entry = NOTED[subject] ?? pending[subject];
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
  if (!noteExists(entry.note)) {
    problems.push(`"${subject}" says it landed under "${entry.note}", which is not in the CHANGELOG or a fragment`);
    continue;
  }
  noted++;
}

for (const key of [...Object.keys(NOTED), ...Object.keys(pending)]) {
  if (!commits.some((c) => c.subject === key)) {
    problems.push(`nothing since ${NOTES_FLOOR} carries "${key}" — the entry names no commit`);
  }
}

if (unclassified.length) {
  console.error(`check-changelog-covers: ${unclassified.length} user-facing commit(s) reach no note.`);
  console.error(`Name each under \`commits:\` in a fragment (see ${FRAGMENT_DIR}/README.md): the note it landed under, or why a creator cannot see it:\n`);
  for (const u of unclassified) console.error(`  - ${u.replace(/^[a-z]+: /, '')}`);
  console.error('');
}
for (const p of problems) console.error(`  ${p}`);

if (unclassified.length || problems.length) process.exit(1);
console.log(`check-changelog-covers: ${noted} user-facing commit(s) landed in a note`
  + ` and ${internal} said why they could not, since ${NOTES_FLOOR}.`);
