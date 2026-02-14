/**
 * @file    index.ts
 * @brief   Asset module exports
 */

export {
    AssetServer,
    type TextureInfo,
    type SpineLoadResult,
    type SliceBorder,
    type SpineDescriptor,
    type FileLoadOptions,
    type AssetBundle,
    type AddressableAssetType,
    type AddressableResultMap,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
} from './AssetServer';
export { AsyncCache } from './AsyncCache';
export { Assets, AssetPlugin, assetPlugin, type AssetsData } from './AssetPlugin';
export { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';

import type { App } from '../app';
import { Assets } from './AssetPlugin';

export function registerEmbeddedAssets(app: App, assets: Record<string, string>): void {
    const assetServer = app.getResource(Assets);
    if (assetServer) {
        assetServer.registerEmbeddedAssets(assets);
    }
}
