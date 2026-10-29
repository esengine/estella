// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Scripts written for Cocos Creator build against the engine, in every bundle a project's scripts go into.
 *
 * Two things a Cocos script assumes that a plain bundle does not give it:
 *
 *   - `import { Component } from 'cc'` (and `'cc/env'` for its build flags). Both name the compatibility layer, `esengine/cocos`.
 *     The import is handed back to the bundler as that specifier, so it resolves however the build resolves `esengine/*`:
 *     left external for the page's import map, or aliased and inlined.
 *   - Legacy (`experimentalDecorators`) decorators, with fields assigned by the constructor rather than defined. Cocos scripts are
 *     written for that, the layer's `@ccclass` / `@property` have that signature, and esbuild's default for a file whose nearest
 *     tsconfig says nothing is the newer standard form, under which every decorator in the project would run with the wrong
 *     arguments. A Cocos project's own tsconfig usually extends a file the editor generates and the checkout lacks, so it cannot
 *     be relied on to say it.
 *
 * Only files that import `cc` are touched: a script that does not is not a Cocos script, and keeps whatever its own tsconfig says.
 * The project's files are read, never written.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { loadEsbuild } from './esbuildRuntime';

/** What `cc` and `cc/env` resolve to. */
export const COCOS_LAYER = 'esengine/cocos';

const CC = /^cc(\/env)?$/;
const IMPORTS_CC = /(?:from|import)\s*\(?\s*['"]cc(?:\/env)?['"]/;
const TS = /\.tsx?$/;

const RESOLVING = Symbol('cocos-compat:resolving');

export function cocosCompatPlugin(): Plugin {
  return {
    name: 'estella-cocos-compat',
    setup(build) {
      build.onResolve({ filter: CC }, async (args) => {
        if (args.pluginData === RESOLVING) return undefined;
        const layer = await build.resolve(COCOS_LAYER, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: RESOLVING,
        });
        if (layer.errors.length > 0) {
          return { errors: [{ text: `"${args.path}" is the Cocos Creator module, which the engine provides as "${COCOS_LAYER}" — and that did not resolve here: ${layer.errors[0]!.text}` }] };
        }
        return { path: layer.path, external: layer.external, sideEffects: layer.sideEffects };
      });

      build.onLoad({ filter: TS }, async (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        let source: string;
        try {
          source = await readFile(args.path, 'utf8');
        } catch {
          return undefined;
        }
        if (!IMPORTS_CC.test(source)) return undefined;
        const esbuild = await loadEsbuild();
        const out = await esbuild.transform(source, {
          loader: args.path.endsWith('x') ? 'tsx' : 'ts',
          sourcefile: args.path,
          sourcemap: 'inline',
          target: 'es2020',
          tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
        });
        return { contents: out.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}
