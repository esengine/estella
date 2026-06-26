// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project script-entry convention (REARCH_EDITOR_REALM Phase P3).
 *
 * The manifest's `scripts.register` / `scripts.main` (with defaults) name the
 * declaration vs startup modules; this is what lets the editor extract a schema
 * from the declaration WITHOUT executing startup. Also verifies the extractor
 * against REAL example projects (copied to a tmp dir so nothing is written into
 * the repo), proving they already follow declaration/startup separation.
 */
import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseManifest, resolveScripts, DEFAULT_SCRIPTS } from '../src/project/format';
import { extractProjectSchemas } from '../electron/extractSchemas';

const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url));

/** Extract from a throwaway copy of an example's src — never touch the repo. */
async function extractExample(name: string) {
    const tmp = mkdtempSync(path.join(tmpdir(), `estella-ex-${name}-`));
    try {
        cpSync(path.join(EXAMPLES, name, 'src'), path.join(tmp, 'src'), { recursive: true });
        return await extractProjectSchemas(tmp);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

describe('manifest scripts convention (P3)', () => {
    it('defaults to src/components.ts + src/main.ts when unspecified', () => {
        expect(resolveScripts({})).toEqual(DEFAULT_SCRIPTS);
        expect(resolveScripts({ scripts: {} })).toEqual({ register: 'src/components.ts', main: 'src/main.ts' });
    });

    it('parses + overlays scripts.register / scripts.main', () => {
        const m = parseManifest({ name: 'x', scripts: { register: 'game/decls.ts' } });
        expect(m.scripts).toEqual({ register: 'game/decls.ts' });
        expect(resolveScripts(m)).toEqual({ register: 'game/decls.ts', main: 'src/main.ts' });
    });

    it('ignores a non-object or empty scripts block (stays on the defaults)', () => {
        expect(parseManifest({ name: 'x', scripts: 'nope' }).scripts).toBeUndefined();
        expect(parseManifest({ name: 'x', scripts: {} }).scripts).toBeUndefined();
    });
});

describe('extraction against real examples (declaration/startup separation)', () => {
    it('extracts space-shooter project components from its src/components.ts', async () => {
        const res = await extractExample('space-shooter');
        expect(res.ok).toBe(true);
        const names = res.schemas.map((s) => s.name);
        expect(names).toEqual(expect.arrayContaining(['Player', 'Enemy', 'Bullet', 'Health']));
        // a defineTag stays a tag:
        expect(res.schemas.find((s) => s.name === 'ScoreDisplay')?.isTag).toBe(true);
        // engine builtins never leak into the project schema:
        expect(names).not.toContain('Sprite');
        expect(names).not.toContain('Transform');
    });

    it('a component-less example (no src/components.ts) yields an empty schema set', async () => {
        const res = await extractExample('particle-demo');
        expect(res.ok).toBe(true);
        expect(res.schemas).toEqual([]);
    });
});
