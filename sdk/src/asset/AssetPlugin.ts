import type { App, Plugin } from '../app';
import { defineResource } from '../resource';
import { Assets as AssetsClass } from './Assets';
import { HttpBackend } from './Backend';
import { initBuiltinAssetFields } from './AssetFieldRegistry';

export type AssetsData = AssetsClass;

export const Assets = defineResource<AssetsData>(
    null!,
    'Assets'
);

export class AssetPlugin implements Plugin {
    name = 'asset';

    build(app: App): void {
        const module = app.wasmModule;
        if (!module) {
            console.warn('AssetPlugin: No WASM module available');
            return;
        }

        initBuiltinAssetFields();

        const assets = AssetsClass.create({
            backend: new HttpBackend({ baseUrl: '' }),
            module,
        });
        app.insertResource(Assets, assets);
    }
}

export const assetPlugin = new AssetPlugin();
