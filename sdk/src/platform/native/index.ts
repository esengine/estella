// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   The native platform barrel (embedded Dawn + JS engine, iOS/Android).
 *
 * Surfaced publicly through the `esengine/native` entry (`src/index.native.ts`).
 * @beta until a real device + toolchain verifies the shell — see the
 * native-platform campaign.
 */

export { NativePlatformAdapter, installNativePlatform } from './adapter';
export type { NativeBridge, NativeInputListener, NativeFetchResult } from './bridge';
export { createHostBridge } from './hostBridge';
export { assertHostEnvironment, assertNativeHost } from './hostEnvironment';
export type { NativeHostBindings } from './hostBridge';
