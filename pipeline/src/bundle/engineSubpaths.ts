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
  'esengine/terrain': 'terrain/index.js',
  'esengine/timeline': 'timeline/index.js',
  'esengine/fx-basic': 'fx-basic/index.js',
  'esengine/fx-atmosphere': 'fx-atmosphere/index.js',
  'esengine/fx-lighting': 'fx-lighting/index.js',
  'esengine/foliage': 'foliage/index.js',
  'esengine/worldgen': 'worldgen/index.js',
  'esengine/water': 'water/index.js',
  'esengine/spline': 'spline/index.js',
  'esengine/character-shaders': 'character-shaders/index.js',
  'esengine/logic': 'logic/index.js',
  'esengine/debug-channel': 'debug-channel/index.js',
  'esengine/ai': 'ai/index.js',
  'esengine/replication': 'net/replication/index.js',
  'esengine/session': 'net/session/index.js',
  'esengine/gameplay': 'gameplay/index.js',
  'esengine/cocos': 'cocos/index.js',
  'esengine/dragonbones': 'dragonbones/index.js',
  'esengine/physics': 'physics/index.js',
  'esengine/physics3d': 'physics3d/index.js',
  'esengine/douyin': 'douyin/index.js',
  'esengine/kuaishou': 'kuaishou/index.js',
  'esengine/bilibili': 'bilibili/index.js',
  'esengine/quickgame': 'quickgame/index.js',
  'esengine/alipay': 'alipay/index.js',
  'esengine/huawei': 'huawei/index.js',
  'esengine/openpaas': 'openpaas/index.js',
  'esengine/wasm': 'wasm.js',
};

/**
 * Subpaths that are not modules a project picks: the engine binary every target
 * loads, a platform adapter an entry chooses rather than content asking for it,
 * the debug channel a development export adds, and the session layer, which a
 * game's own code imports and nothing in a scene asks for. Named here so the pickable set is derived rather than written twice.
 */
export const NOT_A_MODULE: ReadonlySet<string> = new Set(['esengine/wasm', 'esengine/debug-channel', 'esengine/session', 'esengine/cocos', 'esengine/douyin', 'esengine/kuaishou', 'esengine/bilibili', 'esengine/quickgame', 'esengine/alipay', 'esengine/huawei', 'esengine/openpaas']);

/** The modules a project can force in or refuse, as `features.modules` keys it. */
export const ENGINE_MODULES: readonly string[] =
  Object.keys(ESENGINE_SUBPATHS).filter((s) => !NOT_A_MODULE.has(s)).sort();
