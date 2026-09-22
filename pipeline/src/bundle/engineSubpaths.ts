// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The `esengine/*` subpaths the SDK publishes, and which are modules.
 *
 * Its own module because of who reads it: the bundler's resolver, the export's
 * import map, and the editor's renderer — which cannot import anything that
 * touches `node:`. Deliberately node-free for that reason, like targetSupport.
 */

/** Specifier → the file under `sdk/dist` it resolves to. */
export const ESENGINE_SUBPATHS: Readonly<Record<string, string>> = {
  'esengine/spine': 'spine/index.js',
  'esengine/tilemap': 'tilemap/index.js',
  'esengine/logic': 'logic/index.js',
  'esengine/ai': 'ai/index.js',
  'esengine/replication': 'net/replication/index.js',
  'esengine/gameplay': 'gameplay/index.js',
  'esengine/dragonbones': 'dragonbones/index.js',
  'esengine/physics': 'physics/index.js',
  'esengine/physics3d': 'physics3d/index.js',
  'esengine/douyin': 'douyin/index.js',
  'esengine/wasm': 'wasm.js',
};

/**
 * Subpaths that are not modules a project picks: the engine binary every target
 * loads, and a platform adapter an entry chooses rather than content asking for
 * it. Named here so the pickable set is derived rather than written twice.
 */
const NOT_A_MODULE = new Set(['esengine/wasm', 'esengine/douyin']);

/** The modules a project can force in or refuse, as `features.modules` keys it. */
export const ENGINE_MODULES: readonly string[] =
  Object.keys(ESENGINE_SUBPATHS).filter((s) => !NOT_A_MODULE.has(s)).sort();
