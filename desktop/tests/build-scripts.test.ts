// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project-script bundler (REARCH_EDITOR_REALM Phase P1 / RC12 §E8-1).
 *        Asserts esengine is left EXTERNAL (resolved by the play realm's import
 *        map, not duplicated into every bundle) while the project's own modules
 *        are bundled in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectScripts } from '../electron/buildScripts';

let root: string;

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'estella-proj-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    // A project's own module — must be bundled IN.
    writeFileSync(
        path.join(root, 'src', 'components.ts'),
        `import { defineComponent } from 'esengine';\n` +
            `export const Wave = defineComponent('Wave', { amplitude: 1 });\n`,
    );
    // Entry — imports esengine (external) + a local module (bundled).
    writeFileSync(
        path.join(root, 'src', 'main.ts'),
        `import { addSystemToSchedule, Schedule } from 'esengine';\n` +
            `import { Wave } from './components';\n` +
            `addSystemToSchedule(Schedule.Update, () => { void Wave; });\n`,
    );
});

afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
});

describe('buildProjectScripts (E8-1)', () => {
    it('bundles src/main.ts with esengine external and local modules inlined', async () => {
        const res = await buildProjectScripts(root);
        expect(res.ok).toBe(true);
        expect(res.errors).toEqual([]);
        expect(res.outputPath).toBe(path.join(root, '.esengine/cache/scripts.mjs'));
        expect(existsSync(res.outputPath!)).toBe(true);

        const out = readFileSync(res.outputPath!, 'utf8');
        // esengine is kept external — the bare import survives in the bundle:
        expect(out).toMatch(/from\s*["']esengine["']/);
        // …and esengine is NOT inlined (the build would have errored trying to
        // resolve it from this fixture's node_modules if it weren't external).
        // The project's own module IS bundled (its local import is gone, its code present):
        expect(out).not.toMatch(/from\s*["']\.\/components["']/);
        expect(out).toContain('Wave');
        expect(out).toContain('amplitude');
    });

    it('reports a clean failure when the entry is missing', async () => {
        const empty = mkdtempSync(path.join(tmpdir(), 'estella-empty-'));
        try {
            const res = await buildProjectScripts(empty);
            expect(res.ok).toBe(false);
            expect(res.outputPath).toBeNull();
            expect(res.errors.join(' ')).toMatch(/entry not found/);
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });
});
