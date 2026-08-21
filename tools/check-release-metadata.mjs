// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-release-metadata.mjs — the files that name the shipped version
 *        have to name the one being shipped.
 *
 * The root `package.json` is the version (release.js writes it and nothing else).
 * Two other files repeat it, and repeating is how they fall behind: SECURITY.md
 * claimed 0.6.x/0.7.x were the supported series while 0.45.0 was shipping — a
 * table nobody had reason to open for thirty-eight releases, telling anyone who
 * did that their version was unsupported.
 *
 * Both are checked here rather than at release time, so the commit that bumps the
 * version is the commit that fails, not a step someone runs later and reads past.
 *
 *   node tools/check-release-metadata.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const version = JSON.parse(read('package.json')).version;
const [major, minor] = version.split('.');
const series = `${major}.${minor}.x`;

const problems = [];

// SECURITY.md: the supported table must mark the shipping series as supported.
// Matched on the row rather than the bare string so a mention in prose (or a
// row that says No) cannot satisfy it.
const security = read('SECURITY.md');
const row = new RegExp(`^\\|\\s*${series.replaceAll('.', '\\.')}\\s*\\|\\s*Yes\\s*\\|`, 'im');
if (!row.test(security)) {
    problems.push(
        `SECURITY.md has no supported row for ${series} — shipping ${version}.\n` +
        `    Expected a line like: | ${series}   | Yes       |`,
    );
}

// A row saying an already-shipped series is unsupported has to move with it too.
const unsupported = /^\|\s*<\s*(\d+\.\d+)\s*\|\s*No\s*\|/im.exec(security);
if (unsupported && unsupported[1] !== `${major}.${minor}`) {
    problems.push(
        `SECURITY.md draws the unsupported line at < ${unsupported[1]}, but ${version} is shipping.\n` +
        `    Expected: | < ${major}.${minor}    | No        |`,
    );
}

// CHANGELOG.md: the version being shipped needs its own section. release.js only
// warned about this, and a warning in a release script is read once, if at all.
const changelog = read('CHANGELOG.md');
if (!changelog.includes(`## [${version}]`)) {
    problems.push(
        `CHANGELOG.md has no "## [${version}]" section — write the release notes ` +
        `before bumping the version (rename the [Unreleased] heading).`,
    );
}

// Every version heading needs its compare link, and [Unreleased] has to compare
// from the shipping one. Four headings had none and [Unreleased] pointed two
// releases back — drift nobody reads until a heading turns out not to be a link.
const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
const refs = new Set([...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]:/gm)].map((m) => m[1]));
for (const v of headings) {
    if (!refs.has(v)) problems.push(`CHANGELOG.md has a "## [${v}]" section and no [${v}]: link — the heading renders as plain text`);
}
for (const v of refs) {
    if (!headings.includes(v)) problems.push(`CHANGELOG.md links [${v}]: with no "## [${v}]" section to link`);
}
// Against the NEWEST section rather than package.json: [Unreleased] means "since
// the last section in this file", and tying it to the version would fail for the
// one commit between renaming a section and bumping the version.
const unreleased = /^\[Unreleased\]:.*compare\/v(\d+\.\d+\.\d+)\.\.\.HEAD/m.exec(changelog);
if (!unreleased) problems.push('CHANGELOG.md has no [Unreleased] compare link');
else if (headings.length && unreleased[1] !== headings[0]) {
    problems.push(`CHANGELOG.md compares [Unreleased] from v${unreleased[1]}, but its newest section is ${headings[0]}`);
}

if (problems.length > 0) {
    console.error(`\ncheck-release-metadata: ${problems.length} problem(s) against version ${version}\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
}

console.log(`check-release-metadata: SECURITY.md and CHANGELOG.md both name ${version}.`);
