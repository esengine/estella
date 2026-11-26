// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The release notes that have not been cut into a release yet, one file per note (`changelog.d/`).
 *
 * A note is a file of its own so that two pull requests add two files: written into CHANGELOG.md and the table in
 * releaseNotes.mjs, any two of them conflict. A release folds the files into both (tools/assemble-changelog.mjs).
 *
 * A fragment is a header between two `---` lines and, for a new note, the note under it:
 *
 *     ---
 *     section: Fixed
 *     commits:
 *       - fix(render): the subject of a commit this note covers, as written
 *     ---
 *     **The headline, a sentence.** What changed, for whoever uses it.
 *
 * In place of `section`, `note: <a headline>` files its commits under a note there already is, and `internal: <why>` says
 * why nobody using the engine can see what they change. Neither has text under the header.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './repo.mjs';

export const FRAGMENT_DIR = 'changelog.d';
/** The sections a note can go under, in the order CHANGELOG.md lists them. */
export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

/** The bolded sentence a note leads with. */
export const headlineOf = (text) => /^\*\*(.+?)\*\*/s.exec(text)?.[1].replace(/\s+/g, ' ').trim() ?? null;

function commitSubject(item) {
  const subject = item.trim();
  if (subject.startsWith('"') && subject.endsWith('"')) {
    try { return JSON.parse(subject); } catch { /* Keep literal text for the history check. */ }
  }
  return subject;
}

/**
 * One fragment's text as what it says, or why it cannot be read.
 * @returns {{ section?: string, note?: string, internal?: string, commits: string[], text: string, headline: string | null, problems: string[] }}
 */
export function parseFragment(source) {
  const problems = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = { commits: [], text: '', headline: null, problems };
  if (lines[0] !== '---') { problems.push('does not start with a `---` line'); return out; }
  const end = lines.indexOf('---', 1);
  if (end < 0) { problems.push('its header has no closing `---` line'); return out; }
  let inCommits = false;
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (inCommits && item) { out.commits.push(commitSubject(item[1])); continue; }
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!field) { problems.push(`a header line is neither \`key: value\` nor a commit: "${line}"`); continue; }
    inCommits = field[1] === 'commits';
    if (inCommits) {
      if (field[2]) problems.push('`commits:` takes its subjects on the lines under it, each `  - subject`');
    } else if (['section', 'note', 'internal'].includes(field[1])) {
      out[field[1]] = field[2].trim();
    } else {
      problems.push(`unknown header key "${field[1]}" (section, note, internal, commits)`);
    }
  }
  out.text = lines.slice(end + 1).map((line) => line.trim()).filter(Boolean).join(' ');
  out.headline = headlineOf(out.text);

  const kinds = ['section', 'note', 'internal'].filter((key) => out[key] !== undefined);
  if (kinds.length !== 1) problems.push(`says ${kinds.length ? kinds.join(' and ') : 'none of section, note or internal'}: exactly one`);
  if (out.section !== undefined) {
    if (!SECTIONS.includes(out.section)) problems.push(`section "${out.section}" is not one of ${SECTIONS.join(', ')}`);
    if (!out.headline) problems.push('its note does not lead with a **bolded headline.**');
  } else {
    if (out.text) problems.push('has text under its header, and only a fragment with a `section` is a note of its own');
    if (kinds.length === 1 && !out[kinds[0]]) problems.push(`\`${kinds[0]}:\` is empty`);
    if (!out.commits.length) problems.push('names no commit');
  }
  return out;
}

/** Every fragment in the checkout, by file name. `README.md` is the directory's own page. */
export function readFragments(root = ROOT) {
  const dir = path.join(root, FRAGMENT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => ({ file: `${FRAGMENT_DIR}/${name}`, ...parseFragment(readFileSync(path.join(dir, name), 'utf8')) }));
}

/** Commit subject -> where it landed, as releaseNotes.mjs's NOTED says it, for the fragments that read cleanly. */
export function notedByFragments(fragments) {
  const noted = {};
  for (const fragment of fragments) {
    if (fragment.problems.length) continue;
    const entry = fragment.internal !== undefined ? { internal: fragment.internal } : { note: fragment.note ?? fragment.headline };
    for (const subject of fragment.commits) noted[subject] = { ...entry, file: fragment.file };
  }
  return noted;
}
