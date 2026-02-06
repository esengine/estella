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
    type AssetManifest,
    type AssetBundle,
} from './AssetServer';
export { AsyncCache } from './AsyncCache';
export { Assets, AssetPlugin, assetPlugin, type AssetsData } from './AssetPlugin';
export { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
