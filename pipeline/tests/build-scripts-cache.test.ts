// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project-script bundle is built again only when a file it read has changed.
 */
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProjectScripts } from '../src/bundle/buildScripts';

describe('building a project\'s scripts', () => {
    let root: string;
    let packages: string;
    const bundle = () => path.join(root, '.esengine', 'cache', 'scripts.mjs');
    const built = () => statSync(bundle()).mtimeMs;

    beforeAll(() => {
        root = mkdtempSync(path.join(tmpdir(), 'scripts-cache-'));
        packages = path.join(root, 'packages');
        mkdirSync(packages);
        mkdirSync(path.join(root, 'src'));
        writeFileSync(path.join(root, 'src', 'main.ts'), "import { answer } from './answer';\nconsole.log(answer);\n");
        writeFileSync(path.join(root, 'src', 'answer.ts'), 'export const answer = 42;\n');
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    it('builds the first time and leaves the bundle alone the second', async () => {
        const first = await buildProjectScripts(root, { packagesDir: packages });
        expect(first.ok).toBe(true);
        const at = built();
        // the clock must be able to tell a rewrite from a skip
        utimesSync(bundle(), new Date(at - 60_000), new Date(at - 60_000));
        const before = built();
        const second = await buildProjectScripts(root, { packagesDir: packages });
        expect(second.ok).toBe(true);
        expect(second.outputPath).toBe(first.outputPath);
        expect(built()).toBe(before);
    });

    it('builds again when a file it read changed, even a file the entry only reaches through another', async () => {
        const before = built();
        writeFileSync(path.join(root, 'src', 'answer.ts'), 'export const answer = 43;\n');
        const result = await buildProjectScripts(root, { packagesDir: packages });
        expect(result.ok).toBe(true);
        expect(built()).toBeGreaterThan(before);
        const text = (await import('node:fs')).readFileSync(bundle(), 'utf8');
        expect(text).toContain('43');
    });

    it('builds again when the bundle is gone', async () => {
        rmSync(bundle());
        const result = await buildProjectScripts(root, { packagesDir: packages });
        expect(result.ok).toBe(true);
        expect(built()).toBeGreaterThan(0);
    });
});
