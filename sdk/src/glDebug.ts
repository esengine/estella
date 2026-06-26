// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glDebug.ts
 * @brief   GL error checking API for debugging rendering issues
 */

import type { ESEngineModule } from './wasm';
import { CoreApiBridge } from './CoreApiBridge';

const bridge = new CoreApiBridge('glDebug');
let module: ESEngineModule | null = null;

export function initGLDebugAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
}

export function shutdownGLDebugAPI(): void {
    bridge.disconnect();
    module = null;
}

export const GLDebug = {
    enable(): void {
        module?.gl_enableErrorCheck(true);
    },

    disable(): void {
        module?.gl_enableErrorCheck(false);
    },

    check(context: string): number {
        return module?.gl_checkErrors(context) ?? 0;
    },

    diagnose(): void {
        module?.renderer_diagnose();
    },
};
