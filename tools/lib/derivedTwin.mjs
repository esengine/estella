// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  derivedTwin.mjs — a `.esshader` as the WebGPU backend needs it.
 *
 * A shader is written in GLSL. Where the engine draws through WebGPU it gives a shader's GLSL its WGSL as the shader compiles
 * (esengine/wgsl), so a source that transpiler can write is handed on AS IT IS: no WGSL is written into it, and an edit to an engine
 * header reaches it the next time it compiles. Only a source that transpiler refuses is given a twin here, by the older route —
 * glslang and naga through a built engine — joined to the engine's headers.
 *
 * Without the SDK's source to ask (a packaged editor), every source takes the older route. Without a built engine, or for a shader
 * neither route can translate, the text comes back as it was and the shader runs where it ran before: on WebGL.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR = pathToFileURL(path.resolve(HERE, '..', 'gen-shader-twins.mjs')).href;

let generator = null;
/** The SDK's transpiler (withWgslTwin), null where its source is not to hand. */
let transpiler;
let chain = Promise.resolve();
const memo = new Map();

async function loadTranspiler() {
    try {
        const { importSdkSource } = await import(pathToFileURL(path.join(HERE, 'sdkSource.mjs')).href);
        return await importSdkSource('shaders/wgsl/twin.ts');
    } catch {
        return null;
    }
}

/** `source`, plus a derived WGSL twin when it has none and the runtime's transpiler cannot write one. Never throws. */
export function withDerivedTwin(source) {
    if (memo.has(source)) return memo.get(source);
    // One translation at a time: the engine module is shared and each translation owns a scratch directory.
    const done = chain.then(async () => {
        try {
            if (transpiler === undefined) transpiler = await loadTranspiler();
            // What the runtime will write as the shader compiles is not written here: the source stays the one its author wrote.
            if (transpiler && transpiler.withWgslTwin(source) !== source) return source;
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
