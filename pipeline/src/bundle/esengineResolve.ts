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
 * The subpaths a game may import, and what each resolves to under the staged
 * SDK. ONE list: both strategies read it, and so does the import map — a second
 * hand-written copy is how a specifier the SDK never exported survived in both.
 * check-import-map.mjs holds it against the package.
 */
export const ESENGINE_SUBPATHS: Readonly<Record<string, string>> = {
  'esengine/spine': 'spine/index.js',
  'esengine/tilemap': 'tilemap/index.js',
  'esengine/logic': 'logic/index.js',
  'esengine/dragonbones': 'dragonbones/index.js',
  'esengine/physics': 'physics/index.js',
  'esengine/physics3d': 'physics3d/index.js',
  'esengine/douyin': 'douyin/index.js',
  'esengine/wasm': 'wasm.js',
};

/**
 * esbuild `alias` resolving `esengine` and its subpath exports to files under
 * `sdkDir`, for INLINED builds (the project root has no esengine to resolve from).
 * `mainEntry` picks the SDK build: 'index.js' (web SDK — web/playable) or
 * 'index.wechat.js' (the WeChat SDK).
 */
export function esengineAlias(sdkDir: string, mainEntry = 'index.js'): Record<string, string> {
  const out: Record<string, string> = { esengine: path.join(sdkDir, mainEntry) };
  for (const [specifier, rel] of Object.entries(ESENGINE_SUBPATHS)) {
    out[specifier] = path.join(sdkDir, ...rel.split('/'));
  }
  return out;
}
