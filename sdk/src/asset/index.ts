export {
    AssetServer,
    type TextureInfo,
    type SpineLoadResult,
    type SliceBorder,
    type SpineDescriptor,
    type FileLoadOptions,
    type AssetBundle as LegacyAssetBundle,
    type AddressableAssetType,
    type AddressableResultMap,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
} from './AssetServer';
export { AsyncCache } from './AsyncCache';
export { Assets, AssetPlugin, assetPlugin, type AssetsData } from './AssetPlugin';
export { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
export { AssetRefCounter, type AssetRefInfo } from './AssetRefCounter';

export { Assets as AssetsImpl, type AssetsOptions, type AssetBundle, type SceneAssetResult } from './Assets';
export { type Backend, HttpBackend, EmbeddedBackend, type HttpBackendOptions } from './Backend';
export { Catalog, type CatalogData, type CatalogEntry, type AtlasFrameInfo } from './Catalog';
export { type AssetLoader, type LoadContext, type TextureResult, type SpineResult, type MaterialResult, type FontResult, type AudioResult } from './AssetLoader';
export { SceneHandle } from './SceneHandle';
export {
    registerAssetFields, registerCompoundAssetFields,
    getAssetFields, getCompoundAssetFields,
    initBuiltinAssetFields,
    type AssetFieldType, type AssetFieldDescriptor, type CompoundFieldDescriptor,
} from './AssetFieldRegistry';
