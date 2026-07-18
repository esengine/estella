// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    core-sys.ts
 * @brief   Engine infrastructure surface: platform, lifecycle, logging,
 *          diagnostics, timers, entity helpers, networking, screen.
 *
 * These are the "runs under everything else" primitives that a consuming
 * application might touch (logging, timers, platform detection, runtime
 * config) but that are not directly part of the ECS or render pipeline.
 *
 * Re-exported wholesale by `core.ts`.
 */

// =============================================================================
// Math (scalar / Vec2 / Vec3 helpers on the canonical types)
// =============================================================================

export { scalar, v2, v3, col } from './math';

// =============================================================================
// Localization (i18n)
// =============================================================================

export {
    Localization,
    LocalizationAPI,
    LocalizationPlugin,
    localizationPlugin,
    interpolate,
    selectPluralForm,
    defaultPluralSelector,
    parseLocaleTable,
    matchLocale,
    type LocaleTableAsset,
    type LocalizationOptions,
    type PluralCategory,
    type PluralForms,
    type LocaleEntry,
    type LocaleCatalog,
    type TParams,
    type PluralSelector,
} from './i18n';

// =============================================================================
// Save / load (versioned persistence with migration)
// =============================================================================

export {
    SaveManager,
    migrateSaveData,
    type SaveEnvelope,
    type SaveMigration,
    type SaveStorage,
    type SaveManagerOptions,
} from './saveGame';

// =============================================================================
// Entity Utils
// =============================================================================

export { setEntityVisible, isEntityVisible, setEntityActive, isEntityActive } from './entityUtils';
export { CacheBitmap, type BitmapCache } from './cacheBitmap';
export {
    CacheAsBitmap,
    getCacheForEntity,
    setCacheForEntity,
    removeCacheForEntity,
    clearAllCaches,
    type CacheAsBitmapData,
} from './cacheAsBitmap';
export { pointInHitArea, type HitAreaShape } from './hitArea';

// =============================================================================
// Screen
// =============================================================================

export { ScreenInfo, ScreenOrientation } from './screen';

// =============================================================================
// Network
// =============================================================================

export {
    GameSocket, WeChatSocket, createSocket, NetChannel,
    MemoryTransport, createMemoryTransportPair,
    MessagePortTransport, type MessagePortLike,
    type GameSocketOptions, type SocketReadyState, type NetTransport,
    type NetChannelOptions, type MessageHandler, type RequestHandler,
    type BinaryHandler, type PlatformSocket, type PlatformSocketOptions,
    type PlatformSocketReadyState,
} from './net';

export {
    replicationPlugin, ReplicationPlugin, Net, NetSession,
    Replicated, NetGhost, ReplicationServer, ReplicationClient,
    REPLICATION_PROTOCOL_VERSION, REPLICATION_CHANNEL,
    radiusInterest,
    type NetRoleKind, type ReplicatedData,
    type InterestPolicy, type InterestView, type RadiusInterestOptions,
    type PredictionOptions, type PredictionSmoothing,
} from './net/replication';

// =============================================================================
// Platform (base functions only)
// =============================================================================

export {
    getPlatform,
    getPlatformType,
    isPlatformInitialized,
    isWeChat,
    isWeb,
    platformFetch,
    platformReadFile,
    platformReadTextFile,
    platformFileExists,
    platformInstantiateWasm,
    type PlatformAdapter,
    type PlatformType,
    type PlatformRequestOptions,
    type PlatformResponse,
} from './platform';

// =============================================================================
// Logger
// =============================================================================

export {
    Logger,
    getLogger,
    log,
    setLogLevel,
    debug,
    info,
    warn,
    error,
    LogLevel,
    type LogEntry,
    type LogHandler,
} from './logger';

// =============================================================================
// GL Debug
// =============================================================================

export {
    GLDebug,
} from './glDebug';

// =============================================================================
// WASM Error Handling
// =============================================================================

export { setWasmErrorHandler } from './wasmError';

// =============================================================================
// Stats
// =============================================================================

export {
    Stats,
    StatsPlugin,
    statsPlugin,
    StatsCollector,
    FrameHistory,
    defaultFrameStats,
    type FrameStats,
    type FrameSnapshot,
    type StatsPluginOptions,
} from './stats';

export { StatsOverlay, type StatsPosition } from './stats-overlay';

// =============================================================================
// Timer
// =============================================================================

export {
    TimerManager,
    TimerHandle,
    TimerRes,
    timerPlugin,
} from './timer';

// =============================================================================
// Lifecycle
// =============================================================================

export {
    LifecycleManager,
    Lifecycle,
    lifecyclePlugin,
    LifecyclePlugin,
    type LifecycleEvent,
    type LifecycleListener,
    type LifecyclePluginOptions,
} from './lifecycle';

// =============================================================================
// Side Modules (physics / spine acquisition)
// =============================================================================

export {
    createFetchSideModuleHost,
    createEmbeddedSideModuleHost,
    createWeChatSideModuleHost,
    SIDE_MODULES,
    SPINE_VERSIONS,
    spineModuleId,
    type SideModuleHost,
    type SideModuleId,
    type EmbeddedSideModuleEntry,
    type EmbeddedSideModuleRegistry,
    type WeChatSideModuleFactories,
} from './sideModules';

// =============================================================================
// Playable Runtime
// =============================================================================

export {
    initPlayableRuntime,
    type PlayableRuntimeConfig,
} from './playableRuntime';

export {
    initPlayRealmRuntime,
    type PlayRealmRuntimeConfig,
} from './playRealmRuntime';

export {
    RuntimeConfig,
    applyBuildRuntimeConfig,
    type RuntimeBuildConfig,
} from './defaults';

// =============================================================================
// Resource Manager
// =============================================================================

export {
    requireResourceManager,
    getResourceManager,
    evictTextureDimensions,
} from './resourceManager';

// =============================================================================
// Core Plugin
// =============================================================================

export { corePlugin, DEFAULT_UI_CAMERA_INFO } from './corePlugin';

// =============================================================================
// App Context
// =============================================================================

export { AppContext, getDefaultContext, setDefaultContext, type EditorBridge } from './context';
