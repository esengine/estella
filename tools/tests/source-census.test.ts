// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  source-census.test.ts — what a repository-wide scan is entitled to say
 *        it read.
 *
 * The editor lives in a submodule, and `git ls-files` from the root sees nothing
 * inside one. Every scan that judged "the repository" judged half of it.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { corpusRoots, censusFindings, trackedFiles } from '../lib/sourceCensus.mjs';

type Root = { prefix: string; present: boolean };

describe('the source census spans this repository and the submodules that hold our source', () => {
    const roots: Root[] = corpusRoots();

    // Independent of whether the optional editor is checked out: a scan has to
    // KNOW about a corpus before it can say it looked at one or that it could not.
    it('names the root and the editor, and nothing vendored', () => {
        expect(roots.map((r) => r.prefix)).toEqual(['', 'desktop']);
    });

    it('reads the root corpus, which is where the engine is', () => {
        const root = roots.find((r) => r.prefix === '')!;
        expect(trackedFiles(root).length).toBeGreaterThan(1000);
    });

    // Every submodule declares which corpus it is in, so a new one cannot join
    // the tree and go unscanned by silence.
    it('holds every declared submodule to saying which corpus it is in', () => {
        expect(censusFindings(roots)).toEqual([]);
    });

    // A hook exports GIT_DIR, and it outranks `cwd`: unscrubbed, the submodule
    // corpus is the ROOT's file list wearing the submodule's prefix — every path a
    // lie, and only inside a push, which is the worst place to first meet it.
    it('is about the directory it runs in even when git pins one from the environment', () => {
        const editor = roots.find((r) => r.prefix === 'desktop')!;
        if (!editor.present) return;
        const before = process.env.GIT_DIR;
        process.env.GIT_DIR = `${process.cwd()}/.git`;
        try {
            const files: string[] = trackedFiles(editor);
            expect(files).toContain('desktop/package.json');
            expect(files).not.toContain('desktop/sdk/package.json');
        } finally {
            if (before === undefined) delete process.env.GIT_DIR;
            else process.env.GIT_DIR = before;
        }
    });

    it('prefixes a submodule file so it names one path from the repo root', () => {
        const editor = roots.find((r) => r.prefix === 'desktop')!;
        const files: string[] = trackedFiles(editor);
        // A checkout without the editor reads none, and says so rather than
        // reporting the empty list as a corpus it examined.
        if (!editor.present) {
            expect(files).toEqual([]);
            return;
        }
        expect(files.length).toBeGreaterThan(100);
        expect(files.every((f) => f.startsWith('desktop/'))).toBe(true);
    });
});
