/**
 * @file    index.ts
 * @brief   Editor types exports
 */

export {
    type SceneData,
    type EntityData,
    type ComponentData,
    type SelectionState,
    type ViewportState,
    createEmptyScene,
    createEntityData,
} from './SceneTypes';

export {
    type SliceBorder,
    type TextureMetadata,
    createDefaultSliceBorder,
    createDefaultTextureMetadata,
    hasSlicing,
    getMetaFilePath,
    parseTextureMetadata,
    serializeTextureMetadata,
} from './TextureMetadata';

export {
    type BuildPlatform,
    type PlatformInfo,
    type PlayableSettings,
    type WeChatSettings,
    type BuildConfig,
    type BuildSettings,
    PLATFORMS,
    createDefaultPlayableSettings,
    createDefaultWeChatSettings,
    createDefaultBuildConfig,
    createDefaultBuildSettings,
} from './BuildTypes';
