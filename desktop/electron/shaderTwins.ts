// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shaderTwins.ts — editor-side GLSL→WGSL twin generation on project open.
 *
 * A `.esshader` authored in GLSL only fails to compile on the WebGPU backend
 * (no WGSL twin). Rather than make authors run `tools/gen-shader-twins.mjs` by
 * hand, the editor generates the twin for any twin-less project shader when the
 * project opens — GLSL stays the single authored source, the WGSL twin is a
 * generated derivative written back beside it, and both the editor viewport and
 * the exported game render on WebGPU with no author action.
 *
 * The converter pipeline (vendored glslang + naga wasm, driven through the engine
 * wasm's `esshader_cookInfo`) is Node-only — naga runs under `node:wasi` — so it
 * lives here in the main process. The generator module is imported at runtime by
 * absolute path so the vite-electron bundler leaves it (and its wasm) external.
 *
 * Dev-only for now: the vendored converters are not yet staged into a packaged
 * app, so a packaged editor skips generation (a shipped project's shaders are
 * expected to carry committed twins, enforced by the CI twin-coverage guard).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Recursively collect `.esshader` files under `dir` (skips dot-dirs like
 *  `.esengine` staging and `node_modules`). */
async function findEsshaders(dir: string, out: string[] = []): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await findEsshaders(full, out);
        else if (e.name.endsWith('.esshader')) out.push(full);
    }
    return out;
}

interface TwinGenerator {
    loadTwinModule(): Promise<{ esshader_cookInfo(source: string, features: string): unknown }>;
    processFile(
        module: unknown,
        file: string,
        opts: { check?: boolean; force?: boolean },
    ): Promise<{ file: string; status: string }>;
}

/**
 * Ensure every twin-less project `.esshader` gets a generated WGSL twin. The
 * cheap string scan runs first, so a project whose shaders already carry twins
 * (or have none) costs one directory walk and never loads the heavy engine +
 * converter wasm. A shader using `#pragma switch` is left alone — its
 * per-permutation twins can't be auto-generated (it must hand-author them).
 *
 * Never throws: a converter failure on one shader is logged and skipped so it
 * can't block project open. Returns what happened for logging/telemetry.
 */
export async function ensureProjectShaderTwins(
    root: string,
    repoRoot: string,
): Promise<{ generated: string[]; failed: string[]; skipped: string[] }> {
    const result = { generated: [] as string[], failed: [] as string[], skipped: [] as string[] };

    const files = await findEsshaders(root);
    const needy: string[] = [];
    for (const f of files) {
        const src = await readFile(f, 'utf8').catch(() => '');
        if (src.includes('#pragma fragment wgsl')) continue; // already has a twin
        if (src.includes('#pragma switch')) { result.skipped.push(f); continue; }
        needy.push(f);
    }
    if (needy.length === 0) return result;

    let gen: TwinGenerator;
    try {
        const url = pathToFileURL(path.join(repoRoot, 'tools', 'gen-shader-twins.mjs')).href;
        gen = (await import(url)) as unknown as TwinGenerator;
    } catch (err) {
        console.warn('[shader-twins] generator unavailable — skipping', err);
        return result;
    }

    const module = await gen.loadTwinModule();
    for (const f of needy) {
        try {
            const r = await gen.processFile(module, f, {});
            if (r.status === 'generated') result.generated.push(f);
            else if (r.status === 'skipped-switches') result.skipped.push(f);
        } catch (err) {
            result.failed.push(f);
            console.warn(`[shader-twins] generation failed for ${path.relative(root, f)} —`,
                err instanceof Error ? err.message : String(err));
        }
    }
    return result;
}
