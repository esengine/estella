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
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { corpusRoots, censusFindings, trackedFiles, untrackedFiles, sourceFiles, ROOT }
    from '../lib/sourceCensus.mjs';

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

    // A tracked-only scan answers "clean" about the file most likely to be wrong: the
    // one just written. The probe is written HERE because a clean tree has no untracked
    // file, and the assertion would pass by having nothing to say.
    it('offers tracked and untracked as one list, deduplicated', () => {
        const root = roots.find((r) => (r as { present: boolean }).present)!;
        const dir = path.join(ROOT, (root as { prefix: string }).prefix);
        const name = `census-probe-${process.pid}.esshader`;
        const probe = path.join(dir, name);
        writeFileSync(probe, '#pragma shader "Probe"\n');
        try {
            const rel = [(root as { prefix: string }).prefix, name].filter(Boolean).join('/');
            expect(trackedFiles(root)).not.toContain(rel);
            expect(untrackedFiles(root)).toContain(rel);
            const all: string[] = sourceFiles(root);
            expect(all).toContain(rel);
            expect(all.length).toBe(new Set(all).size);
            // And it filters where a caller asks, so a scan says which corpus it took.
            const shaders: string[] = sourceFiles(root, /\.esshader$/);
            expect(shaders).toContain(rel);
            expect(shaders.every((f) => f.endsWith('.esshader'))).toBe(true);
        } finally {
            rmSync(probe, { force: true });
        }
    });
});
