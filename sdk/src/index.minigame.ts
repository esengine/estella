// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.minigame.ts
 * @brief   ESEngine SDK — mini-game family entry point, for a vendor the engine
 *          does not ship (or one you are bringing up yourself).
 *
 *          Unlike `esengine/wechat`, this entry does NOT auto-install a
 *          platform: there is no host until you name one. Boot shape:
 *
 *            import {
 *              installMiniGamePlatform, initMiniGameRuntime,
 *            } from 'esengine/minigame';
 *
 *            const profile = {
 *              id: 'myvendor',
 *              hostLabel: 'MyVendor',
 *              get global() { return myHostGlobal; },   // wx-shaped host API
 *            };
 *            installMiniGamePlatform(profile);
 *            await initMiniGameRuntime({
 *              engineFactory, engineWasmPath: 'wasm/esengine.wasm',
 *              sceneNames, firstScene, sideModuleFactories,
 *            });
 *
 *          The profile is DATA. Audio, sockets, video, fs, fetch, canvas, input,
 *          storage and subpackages all come from the normalized host global, so
 *          a vendor whose API matches WeChat's shape and whose wasm is standard
 *          `WebAssembly` writes no methods at all. Override `instantiateWasm`
 *          only if the host insists on its own loader (as WeChat does).
 *
 * @beta    Pre-1.0: the profile contract may still gain fields as vendors beyond
 *          WeChat are brought up against real devices.
 */
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from './ecs/component';
import { ensureBuiltinAiRegistrations } from './ai/builtins';

// No setPlatform here — the game calls installMiniGamePlatform(profile) at boot.
// Register every engine component / AI name up front so a scene can never
// silently drop one, and snapshot the baseline against a later hot-reload.
ensureBuiltinComponentsRegistered();
ensureBuiltinAiRegistrations();
markEngineComponentBaseline();

export * from './core';
export * from './runtime/webAppFactory';

// The family platform: describe the host as data, install, done.
export { MiniGamePlatformAdapter, installMiniGamePlatform } from './platform/minigame';
export type {
    MiniGameProfile,
    MiniGameVendor,
    MiniGameGlobal,
    MiniGameCanvas,
    MiniGameImage,
    MiniGameFileSystemManager,
    MiniGameRequestOptions,
    MiniGameSystemInfo,
    MiniGameTouch,
    MiniGameTouchEvent,
    MiniGameKeyEvent,
    MiniGameStorageInfo,
    MiniGameInnerAudioContext,
    MiniGameSocketTask,
} from './platform/minigame';

// The boot the exporter's generated game.js calls.
export { initMiniGameRuntime, type MiniGameRuntimeConfig } from './runtime/miniGameRuntime';

// The family backends, exported so a profile can wrap or replace one rather than
// write it from scratch.
export { MiniGameAudioBackend } from './audio/MiniGameAudioBackend';
export { MiniGameSocket } from './net/MiniGameSocket';
export { createMiniGameSideModuleHost, type MiniGameSideModuleFactories } from './sideModules';
