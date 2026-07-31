// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { fileURLToPath } from 'node:url';
import { extractProjectSchemas, type ComponentSchema, type SchemasArtifact } from '../electron/extractSchemas';

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
            `}, {\n` +
            `  fields: {\n` +
            `    speed: { min: 0, max: 10, step: 0.1, slider: true, tooltip: 'Oscillation speed', label: 'Wave Speed', category: 'Motion' },\n` +
            `  },\n` +
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

    it('auto-derives keyframeable (animatable) fields for user components — numeric scalars + nested channels', async () => {
        const res = await extractProjectSchemas(root);
        const wave = byName(res.schemas, 'Wave')!;
        // amplitude/speed are top-level numbers; tint is a {r,g,b,a} color → channel paths.
        expect(wave.animatableFields).toContain('amplitude');
        expect(wave.animatableFields).toContain('speed');
        expect(wave.animatableFields).toContain('tint.r');
    });

    it('serializes user-component field metadata — range/tooltip/DisplayName/category (first-class, like builtins)', async () => {
        const res = await extractProjectSchemas(root);
        const wave = byName(res.schemas, 'Wave')!;
        expect(wave.fields?.speed).toMatchObject({
            min: 0,
            max: 10,
            step: 0.1,
            slider: true,
            tooltip: 'Oscillation speed',
            label: 'Wave Speed',
            category: 'Motion',
        });
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
        const onDisk = JSON.parse(readFileSync(res.outputPath!, 'utf8')) as SchemasArtifact;
        expect(onDisk.components).toEqual(res.schemas);
        expect(onDisk.actions).toEqual(res.actions);
        expect(onDisk.conditions).toEqual(res.conditions);
    });

    it('treats a missing DEFAULT declaration as a component-less project (empty artifact, ok)', async () => {
        const empty = mkdtempSync(path.join(tmpdir(), 'estella-schema-empty-'));
        try {
            const res = await extractProjectSchemas(empty);
            expect(res.ok).toBe(true);
            expect(res.schemas).toEqual([]);
            expect(res.outputPath).toBe(path.join(empty, '.esengine/cache/schemas.json'));
            expect(JSON.parse(readFileSync(res.outputPath!, 'utf8'))).toEqual({ components: [], actions: [], conditions: [] });
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });

    it('errors when an EXPLICITLY-declared entry is missing (required)', async () => {
        const empty = mkdtempSync(path.join(tmpdir(), 'estella-schema-req-'));
        try {
            const res = await extractProjectSchemas(empty, { entry: 'src/decls.ts', required: true });
            expect(res.ok).toBe(false);
            expect(res.outputPath).toBeNull();
            expect(res.errors.join(' ')).toMatch(/declaration entry not found/);
        } finally {
            rmSync(empty, { recursive: true, force: true });
        }
    });

    it('honors a custom declaration entry path', async () => {
        const proj = mkdtempSync(path.join(tmpdir(), 'estella-schema-custom-'));
        try {
            mkdirSync(path.join(proj, 'game'), { recursive: true });
            writeFileSync(
                path.join(proj, 'game', 'decls.ts'),
                `import { defineComponent } from 'esengine';\n` +
                    `export const Spin = defineComponent('Spin', { rpm: 33 });\n`,
            );
            const res = await extractProjectSchemas(proj, { entry: 'game/decls.ts' });
            expect(res.ok).toBe(true);
            expect(res.schemas.map((s) => s.name)).toEqual(['Spin']);
            expect(res.schemas[0].default).toEqual({ rpm: 33 });
        } finally {
            rmSync(proj, { recursive: true, force: true });
        }
    });

    // The extractor INLINES the SDK, so esbuild — a NATIVE subprocess — has to
    // READ esengine's dist. Packaged, extractSchemas.ts lives inside app.asar,
    // which Node reads through a patched fs but that subprocess cannot see into
    // at all: walking up from there resolved nothing, so EVERY shipped build
    // failed to resolve `esengine` and silently wrote no artifact — a project's
    // own components never reached Add Component. main.ts passes SDK_DIST (the
    // app.asar.unpacked twin) instead, the same alias the export pipelines use.
    describe('the SDK dist it inlines from', () => {
        const SDK_DIST = fileURLToPath(new URL('../node_modules/esengine/dist', import.meta.url));

        it('inlines esengine from an explicitly-given dist', async () => {
            const res = await extractProjectSchemas(root, { sdkDir: SDK_DIST });
            expect(res.errors).toEqual([]);
            expect(res.ok).toBe(true);
            expect(res.schemas.map((s) => s.name)).toEqual(['Marker', 'Wave']);
        });

        // The teeth: if the alias stops being wired in, resolution silently falls
        // back to walking up from this package — which works HERE and nowhere a
        // user runs the editor, which is exactly how the packaged break hid.
        it('resolves through that dist rather than walking up, so a bogus one fails', async () => {
            const res = await extractProjectSchemas(root, { sdkDir: path.join(root, 'no-such-sdk') });
            expect(res.ok).toBe(false);
            expect(res.errors.join(' ')).toMatch(/esengine|no-such-sdk/);
        });
    });

    // The palettes can only offer a game's own action names if they reach the
    // editor as data — the main realm never runs project code.
    describe('the project\'s registered actions', () => {
        let proj: string;

        beforeAll(() => {
            proj = mkdtempSync(path.join(tmpdir(), 'estella-schema-actions-'));
            mkdirSync(path.join(proj, 'src'), { recursive: true });
            writeFileSync(
                path.join(proj, 'src', 'components.ts'),
                `import { defineComponent, registerAction, registerCondition } from 'esengine';\n` +
                    `export const Score = defineComponent('Score', { points: 0 });\n` +
                    `registerAction('game.startRun', () => {});\n` +
                    `registerAction('game.award', {\n` +
                    `  params: [{ name: 'kind', type: 'enum', options: [{ label: 'Coin', value: 'coin' }] }, { name: 'amount', type: 'number' }],\n` +
                    `  run: () => {},\n` +
                    `});\n` +
                    `registerCondition('game.isBoss', () => false);\n`,
            );
        });
        afterAll(() => rmSync(proj, { recursive: true, force: true }));

        it('reports them with their declared parameters', async () => {
            const res = await extractProjectSchemas(proj);
            expect(res.ok).toBe(true);
            expect(res.actions.map((a) => a.name)).toEqual(['game.award', 'game.startRun']); // sorted
            expect(res.conditions).toEqual(['game.isBoss']);

            const award = res.actions.find((a) => a.name === 'game.award')!;
            expect(award.params).toEqual([
                { name: 'kind', type: 'enum', options: [{ label: 'Coin', value: 'coin' }] },
                { name: 'amount', type: 'number' },
            ]);
            // A parameterless action carries no empty arrays / default separator.
            expect(res.actions.find((a) => a.name === 'game.startRun')).toEqual({ name: 'game.startRun' });
        });

        it('reports the components alongside them, in one artifact', async () => {
            const res = await extractProjectSchemas(proj);
            expect(res.schemas.map((s) => s.name)).toEqual(['Score']);
            const onDisk = JSON.parse(readFileSync(res.outputPath!, 'utf8')) as SchemasArtifact;
            expect(onDisk.components.map((c) => c.name)).toEqual(['Score']);
            expect(onDisk.actions.map((a) => a.name)).toEqual(['game.award', 'game.startRun']);
        });

        it('reports only the PROJECT\'s names — engine builtins are the editor\'s own half', async () => {
            const res = await extractProjectSchemas(proj);
            for (const engineOwned of ['timeline.play', 'ui.setPage', 'fsm.fire']) {
                expect(res.actions.map((a) => a.name)).not.toContain(engineOwned);
            }
        });
    });
});
