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
} from './scene/saveGame';

// =============================================================================
// Entity Utils
// =============================================================================

export { setEntityVisible, isEntityVisible, hasVisibility, setEntityActive, isEntityActive } from './ecs/entityUtils';

export { entityWorldBox, uiNodeWorldBox, entityBoxCorners, type EntityBox, type EntityBoxOptions, type ReadableWorld, type LayoutWorld } from './ecs/entityBox';
export { CacheBitmap, type BitmapCache } from './render/cacheBitmap';
export {
    CacheAsBitmap,
    getCacheForEntity,
    setCacheForEntity,
    removeCacheForEntity,
    clearAllCaches,
    type CacheAsBitmapData,
} from './render/cacheAsBitmap';
export { pointInHitArea, type HitAreaShape } from './input/hitArea';

// =============================================================================
// Screen
// =============================================================================

export { ScreenInfo, ScreenOrientation, type ScreenInfoEvents } from './screen';

// =============================================================================
// Network
// =============================================================================

export {
    GameSocket, MiniGameSocket, WeChatSocket, createSocket, NetChannel,
    MemoryTransport, createMemoryTransportPair,
    MessagePortTransport, type MessagePortLike,
    type GameSocketOptions, type SocketReadyState, type NetTransport,
    type NetChannelOptions, type MessageHandler, type RequestHandler,
    type BinaryHandler, type PlatformSocket, type PlatformSocketEvents,
    type PlatformSocketOptions, type PlatformSocketReadyState,
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

// Host CAPABILITIES, as opposed to the base functions below: the seams a service
// is built on. Public because a service can live outside the engine, and there is
// no second way to reach a host. Exported as a shipped plugin holds each one up.
export {
    platformShare,
    platformCanShare,
    platformOnShareRequest,
    platformCanPay,
    platformRequestPayment,
    // The open data domain: the runtime holding the player's friends, the canvas
    // it draws on, the one-way channel to it, and this player's own cloud row —
    // what a friends leaderboard is made of, and unreachable from a package.
    platformCanOpenData,
    platformOpenDataPostMessage,
    platformOpenDataCanvas,
    platformSetCloudKeyValues,
    platformCreateCanvas,
    platformDevicePixelRatio,
} from './platform';
export type { PlatformShareOptions, PlatformPaymentRequest } from './platform/types';

export {
    getPlatform,
    getPlatformType,
    isPlatformInitialized,
    isWeChat,
    isWeb,
    isNative,
    platformFetch,
    platformReadFile,
    platformReadTextFile,
    platformFileExists,
    platformInstantiateWasm,
    type PlatformAdapter,
    type PlatformType,
    type PlatformRequestOptions,
    type PlatformResponse,
    type PlatformCanvas,
    type PlatformCanvas2DContext,
    type PlatformImage,
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
} from './util/logger';

// =============================================================================
// Diagnostics — what went wrong in a game nobody is watching
// =============================================================================

export {
    Diagnostics, DiagnosticsAPI,
    DiagnosticsPlugin, diagnosticsPlugin,
    fingerprint, messageOf, stackOf,
    type DiagnosticEvent, type DiagnosticKind, type DiagnosticReport,
    type DiagnosticsOptions, type DiagnosticsPluginOptions, type DiagnosticsSink,
} from './diagnostics';

// =============================================================================
// Resource census — how many of X are alive right now
// =============================================================================

/** @beta Pre-1.0: the counter set is expected to grow as probes are added. */
export {
    takeCensus, registerCensusProbe, censusProbeIds, collectGarbage,
    diffCensus, analyzeCensusSeries, formatCensusDiff, formatCensusReport,
    type Census, type CensusEntry, type CensusTier, type CensusContext, type CensusProbe,
    type CensusDelta, type CensusSeriesOptions, type CensusVerdict, type CensusReport,
} from './diagnostics';

// =============================================================================
// GL Debug
// =============================================================================

export {
    GLDebug,
    shutdownGLDebugAPI,
} from './render/glDebug';

// =============================================================================
// WASM Error Handling
// =============================================================================

export { setWasmErrorHandler } from './wasm/wasmError';

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

export {
    ProfileRecorder,
    ProfileRecorderPlugin,
    type ProfileRecorderOptions,
} from './app/profileRecorder';

export {
    PROFILE_CAPTURE_VERSION,
    parseProfileCapture,
    summarizeCapture,
    summarizeFrames,
    frameProfileOf,
    percentile,
    type CaptureSource,
    type CaptureSummary,
    type CapturedFrame,
    type ProfileCapture,
} from './app/profileCapture';

export {
    buildFrameProfile,
    meanFrameProfile,
    scopeDomain,
    DOMAIN_SCRIPTS,
    DOMAIN_UNATTRIBUTED,
    type FrameProfile,
    type FrameProfileInput,
    type ProfileNode,
    type ProfileNodeKind,
    type QueryCost,
    type ScopeCost,
    type ScopeRemainder,
    type SystemCost,
} from './app/frameProfile';

// =============================================================================
// Timer
// =============================================================================

export {
    TimerManager,
    TimerHandle,
    TimerRes,
    timerPlugin,
} from './ecs/timer';

export { velocityPlugin, velocitySystem } from './velocity';

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
} from './ecs/lifecycle';

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
    registerSideModule,
    sideModuleDescriptor,
    projectSideModuleIds,
    clearProjectSideModules,
    type SideModuleHost,
    type SideModuleId,
    type BuiltinSideModuleId,
    type SideModuleDescriptor,
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
} from './runtime/playableRuntime';

export {
    playableCta,
    hasPlayableCta,
    type PlayableAdBridge,
} from './runtime/playableCta';

export {
    initPlayRealmRuntime,
    type PlayRealmRuntimeConfig,
} from './runtime/playRealmRuntime';

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
    shutdownResourceManager,
    evictTextureDimensions,
} from './wasm/resourceManager';

// =============================================================================
// Core Plugin
// =============================================================================

export { corePlugin, DEFAULT_UI_CAMERA_INFO } from './app/corePlugin';

// The engine entry points a plugin may call, from whichever core is present (the
// wasm module on the web, a native host's bindings on a device) — the parameter
// type the UI pick helpers take. @beta while the native host is unshipped.
export type { EngineApi } from './ecs/bridge/engineApi';

// =============================================================================
// App Context
// =============================================================================

export { AppContext, getDefaultContext, setDefaultContext, type EditorBridge } from './ecs/context';
