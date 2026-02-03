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

export interface AssetsData {
    server: AssetServer;
}

export const Assets = defineResource<AssetsData>(
    { server: null! },
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

        const server = new AssetServer(module);
        app.insertResource(Assets, { server });
    }
}

export const assetPlugin = new AssetPlugin();
