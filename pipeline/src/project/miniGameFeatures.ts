// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What each mini-game host can take beyond the family's floor, in one place.
 *
 * The export profiles (export/miniGameExportProfile.ts) act on these, and the
 * editor reads them to decide which packaging options a target's page offers.
 * Two copies of the answer is how a host got an option its export ignored, or
 * an export ability no page let anyone turn on. Pure data with no Node import,
 * so the editor's renderer reads the same table the export does.
 *
 * A feature is listed for a host only on that host's published documentation or
 * on a device: a package that builds clean and never boots is the cost of a
 * guess.
 */
import type { MiniGamePlatform } from './platforms';

export type MiniGameFeature =
  /** The loader takes a brotli `.wasm.br` path, so the package can ship the engine compressed (`packaging.compressWasm`). */
  | 'compressWasm'
  /** The host loads subpackages by name, so the engine binary can move out of the main package (`packaging.engineSubpackage`). */
  | 'engineSubpackage'
  /** WeChat's EmscriptenGLX: GL calls batched inside the wasm (`platforms.wechat.emscriptenGLX`). */
  | 'emscriptenGLX'
  /** The host starts a worker from a package directory, so the engine's jobs run off the main thread. */
  | 'workers';

const FEATURES: Readonly<Record<MiniGamePlatform, readonly MiniGameFeature[]>> = {
  // WXWebAssembly takes `.wasm.br` from base library 2.14.0; wx.createWorker with game.json `workers`; wx.loadSubpackage.
  wechat: ['compressWasm', 'engineSubpackage', 'emscriptenGLX', 'workers'],
  // TTWebAssembly takes a package `.wasm.br` path from base library 3.7.0.0 (mini-game/develop/framework/basic-function/web-assembly);
  // tt.loadSubpackage with game.json `subPackages`. Not workers: tt.createWorker allows ONE worker and documents a message only as
  // "a serializable object", which the engine's job pool is not.
  douyin: ['compressWasm', 'engineSubpackage'],
  kuaishou: ['engineSubpackage'],
  bilibili: ['engineSubpackage'],
  quickgame: ['engineSubpackage'],
  alipay: ['engineSubpackage'],
  huawei: ['engineSubpackage'],
};

/** Whether a built-in mini-game host takes `feature`. A platform outside the family takes none of them. */
export function hasMiniGameFeature(platform: string, feature: MiniGameFeature): boolean {
  return (FEATURES as Readonly<Record<string, readonly MiniGameFeature[]>>)[platform]?.includes(feature) ?? false;
}

/** The built-in mini-game hosts that take `feature`, in the family's order. */
export function miniGamePlatformsWith(feature: MiniGameFeature): MiniGamePlatform[] {
  return (Object.keys(FEATURES) as MiniGamePlatform[]).filter((p) => FEATURES[p].includes(feature));
}
