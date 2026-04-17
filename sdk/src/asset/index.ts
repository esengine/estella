export {
    type AddressableAssetType,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
} from './AddressableManifest';
export { AsyncCache } from './AsyncCache';
export { Assets, AssetPlugin, assetPlugin, type AssetsData } from './AssetPlugin';
export { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
export { AssetRefCounter, type AssetRefInfo } from './AssetRefCounter';

export { Assets as AssetsImpl, type AssetsOptions, type AssetBundle, type SceneAssetResult, type MissingAsset } from './Assets';
export { type Backend, HttpBackend, EmbeddedBackend, type HttpBackendOptions } from './Backend';
export { Catalog, type CatalogData, type CatalogEntry, type AtlasFrameInfo } from './Catalog';
export {
    AssetRegistry,
    UUID_REF_PREFIX,
    UUID_V4_REGEX,
    isUuidRef,
    extractUuid,
    makeUuidRef,
    type AssetEntry,
    type AssetManifest,
} from './AssetRegistry';
export { type AssetLoader, type LoadContext, type TextureResult, type TextureResult as TextureInfo, type SpineResult, type SpineLoadResult, type MaterialResult, type FontResult, type AudioResult } from './AssetLoader';
export { SceneHandle } from './SceneHandle';
export {
    registerAssetFields, registerCompoundAssetFields,
    getAssetFields, getCompoundAssetFields,
    initBuiltinAssetFields,
    type AssetFieldType, type AssetFieldDescriptor, type CompoundFieldDescriptor,
} from './AssetFieldRegistry';
