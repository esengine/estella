// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One source of truth for resolving the `esengine` SDK across every export
 *        pipeline. There are two strategies, and they must agree on the same set
 *        of subpath exports (mirrors sdk/package.json "exports"):
 *
 *          EXTERNAL (web / desktop) — esengine stays external, resolved at runtime
 *            by the page import map. The runtime side of this map lives in
 *            buildPlayRealm.IMPORT_MAP; keep the subpath set there in sync.
 *          ALIASED + INLINED (wechat / playable) — no import map, so the bundle
 *            inlines the SDK; esbuild `alias` points esengine (+ subpaths) at dist.
 */
import path from 'node:path';

/** esengine left external (web / desktop import-map builds). */
export const ESENGINE_EXTERNAL = ['esengine', 'esengine/*'];

/**
 * esbuild `alias` resolving `esengine` and its subpath exports to files under
 * `sdkDir`, for INLINED builds (the project root has no esengine to resolve from).
 * `mainEntry` picks the SDK build: 'index.js' (web SDK — web/playable) or
 * 'index.wechat.js' (the WeChat SDK).
 */
export function esengineAlias(sdkDir: string, mainEntry = 'index.js'): Record<string, string> {
  return {
    esengine: path.join(sdkDir, mainEntry),
    'esengine/spine': path.join(sdkDir, 'spine', 'index.js'),
    'esengine/physics': path.join(sdkDir, 'physics', 'index.js'),
    'esengine/wasm': path.join(sdkDir, 'wasm.js'),
    'esengine/factory': path.join(sdkDir, 'webAppFactory.js'),
  };
}
