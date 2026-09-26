// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A signing key the project's repository would publish is said so at export.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { committableSecrets } from '../src/export/exportGame';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

function project(git: boolean): string {
    const root = mkdtempSync(path.join(tmpdir(), 'secrets-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'sign'));
    for (const f of ['tracked.pem', 'ignored.pem', 'loose.pem']) writeFileSync(path.join(root, 'sign', f), 'KEY');
    if (git) {
        const g = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
        g('init', '-q');
        writeFileSync(path.join(root, '.gitignore'), 'sign/ignored.pem\n');
        g('add', 'sign/tracked.pem', '.gitignore');
        g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x');
    }
    return root;
}

describe('a signing key the repository would publish', () => {
    it('is named when committed, and when neither committed nor ignored', () => {
        const root = project(true);
        const said = committableSecrets(root, ['sign/tracked.pem', 'sign/ignored.pem', 'sign/loose.pem']);
        expect(said).toHaveLength(2);
        expect(said[0]).toMatch(/sign\/tracked\.pem is committed/);
        expect(said[1]).toMatch(/sign\/loose\.pem is in the project and not ignored/);
    });

    it('is not a concern outside the project, or where there is no repository', () => {
        const root = project(true);
        const outside = mkdtempSync(path.join(tmpdir(), 'keys-'));
        dirs.push(outside);
        writeFileSync(path.join(outside, 'k.pem'), 'KEY');
        expect(committableSecrets(root, [path.join(outside, 'k.pem')])).toEqual([]);
        expect(committableSecrets(project(false), ['sign/loose.pem'])).toEqual([]);
    });
});
