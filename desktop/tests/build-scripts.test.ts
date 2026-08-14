// SPDX-License-Identifier: Apache-2.0
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
import { buildProjectScripts } from '../../pipeline/src/bundle/buildScripts';

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

    it('bundles a plugin installed from npm, sharing the one engine instance', async () => {
        // A plugin's runtime half is an ordinary dependency, but it has to reach
        // the same engine the game runs on: a copy bundled inside the package is a
        // second component registry, and its systems register into nothing.
        const proj = mkdtempSync(path.join(tmpdir(), 'estella-pkgruntime-'));
        try {
            const pkg = path.join(proj, 'node_modules', 'estella-plugin-demo');
            mkdirSync(path.join(pkg, 'runtime'), { recursive: true });
            writeFileSync(
                path.join(pkg, 'package.json'),
                JSON.stringify({ name: 'estella-plugin-demo', version: '1.0.0', type: 'module', main: 'runtime/index.js' }),
            );
            writeFileSync(
                path.join(pkg, 'runtime', 'index.js'),
                `import { defineComponent } from 'esengine';\n`
                    + `export const DemoService = defineComponent('DemoService', { level: 1 });\n`,
            );
            mkdirSync(path.join(proj, 'src'), { recursive: true });
            // The entry imports ONLY the package, so a surviving bare `esengine`
            // import can only have come from inside it.
            writeFileSync(
                path.join(proj, 'src', 'main.ts'),
                `import { DemoService } from 'estella-plugin-demo';\nvoid DemoService;\n`,
            );

            const res = await buildProjectScripts(proj);
            expect(res.errors).toEqual([]);
            expect(res.ok).toBe(true);
            const out = readFileSync(res.outputPath!, 'utf8');
            expect(out).toContain('DemoService'); // the package's code is IN the bundle
            expect(out).toMatch(/from\s*["']esengine["']/); // …and its engine import is not
        } finally {
            rmSync(proj, { recursive: true, force: true });
        }
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
