/**
 * @file    AssetPlugin.ts
 * @brief   Plugin that provides asset loading capabilities
 */

import type { App, Plugin } from '../app';
import { defineResource } from '../resource';
import { AssetServer } from './AssetServer';

// =============================================================================
// Assets Resource
// =============================================================================

export type AssetsData = AssetServer;

export const Assets = defineResource<AssetsData>(
    null!,
    'Assets'
);

// =============================================================================
// Asset Plugin
// =============================================================================

export class AssetPlugin implements Plugin {
    build(app: App): void {
        const module = app.wasmModule;
        if (!module) {
            console.warn('AssetPlugin: No WASM module available');
            return;
        }

        app.insertResource(Assets, new AssetServer(module));
    }
}

export const assetPlugin = new AssetPlugin();
