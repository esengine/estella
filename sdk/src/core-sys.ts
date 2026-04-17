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

export { GameSocket, WeChatSocket, createSocket, type GameSocketOptions, type SocketReadyState } from './net';

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
    initGLDebugAPI,
    shutdownGLDebugAPI,
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
    type LifecycleEvent,
    type LifecycleListener,
    type LifecyclePluginOptions,
} from './lifecycle';

// =============================================================================
// Playable Runtime
// =============================================================================

export {
    initPlayableRuntime,
    type PlayableRuntimeConfig,
} from './playableRuntime';

export {
    RuntimeConfig,
    applyBuildRuntimeConfig,
    type RuntimeBuildConfig,
} from './defaults';

// =============================================================================
// Resource Manager
// =============================================================================

export {
    initResourceManager,
    shutdownResourceManager,
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
