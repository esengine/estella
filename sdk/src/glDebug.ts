/**
 * @file    glDebug.ts
 * @brief   GL error checking API for debugging rendering issues
 */

import type { ESEngineModule } from './wasm';

let module: ESEngineModule | null = null;

export function initGLDebugAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
}

export function shutdownGLDebugAPI(): void {
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
