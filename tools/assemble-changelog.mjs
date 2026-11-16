// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Folds the notes in changelog.d/ into CHANGELOG.md, for a release.
 *
 * Each fragment's note goes under its section of `## [Unreleased]`, its commits go into the table in releaseNotes.mjs (the
 * record of where every commit landed, which outlives the fragment), and the fragment is deleted. The heading is not renamed
 * and no version is written: that is the release commit's, which this is the first step of.
 *
 *   node tools/assemble-changelog.mjs            fold them in
 *   node tools/assemble-changelog.mjs --dry-run  say what would be folded, and change nothing
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { SECTIONS, readFragments } from './lib/changelogFragments.mjs';

/**
 * CHANGELOG.md with each note at the top of its section of `## [Unreleased]`, in the order given. A section the notes need
 * and the file does not have yet is made, in the order {@link SECTIONS} lists them.
 */
export function withNotes(changelog, notes) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]/.test(line));
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
  const sectionEnd = () => {
    const next = lines.findIndex((line, i) => i > start && /^## /.test(line));
    return next < 0 ? lines.length : next;
  };
  for (const section of [...SECTIONS].reverse()) {
    const mine = notes.filter((note) => note.section === section);
    if (!mine.length) continue;
    const bullets = mine.map((note) => `- ${note.text}`);
    const end = sectionEnd();
    const heading = lines.findIndex((line, i) => i > start && i < end && line === `### ${section}`);
    if (heading >= 0) {
      lines.splice(heading + 2, 0, ...bullets);
      continue;
    }
    // Before the first section that comes later in the order, or at the end of what is unreleased.
    const later = SECTIONS.slice(SECTIONS.indexOf(section) + 1);
    const before = lines.findIndex((line, i) => i > start && i < end && later.some((name) => line === `### ${name}`));
    lines.splice(before >= 0 ? before : end, 0, `### ${section}`, '', ...bullets, '');
  }
  return lines.join(eol);
}

/** releaseNotes.mjs with each fragment's commits added to the end of its table. */
export function withNoted(source, fragments) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const close = source.lastIndexOf('};');
  if (close < 0) throw new Error('tools/releaseNotes.mjs: the table has no closing `};`');
  const rows = [];
  for (const fragment of fragments) {
    const entry = fragment.internal !== undefined ? { internal: fragment.internal } : { note: fragment.note ?? fragment.headline };
    const [key, value] = Object.entries(entry)[0];
    for (const subject of fragment.commits) rows.push(`  ${JSON.stringify(subject)}:`, `    { ${key}: ${JSON.stringify(value)} },`);
  }
  return source.slice(0, close) + rows.map((row) => row + eol).join('') + source.slice(close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'tools', 'assemble-changelog.mjs')) {
  const dry = process.argv.includes('--dry-run');
  const fragments = readFragments();
  const broken = fragments.filter((fragment) => fragment.problems.length);
  for (const fragment of broken) for (const problem of fragment.problems) console.error(`  ${fragment.file} ${problem}`);
  if (broken.length) process.exit(1);
  const notes = fragments.filter((fragment) => fragment.section !== undefined);
  for (const fragment of fragments) {
    const what = fragment.section !== undefined ? `${fragment.section}: ${fragment.headline}` : fragment.note !== undefined ? `under "${fragment.note}"` : `internal: ${fragment.internal}`;
    console.log(`  ${fragment.file}  ${what}  (${fragment.commits.length} commit${fragment.commits.length === 1 ? '' : 's'})`);
  }
  if (!dry && fragments.length) {
    const changelog = path.join(ROOT, 'CHANGELOG.md'), table = path.join(ROOT, 'tools', 'releaseNotes.mjs');
    writeFileSync(changelog, withNotes(readFileSync(changelog, 'utf8'), notes));
    writeFileSync(table, withNoted(readFileSync(table, 'utf8'), fragments));
    for (const fragment of fragments) rmSync(path.join(ROOT, fragment.file));
  }
  console.log(`assemble-changelog: ${fragments.length} fragment(s) ${dry ? 'would be' : ''} folded into CHANGELOG.md, ${notes.length} of them notes of their own.`.replace('  ', ' '));
}
