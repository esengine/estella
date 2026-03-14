import type { App, Plugin } from '../app';
import { defineResource } from '../resource';
import { AssetServer } from './AssetServer';
import { Assets as AssetsImpl } from './Assets';
import { HttpBackend } from './Backend';
import { initBuiltinAssetFields } from './AssetFieldRegistry';

export type AssetsData = AssetServer;

export const Assets = defineResource<AssetsData>(
    null!,
    'Assets'
);

export const AssetsV2 = defineResource<AssetsImpl>(
    null!,
    'AssetsV2'
);

export class AssetPlugin implements Plugin {
    build(app: App): void {
        const module = app.wasmModule;
        if (!module) {
            console.warn('AssetPlugin: No WASM module available');
            return;
        }

        initBuiltinAssetFields();

        const assetServer = new AssetServer(module);
        app.insertResource(Assets, assetServer);

        const assets = AssetsImpl.create({
            backend: new HttpBackend({ baseUrl: assetServer.baseUrl ?? '' }),
            module,
        });
        app.insertResource(AssetsV2, assets);
    }
}

export const assetPlugin = new AssetPlugin();
