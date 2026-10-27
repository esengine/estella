// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  derivedTwin.mjs — a `.esshader` as the WebGPU backend needs it, with the WGSL twin derived from its GLSL when it carries none.
 *
 * The repo's own fixtures, examples and games keep only the GLSL they author. The generated twin is a translation of that GLSL joined to the
 * engine's own headers, so committing it meant every edit to an engine header changed dozens of files that no author had touched. Whatever hands
 * such a shader to the engine asks here instead, and gets the text the generator would have written.
 *
 * Needs a built engine (the translation assembles through it). Without one, or for a shader that cannot be translated, the text comes back as it
 * was and the shader runs where it ran before: on WebGL.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'gen-shader-twins.mjs')).href;

let generator = null;
let chain = Promise.resolve();
const memo = new Map();

/** `source`, plus its derived WGSL twin when it has none. Never throws. */
export function withDerivedTwin(source) {
    if (memo.has(source)) return memo.get(source);
    // One translation at a time: the engine module is shared and each translation owns a scratch directory.
    const done = chain.then(async () => {
        try {
            generator ??= await import(GENERATOR).then(async (gen) => ({ gen, module: await gen.loadTwinModule() }));
            return await generator.gen.withGeneratedTwin(generator.module, source);
        } catch (err) {
            console.warn('[derived-twin] left as authored:', err instanceof Error ? err.message.split('\n')[0] : String(err));
            return source;
        }
    });
    chain = done.then(() => undefined, () => undefined);
    memo.set(source, done);
    return done;
}
