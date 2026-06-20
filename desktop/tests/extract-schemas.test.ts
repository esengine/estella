/**
 * @file  Project schema extractor (REARCH_EDITOR_REALM Phase P2).
 *        A pure-node, zero-wasm step: bundle a project's declaration module,
 *        run its defineComponent side effects in a fresh AppContext, and
 *        serialize the field schema of ONLY the project's own components —
 *        excluding C++ builtins (Sprite/…) and the SDK's own defineComponent
 *        ones (Name/SceneOwner/…).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractProjectSchemas, type ComponentSchema } from '../electron/extractSchemas';

let root: string;

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'estella-schema-proj-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    // A project's DECLARATION module: only defineComponent/defineTag, no startup.
    writeFileSync(
        path.join(root, 'src', 'components.ts'),
        `import { defineComponent, defineTag } from 'esengine';\n` +
            `export const Wave = defineComponent('Wave', {\n` +
            `  amplitude: 1,\n` +
            `  speed: 2.5,\n` +
            `  tint: { r: 1, g: 0, b: 0, a: 1 },\n` +
            `});\n` +
            `export const Marker = defineTag('Marker');\n`,
    );
});

afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
});

const byName = (schemas: ComponentSchema[], name: string) => schemas.find((s) => s.name === name);

describe('extractProjectSchemas (P2)', () => {
    it('extracts the project component field schemas to .esengine/cache/schemas.json', async () => {
        const res = await extractProjectSchemas(root);
        expect(res.errors).toEqual([]);
        expect(res.ok).toBe(true);
        expect(res.outputPath).toBe(path.join(root, '.esengine/cache/schemas.json'));
        expect(existsSync(res.outputPath!)).toBe(true);

        const wave = byName(res.schemas, 'Wave');
        expect(wave).toBeDefined();
        expect(wave!.isTag).toBe(false);
        expect(wave!.default).toEqual({ amplitude: 1, speed: 2.5, tint: { r: 1, g: 0, b: 0, a: 1 } });
        // {r,g,b,a} default is detected as a color field:
        expect(wave!.colorKeys).toContain('tint');

        const marker = byName(res.schemas, 'Marker');
        expect(marker).toBeDefined();
        expect(marker!.isTag).toBe(true);
        expect(marker!.default).toEqual({});
    });

    it('excludes C++ builtins and the SDK\'s own defineComponent components', async () => {
        const res = await extractProjectSchemas(root);
        const names = res.schemas.map((s) => s.name).sort();
        expect(names).toEqual(['Marker', 'Wave']); // ONLY the project's, nothing else
        // sanity: none of the engine-provided ones leaked in
        for (const builtin of ['Sprite', 'Transform', 'Name', 'SceneOwner', 'PostProcessVolume', 'Disabled']) {
            expect(names).not.toContain(builtin);
        }
    });

    it('the written JSON matches the returned schemas (the artifact is the source of truth)', async () => {
        const res = await extractProjectSchemas(root);
        const onDisk = JSON.parse(readFileSync(res.outputPath!, 'utf8')) as ComponentSchema[];
        expect(onDisk).toEqual(res.schemas);
    });

    it('reports a clean failure when the declaration entry is missing', async () => {
        const empty = mkdtempSync(path.join(tmpdir(), 'estella-schema-empty-'));
        try {
            const res = await extractProjectSchemas(empty);
            expect(res.ok).toBe(false);
            expect(res.outputPath).toBeNull();
            expect(res.schemas).toEqual([]);
            expect(res.errors.join(' ')).toMatch(/declaration entry not found/);
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });
});
