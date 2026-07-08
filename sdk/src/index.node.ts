// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.node.ts
 * @brief   ESEngine SDK — Node entry point (authoritative game servers,
 *          headless tooling). Same engine wasm, same gameplay code, no
 *          presentation. Boot shape:
 *
 *            import { loadEsengineModule, createHeadlessApp, runHeadless, Net } from 'esengine/node';
 *            const module = await loadEsengineModule('./wasm');
 *            const app = createHeadlessApp(module);
 *            const server = app.getResource(Net).startServer();
 *            // accept sockets however the host likes → server.attachConnection(transport)
 *            runHeadless(app);
 */
import { setPlatform } from './platform';
import { nodeAdapter } from './platform/node';
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from './component';
import type { ESEngineModule } from './wasm';

setPlatform(nodeAdapter);

// Register every engine component (COMPONENT_META) so scenes never silently drop
// a component that exists in the engine but lacks a typed const.
ensureBuiltinComponentsRegistered();
markEngineComponentBaseline();

export * from './core';
export * from './webAppFactory';
export { nodeAdapter } from './platform/node';

/**
 * Load the engine wasm module from a directory holding the web build
 * artifacts (esengine.js + esengine.wasm) — the emscripten glue runs natively
 * under Node. `dir` is filesystem-relative to the process cwd.
 */
export async function loadEsengineModule(dir: string): Promise<ESEngineModule> {
    const { readFile } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const wasmBinary = await readFile(join(dir, 'esengine.wasm'));
    const glueUrl = pathToFileURL(resolve(join(dir, 'esengine.js'))).href;
    const factory = (await import(/* @vite-ignore */ glueUrl)).default;
    return await factory({ wasmBinary }) as ESEngineModule;
}
