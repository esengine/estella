// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsBridge.ts
 * @brief   Physics subsystem's bridge to its WASM module.
 *
 * @details The physics module is loaded standalone (its own emscripten runtime
 *          with its own `onAbort`), so the bridge's health module is the module
 *          itself. All `_physics_*` calls made through `bridge.module` inherit
 *          the terminal-abort guard for free — closing the gap where physics
 *          previously called straight into a possibly-dead module.
 */

import { WasmBridge } from '../WasmBridge';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';

export class PhysicsBridge extends WasmBridge<PhysicsWasmModule> {
    protected readonly label = 'physics';
}
