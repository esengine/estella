// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.native.ts
 * @brief   ESEngine SDK — native entry point (embedded Dawn + JS engine on
 *          iOS/Android; NOT a WebView). The same engine wasm + TS SDK runs on a
 *          host JavaScriptCore / V8 / Hermes; the C++ renderer binds to a native
 *          WebGPU surface via `{ kind: 'webgpu' }` (see RenderSurfaceSource).
 *
 *          Unlike the web/node/wechat entries, this one does NOT auto-install a
 *          platform: there is no platform until the native shell injects its
 *          {@link NativeBridge}. Boot shape:
 *
 *            import { installNativePlatform, createWebApp } from 'esengine/native';
 *            installNativePlatform(bridge);   // shell provides fs/fetch/input/…
 *            const module = await instantiateEngineWasm(bridge);   // shell-owned
 *            const app = createWebApp(module, {
 *              renderSurface: { kind: 'webgpu' },   // Dawn device set on the module factory
 *            });
 *
 * @beta   Pre-1.0: the native host is unshipped; this entry's shape (and the
 *         NativeBridge contract) will change as the shell lands.
 */
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from './component';
import { ensureBuiltinAiRegistrations } from './ai/builtins';

// No setPlatform here — the shell calls installNativePlatform(bridge) at boot.
// Register every engine component / AI name up front so a scene can never silently
// drop one, and snapshot the baseline against a later project hot-reload.
ensureBuiltinComponentsRegistered();
ensureBuiltinAiRegistrations();
markEngineComponentBaseline();

export * from './core';
export * from './webAppFactory';

export { NativePlatformAdapter, installNativePlatform } from './platform/native';
export type { NativeBridge, NativeInputListener, NativeFetchResult } from './platform/native';

// Fast-path memory backend for the native core. The shell builds one over its
// host-injected `es_<Component>_buffer` bindings and passes it to the bridge
// (BuiltinBridge.connect's `memory` option), so the real SDK component API reads
// and writes native ECS memory through the same generated ptrAccessors as web.
export { NativeMemoryProvider } from './ecs/memoryProvider';
export type { MemoryProvider, ComponentHeap, NativeComponentBufferFn } from './ecs/memoryProvider';

// ABI layout hash of the component schema this bundle was generated from — the
// native shell compares it against the wasm build it loads (same as the editor).
export { ABI_LAYOUT_HASH } from './component.generated';
