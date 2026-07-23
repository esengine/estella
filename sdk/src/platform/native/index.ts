// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   The native platform barrel (embedded Dawn + JS engine, iOS/Android).
 *
 * Internal this round: reachable only via relative import (the mock-bridge test
 * harness). A public `esengine/native` bundle entry ships with the native shell,
 * once a real device + toolchain can verify it — see the native-platform campaign.
 */

export { NativePlatformAdapter, installNativePlatform } from './adapter';
export type { NativeBridge, NativeInputListener, NativeFetchResult } from './bridge';
