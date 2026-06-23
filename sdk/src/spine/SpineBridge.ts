// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineBridge.ts
 * @brief   Spine's bridges to its two WASM surfaces.
 *
 * @details Each spine version runs in its own standalone side module
 *          (3.8 / 4.1 / 4.2), guarded through {@link WasmBridge} so every call
 *          inherits the terminal-abort guard. (There is no native spine runtime
 *          in the core module any more — spine is fully side-module.)
 */

import { WasmBridge } from '../WasmBridge';
import type { SpineWrappedAPI } from './SpineModuleLoader';

/**
 * Guards a version-specific spine side module's wrapped API. The call surface
 * (`SpineWrappedAPI`, all functions) is guarded; its abort-authoritative module
 * is the raw side module, which owns the heap, allocator, and `onAbort`.
 */
export class SpineModuleBridge extends WasmBridge<SpineWrappedAPI> {
    protected readonly label = 'spine';
}
