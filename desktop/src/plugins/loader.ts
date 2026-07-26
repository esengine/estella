// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  loader.ts
 * @brief Turns a compiled plugin's module text into its exported plugin object.
 *
 * The module arrives as CJS (see electron/pluginHost.ts) and is evaluated with an
 * injected `require` that resolves ONLY the host modules below. That is the whole
 * trick, and it buys three things an ESM + import-map loader would not:
 *
 *  - React (and the SDK) are the HOST's instances by construction, so a plugin
 *    panel can use hooks without the two-copies-of-React failure mode.
 *  - Loading is SYNCHRONOUS, which the contribution contracts need — a viewport
 *    tool's pointer handler and an inspector's build() cannot be async.
 *  - Reloading is just re-evaluating with a fresh module object: no import-map
 *    plumbing per window, no cache-busted URLs accumulating in a module graph,
 *    and identical behaviour in dev and in the packaged app.
 *
 * `new Function` needs `unsafe-eval`, which the editor's CSP already grants for
 * the engine's wasm glue — this adds no new privilege. Plugin AUTHORS never see
 * CJS: they write ESM TypeScript and esbuild converts it.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import * as esengine from 'esengine';
import * as editorApi from './api';
import type { EditorPlugin } from './types';

/**
 * The modules a plugin may import. A bare specifier outside this set is a load
 * error rather than a silent `undefined` — a plugin that quietly got nothing for
 * its import would fail later, somewhere unrelated.
 */
const HOST_MODULES: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': ReactJsxRuntime,
  '@estella/editor-api': editorApi,
  esengine,
};

/** Specifiers a plugin can import, for the error message and the docs. */
export const HOST_MODULE_NAMES = Object.keys(HOST_MODULES);

function hostRequire(specifier: string): unknown {
  const mod = HOST_MODULES[specifier];
  if (!mod) {
    throw new Error(
      `cannot import "${specifier}" — a plugin may only import ${HOST_MODULE_NAMES.join(', ')} ` +
        `(bundle anything else into your plugin)`,
    );
  }
  return mod;
}

/**
 * Evaluate `code` and return its default export as a plugin object. Throws with
 * the plugin's own error if the module body throws, or a clear diagnostic if it
 * doesn't export the expected shape.
 */
export function evaluatePlugin(id: string, code: string): EditorPlugin {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  // Named so a stack trace from inside the plugin points at the plugin, not at
  // an anonymous eval frame.
  const factory = new Function(
    'module',
    'exports',
    'require',
    `${code}\n//# sourceURL=estella-plugin:${id}`,
  ) as (m: typeof module, e: Record<string, unknown>, r: typeof hostRequire) => void;

  factory(module, module.exports, hostRequire);

  const exported = (module.exports.default ?? module.exports) as Partial<EditorPlugin>;
  if (!exported || typeof exported !== 'object') {
    throw new Error('plugin entry must default-export a plugin object (see definePlugin)');
  }
  if (typeof exported.activate !== 'function') {
    throw new Error('plugin entry default-exports an object with no `activate(ctx)` function');
  }
  return exported as EditorPlugin;
}
