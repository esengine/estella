/**
 * @file    core-content.ts
 * @brief   Content surface: scenes, prefabs, assets, animation, audio,
 *          particles, tilemap, physics types.
 *
 * "Content" == data that flows in through the editor + loaders (scenes,
 * prefabs, asset files, anim clips, audio, tilemap source) and the
 * matching runtime APIs. Physics is included because the plugin types
 * are part of the scene/component data surface.
 *
 * Re-exported wholesale by `core.ts`.
 */

// =============================================================================
// Asset Types Registry
// =============================================================================

export {
    type AssetContentType,
    type AddressableAssetType,
    type EditorAssetType,
    type AssetTypeEntry,
    type AssetBuildTransform,
    getAssetTypeEntry,
    getEditorType,
    getAddressableType,
    getAddressableTypeByEditorType,
    isKnownAssetExtension,
    getAllAssetExtensions,
    looksLikeAssetPath,
    getCustomExtensions,
    getWeChatPackOptions,
    getAssetMimeType,
    isCustomExtension,
    toBuildPath,
    registerAssetBuildTransform,
    getAssetBuildTransform,
} from './assetTypes';

// =============================================================================
// Asset
// =============================================================================

export {
    AsyncCache,
    Assets,
    AssetPlugin,
    assetPlugin,
    MaterialLoader,
    AssetRefCounter,
    type AddressableManifest,
    type AddressableManifestGroup,
    type AddressableManifestAsset,
    type AssetsData,
    type TextureInfo,
    type SpineLoadResult,
    type LoadedMaterial,
    type ShaderLoader,
    type AssetRefInfo,
} from './asset';

// =============================================================================
// Scene
// =============================================================================

export {
    loadSceneData,
    loadSceneWithAssets,
    loadComponent,
    remapEntityFields,
    updateCameraAspectRatio,
    findEntityByName,
    getComponentAssetFields,
    getComponentAssetFieldDescriptors,
    getComponentSpineFieldDescriptor,
    type AssetFieldType,
    type SceneData,
    type SceneEntityData,
    type SceneComponentData,
    type SceneLoadOptions,
    type SceneLoadProgressCallback,
    type MissingAssetCallback,
    MissingAssetsError,
    type SliceBorder,
} from './scene';

// =============================================================================
// Scene Manager
// =============================================================================

export {
    SceneManager,
    SceneManagerState,
    wrapSceneSystem,
    type SceneConfig,
    type SceneContext,
    type SceneStatus,
    type TransitionOptions,
} from './sceneManager';

export { sceneManagerPlugin } from './scenePlugin';

export {
    transitionTo,
    type TransitionConfig,
} from './sceneTransition';

// =============================================================================
// Prefab
// =============================================================================

export {
    instantiatePrefab,
    type PrefabData,
    type PrefabEntityData,
    type PrefabOverride,
    type NestedPrefabRef,
    type InstantiatePrefabOptions,
    type InstantiatePrefabResult,
} from './prefab';

export {
    flattenPrefab,
    applyOverrides,
    remapComponentEntityRefs,
    cloneComponents,
    cloneComponentData,
    collectNestedPrefabPaths,
    preloadNestedPrefabs,
    type ProcessedEntity,
    type FlattenContext,
    type FlattenResult,
    type ComponentData as PrefabComponentData,
} from './prefab/index';

export { Prefabs, PrefabServer, PrefabsPlugin, prefabsPlugin } from './prefabServer';

// =============================================================================
// Runtime Loader
// =============================================================================

export {
    loadRuntimeScene,
    createRuntimeSceneConfig,
    initRuntime,
    type RuntimeAssetProvider,
    type LoadRuntimeSceneOptions,
    type RuntimeInitConfig,
} from './runtimeLoader';

// =============================================================================
// Preview
// =============================================================================

export { PreviewPlugin, WebAssetProvider } from './preview';

// =============================================================================
// Animation
// =============================================================================

export {
    Tween,
    TweenHandle,
    EasingType,
    TweenTarget,
    TweenState,
    LoopMode,
    initTweenAPI,
    shutdownTweenAPI,
    SpriteAnimator,
    spriteAnimatorSystemUpdate,
    registerAnimClip,
    unregisterAnimClip,
    getAnimClip,
    clearAnimClips,
    AnimationPlugin,
    animationPlugin,
    type TweenOptions,
    type BezierPoints,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    type SpriteAnimFrame,
    type SpriteAnimEvent,
    type SpriteAnimEventHandler,
    parseAnimClipData,
    extractAnimClipTexturePaths,
    type AnimClipAssetData,
    onAnimEvent,
    onAnimEventGlobal,
    removeAnimEventListeners,
    TweenGroup,
    TweenSequence,
    TweenCompose,
} from './animation';

// =============================================================================
// Audio
// =============================================================================

export {
    Audio,
    AudioPlugin,
    audioPlugin,
    AudioSource,
    AudioListener,
    AudioBus,
    AudioMixer,
    AudioPool,
    AttenuationModel,
    calculateAttenuation,
    calculatePanning,
    type AudioHandle,
    type AudioBufferHandle,
    type PlayConfig,
    type PlatformAudioBackend,
    type AudioBackendInitOptions,
    type AudioPluginConfig,
    type AudioBusConfig,
    type AudioMixerConfig,
    type SpatialAudioConfig,
    type AudioSourceData,
    type AudioListenerData,
    type PooledAudioNode,
} from './audio';

// =============================================================================
// Particle
// =============================================================================

export {
    Particle,
    initParticleAPI,
    shutdownParticleAPI,
    ParticlePlugin,
    particlePlugin,
} from './particle';

// =============================================================================
// Tilemap
// =============================================================================

export {
    Tilemap,
    TilemapLayer,
    TilemapAPI,
    initTilemapAPI,
    shutdownTilemapAPI,
    TilemapPlugin,
    tilemapPlugin,
    parseTiledMap,
    parseTmjJson,
    loadTiledMap,
    resolveRelativePath,
    getTextureDimensions,
    registerTilemapSource,
    getTilemapSource,
    clearTilemapSourceCache,
    type TilemapData,
    type TilemapLayerData,
    type TiledMapData,
    type TiledLayerData,
    type TiledTilesetData,
    type TextureDimensions,
    type LoadedTilemapSource,
    type LoadedTilemapLayer,
    type LoadedTilemapTileset,
} from './tilemap';

// =============================================================================
// Physics types (the plugin + config surface; simulation lives in the package)
// =============================================================================

export type {
    PhysicsWasmModule,
    PhysicsModuleFactory,
    PhysicsPluginConfig,
    PhysicsEventsData,
    CollisionEnterEvent,
    SensorEvent,
} from './physics';
