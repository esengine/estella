/**
 * @file    wasm.ts
 * @brief   Plugin for connecting to C++ WASM module
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import type { ESEngineModule, CppApp, CppRegistry, CppResourceManager } from '../../wasm/types';
import { App, Plugin } from '../app';
import { defineResource, ResourceDef } from '../resource';
import { AssetLoader } from '../../assets/AssetLoader';

// =============================================================================
// WASM Resources
// =============================================================================

export interface WasmModuleData {
    module: ESEngineModule;
    cppApp: CppApp;
    resourceManager: CppResourceManager;
    assetLoader: AssetLoader;
}

export const WasmModule = defineResource<WasmModuleData | null>(null, 'WasmModule');

export const Assets = defineResource<AssetLoader | null>(null, 'Assets');

// =============================================================================
// WASM Plugin Options
// =============================================================================

export interface WasmPluginOptions {
    module: ESEngineModule;
    config?: {
        title?: string;
        width?: number;
        height?: number;
        vsync?: boolean;
    };
}

// =============================================================================
// WASM Plugin
// =============================================================================

export function createWasmPlugin(options: WasmPluginOptions): Plugin {
    return {
        build(app: App): void {
            const { module, config } = options;

            let cppApp: CppApp;
            if (config) {
                const cppConfig = new module.AppConfig();
                cppConfig.title = config.title ?? 'ESEngine';
                cppConfig.width = config.width ?? 800;
                cppConfig.height = config.height ?? 600;
                cppConfig.vsync = config.vsync ?? true;
                cppApp = module.createAppWithConfig(cppConfig);
            } else {
                cppApp = module.createApp();
            }

            const cppRegistry = cppApp.registry();
            const resourceManager = new module.ResourceManager();
            resourceManager.init();

            const assetLoader = new AssetLoader(module, resourceManager);

            app.connectCpp(
                cppRegistry as unknown as import('../world').CppRegistry,
                module.HEAPU8.buffer as ArrayBuffer
            );

            app.insertResource(WasmModule, {
                module,
                cppApp,
                resourceManager,
                assetLoader
            });

            app.insertResource(Assets, assetLoader);
        }
    };
}

// =============================================================================
// Helper Functions
// =============================================================================

export async function loadWasmModule(path: string): Promise<ESEngineModule> {
    const createModule = (await import(path)).default as () => Promise<ESEngineModule>;
    return createModule();
}
