// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { notedByFragments, parseFragment, readFragments } from '../lib/changelogFragments.mjs';
import { withNoted, withNotes } from '../assemble-changelog.mjs';

const scratch = mkdtempSync(path.join(tmpdir(), 'estella-fragments-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const NOTE = `---
section: Fixed
commits:
  - fix(render): a sky is "light": it is encoded, not written as it is
  - fix(editor): the same, in the editor
---
**A sky is no longer dark.** It was written
as codes, and is encoded now.
`;

describe('a changelog fragment', () => {
    it('is a section, its commits as written, and a note that leads with its headline', () => {
        const fragment = parseFragment(NOTE);
        expect(fragment.problems).toEqual([]);
        expect(fragment.section).toBe('Fixed');
        expect(fragment.commits).toEqual(['fix(render): a sky is "light": it is encoded, not written as it is', 'fix(editor): the same, in the editor']);
        expect(fragment.headline).toBe('A sky is no longer dark.');
        expect(fragment.text).toBe('**A sky is no longer dark.** It was written as codes, and is encoded now.');
    });

    it('reads the same from a checkout with CRLF line endings', () => {
        expect(parseFragment(NOTE.replace(/\n/g, '\r\n'))).toEqual(parseFragment(NOTE));
    });

    it('files commits under a note there already is, or says why nobody can see them', () => {
        const under = parseFragment('---\nnote: A sky is no longer dark.\ncommits:\n  - fix(render): a follow-up\n---\n');
        expect(under.problems).toEqual([]);
        const internal = parseFragment('---\ninternal: a rename inside the renderer\ncommits:\n  - refactor(render): one place\n---\n');
        expect(internal.problems).toEqual([]);
        expect(notedByFragments([{ file: 'a.md', ...under }, { file: 'b.md', ...internal }])).toEqual({
            'fix(render): a follow-up': { note: 'A sky is no longer dark.', file: 'a.md' },
            'refactor(render): one place': { internal: 'a rename inside the renderer', file: 'b.md' },
        });
    });

    it('says what is wrong with one it cannot place', () => {
        const problems = (source: string) => parseFragment(source).problems.join(' | ');
        expect(problems('**A note.** With no header.')).toMatch(/does not start with/);
        expect(problems('---\nsection: Fixed\n**A note.**')).toMatch(/no closing/);
        expect(problems('---\nsection: Mended\n---\n**A note.** Text.')).toMatch(/not one of Added/);
        expect(problems('---\nsection: Fixed\n---\nA note with no headline.')).toMatch(/bolded headline/);
        expect(problems('---\nsection: Fixed\nnote: Another.\n---\n**A note.** Text.')).toMatch(/exactly one/);
        expect(problems('---\nnote: Another.\n---\n')).toMatch(/names no commit/);
        expect(problems('---\ninternal: why\ncommits:\n  - refactor: x\n---\nText here.')).toMatch(/only a fragment with a `section`/);
        expect(problems('---\nsection: Fixed\nauthor: someone\n---\n**A note.** Text.')).toMatch(/unknown header key "author"/);
        // A broken fragment places nothing: its commits stay unclassified, which the gate then says.
        expect(notedByFragments([{ file: 'a.md', ...parseFragment('---\nsection: Mended\ncommits:\n  - fix: x\n---\n**A.** B.') }])).toEqual({});
    });

    it('is every .md of the directory but its README, by name', () => {
        mkdirSync(path.join(scratch, 'changelog.d'));
        writeFileSync(path.join(scratch, 'changelog.d', 'README.md'), '# not a fragment');
        writeFileSync(path.join(scratch, 'changelog.d', 'b-sky.md'), NOTE);
        writeFileSync(path.join(scratch, 'changelog.d', 'a-rename.md'), '---\ninternal: a rename\ncommits:\n  - refactor: x\n---\n');
        expect(readFragments(scratch).map((fragment) => fragment.file)).toEqual(['changelog.d/a-rename.md', 'changelog.d/b-sky.md']);
        expect(readFragments(path.join(scratch, 'nowhere'))).toEqual([]);
    });
});

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- **An older feature.** Text.

### Fixed

- **An older fix.** Text.

## [1.2.0] - 2026-01-01

### Fixed

- **A released fix.** Text.

[Unreleased]: https://example.test/compare/v1.2.0...HEAD
`;

describe('a release folding fragments in', () => {
    const note = (section: string, text: string) => ({ section, text });

    it('puts each note at the top of its section of what is unreleased, and nowhere else', () => {
        const out = withNotes(CHANGELOG, [note('Fixed', '**A sky is no longer dark.** Encoded.'), note('Added', '**A new thing.** Here.'), note('Fixed', '**A second fix.** Too.')]);
        expect(out).toContain('### Added\n\n- **A new thing.** Here.\n- **An older feature.** Text.\n');
        expect(out).toContain('### Fixed\n\n- **A sky is no longer dark.** Encoded.\n- **A second fix.** Too.\n- **An older fix.** Text.\n\n## [1.2.0]');
        expect(out.slice(out.indexOf('## [1.2.0]'))).toBe(CHANGELOG.slice(CHANGELOG.indexOf('## [1.2.0]')));
    });

    it('makes a section the notes need, where the order of sections puts it', () => {
        const out = withNotes(CHANGELOG, [note('Changed', '**A changed thing.** So.'), note('Security', '**A hole closed.** So.')]);
        expect(out).toContain('- **An older feature.** Text.\n\n### Changed\n\n- **A changed thing.** So.\n\n### Fixed\n');
        expect(out).toContain('- **An older fix.** Text.\n\n### Security\n\n- **A hole closed.** So.\n\n## [1.2.0]');
        const bare = withNotes('# Changelog\n\n## [Unreleased]\n\n## [1.2.0]\n', [note('Fixed', '**A fix.** So.')]);
        expect(bare).toBe('# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- **A fix.** So.\n\n## [1.2.0]\n');
    });

    it('keeps the line endings the file has, and changes nothing with no notes', () => {
        const crlf = CHANGELOG.replace(/\n/g, '\r\n');
        expect(withNotes(crlf, [])).toBe(crlf);
        const out = withNotes(crlf, [note('Fixed', '**A fix.** So.')]);
        expect(out).toContain('### Fixed\r\n\r\n- **A fix.** So.\r\n- **An older fix.** Text.\r\n');
        expect(out.replace(/\r\n/g, '')).not.toContain('\n');
        expect(() => withNotes('# Changelog\n', [note('Fixed', '**A fix.** So.')])).toThrow(/Unreleased/);
    });

    it('moves the commits into the table, as entries the table already reads', async () => {
        const table = 'export const NOTED = {\n  "fix: an old one":\n    { note: "An older fix." },\n};\n';
        const out = withNoted(table, [
            { ...parseFragment(NOTE), file: 'a.md' },
            { ...parseFragment('---\ninternal: a "rename"\ncommits:\n  - refactor: x\n---\n'), file: 'b.md' },
        ]);
        const file = path.join(scratch, 'table.mjs');
        writeFileSync(file, out);
        const { NOTED } = await import(`file:///${file.replace(/\\/g, '/')}`);
        expect(NOTED).toEqual({
            'fix: an old one': { note: 'An older fix.' },
            'fix(render): a sky is "light": it is encoded, not written as it is': { note: 'A sky is no longer dark.' },
            'fix(editor): the same, in the editor': { note: 'A sky is no longer dark.' },
            'refactor: x': { internal: 'a "rename"' },
        });
    });
});
