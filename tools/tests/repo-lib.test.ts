// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, read, repoRelative, stripComments, walkFiles } from '../lib/repo.mjs';

describe('repo root', () => {
    it('is the directory that holds the workspace', () => {
        expect(existsSync(path.join(ROOT, 'pnpm-workspace.yaml'))).toBe(true);
        expect(read('pnpm-workspace.yaml')).toContain('packages:');
        expect(repoRelative(path.join(ROOT, 'tools', 'lib', 'repo.mjs'))).toBe('tools/lib/repo.mjs');
    });
});

describe('stripComments', () => {
    it('leaves a // inside a string alone', () => {
        const src = 'const url = "https://example.test/a"; // trailing\nhealth.current = 1;';
        const out = stripComments(src);
        expect(out).toContain('"https://example.test/a"');
        expect(out).not.toContain('trailing');
        expect(out).toContain('health.current = 1;');
    });

    it('keeps every line where it was', () => {
        const src = 'a;\n/* one\n   two\n   three */\nb; // tail\nc;';
        const out = stripComments(src);
        expect(out.split('\n')).toHaveLength(src.split('\n').length);
        expect(out.split('\n')[4].trim()).toBe('b;');
        expect(out).toHaveLength(src.length);
    });

    it('reads a template literal and an escaped slash in a regex as code', () => {
        const src = 'const t = `// not a comment ${x}`; const r = /\\/\\//; done();';
        expect(stripComments(src)).toBe(src);
    });
});

describe('walkFiles', () => {
    let dir = '';
    beforeAll(() => {
        dir = mkdtempSync(path.join(os.tmpdir(), 'estella-walk-'));
        for (const d of ['src/deep', 'node_modules/pkg', '.hidden', 'dist']) mkdirSync(path.join(dir, d), { recursive: true });
        for (const f of ['src/a.ts', 'src/a.generated.ts', 'src/deep/b.ts', 'src/deep/c.md', 'node_modules/pkg/x.ts', '.hidden/h.ts', 'dist/d.ts', '.dot.ts']) {
            writeFileSync(path.join(dir, f), '');
        }
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const names = (files: string[]) => files.map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();

    it('never enters node_modules', () => {
        expect(names(walkFiles(dir)).some((f) => f.startsWith('node_modules/'))).toBe(false);
        expect(names(walkFiles(dir))).toContain('.hidden/h.ts');
    });

    it('matches by pattern or by function, skips what it is told to, and can leave dot entries out', () => {
        expect(names(walkFiles(dir, { match: /\.ts$/, hidden: false, skip: (name: string, _full: string, folder: boolean) => folder && name === 'dist' })))
            .toEqual(['src/a.generated.ts', 'src/a.ts', 'src/deep/b.ts']);
        expect(names(walkFiles(path.join(dir, 'src'), { match: (name: string) => name.endsWith('.ts') && !name.endsWith('.generated.ts') })))
            .toEqual(['src/a.ts', 'src/deep/b.ts']);
    });

    it('throws for a missing directory unless told it may be absent', () => {
        expect(() => walkFiles(path.join(dir, 'nope'))).toThrow();
        expect(walkFiles(path.join(dir, 'nope'), { missing: true })).toEqual([]);
    });
});
