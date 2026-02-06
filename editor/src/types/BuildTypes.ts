/**
 * @file    BuildTypes.ts
 * @brief   Build configuration type definitions
 */

// =============================================================================
// Platform Types
// =============================================================================

export type BuildPlatform = 'playable' | 'wechat';
export type BuildStatus = 'success' | 'failed' | 'cancelled';
export type BuildPhase = 'preparing' | 'compiling' | 'processing_assets' | 'assembling' | 'writing' | 'completed' | 'failed';

export interface PlatformInfo {
    id: BuildPlatform;
    name: string;
    icon: string;
}

export const PLATFORMS: PlatformInfo[] = [
    { id: 'playable', name: 'Playable', icon: 'play' },
    { id: 'wechat', name: 'WeChat MiniGame', icon: 'box' },
];

// =============================================================================
// Platform Settings
// =============================================================================

export interface PlayableSettings {
    startupScene: string;
    isDevelopment: boolean;
    minifyCode: boolean;
    embedFonts: boolean;
    outputPath: string;
}

export interface WeChatSubpackage {
    name: string;
    root: string;
    independent?: boolean;
}

export interface WeChatSettings {
    appId: string;
    version: string;
    bundleMode: 'subpackage' | 'single' | 'singleFile';
    outputDir: string;
    orientation?: 'portrait' | 'landscape';
    subpackages?: WeChatSubpackage[];
    workers?: string;
    openDataContext?: string;
}

// =============================================================================
// Build Configuration
// =============================================================================

export interface BuildConfig {
    id: string;
    name: string;
    platform: BuildPlatform;
    scenes: string[];
    defines: string[];
    playableSettings?: PlayableSettings;
    wechatSettings?: WeChatSettings;
}

export interface BuildSettings {
    activePlatform: BuildPlatform;
    activeConfigId: string;
    configs: BuildConfig[];
}

// =============================================================================
// Build Settings File (Project-level)
// =============================================================================

export interface BuildSettingsFile {
    version: '1.0';
    activePlatform: BuildPlatform;
    activeConfigId: string;
    configs: BuildConfig[];
}

// =============================================================================
// Build Cache Types
// =============================================================================

export interface FileHash {
    path: string;
    hash: string;
    lastModified: number;
    size: number;
}

export interface BuildCacheData {
    version: string;
    configId: string;
    timestamp: number;
    files: Record<string, FileHash>;
    compiledScripts?: string;
    compiledScriptsHash?: string;
}

export interface FileChangeResult {
    added: string[];
    modified: string[];
    removed: string[];
    unchanged: string[];
}

// =============================================================================
// Build Progress Types
// =============================================================================

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface BuildLogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
    phase?: BuildPhase;
}

export interface BuildProgress {
    phase: BuildPhase;
    overallProgress: number;
    currentTask: string;
    currentTaskProgress: number;
    logs: BuildLogEntry[];
    startTime: number;
    estimatedTimeRemaining?: number;
}

// =============================================================================
// Build History Types
// =============================================================================

export interface BuildHistoryEntry {
    id: string;
    configId: string;
    configName: string;
    platform: string;
    timestamp: number;
    duration: number;
    status: BuildStatus;
    outputPath?: string;
    outputSize?: number;
    error?: string;
}

// =============================================================================
// Build Pipeline Types
// =============================================================================

export interface BuildTask {
    id: string;
    name: string;
    dependencies: string[];
    execute: () => Promise<void>;
    weight: number;
}

export interface TaskResult {
    id: string;
    success: boolean;
    error?: string;
    duration: number;
}

export interface PipelineResult {
    success: boolean;
    results: TaskResult[];
    totalDuration: number;
}

// =============================================================================
// Batch Build Types
// =============================================================================

export interface BatchBuildResult {
    success: boolean;
    results: ConfigBuildResult[];
    totalDuration: number;
    successCount: number;
    failureCount: number;
}

export interface ConfigBuildResult {
    configId: string;
    configName: string;
    result: BuildResult;
    duration: number;
}

export interface BuildResult {
    success: boolean;
    outputPath?: string;
    outputSize?: number;
    error?: string;
}

// =============================================================================
// Template Types
// =============================================================================

export interface BuildTemplate {
    id: string;
    name: string;
    description: string;
    platform: BuildPlatform;
    icon: string;
    defines: string[];
    playableSettings?: Partial<PlayableSettings>;
    wechatSettings?: Partial<WeChatSettings>;
}

// =============================================================================
// Default Values
// =============================================================================

export function createDefaultPlayableSettings(): PlayableSettings {
    return {
        startupScene: '',
        isDevelopment: true,
        minifyCode: false,
        embedFonts: true,
        outputPath: 'build/playable.html',
    };
}

export function createDefaultWeChatSettings(): WeChatSettings {
    return {
        appId: '',
        version: '1.0.0',
        bundleMode: 'subpackage',
        outputDir: 'build/wechat',
        orientation: 'portrait',
    };
}

export function createDefaultBuildConfig(
    platform: BuildPlatform,
    name: string
): BuildConfig {
    const id = `${platform}-${Date.now()}`;
    const config: BuildConfig = {
        id,
        name,
        platform,
        scenes: [],
        defines: platform === 'playable' ? [] : ['DEBUG'],
    };

    if (platform === 'playable') {
        config.playableSettings = createDefaultPlayableSettings();
    } else {
        config.wechatSettings = createDefaultWeChatSettings();
    }

    return config;
}

export function createDefaultBuildSettings(): BuildSettings {
    return {
        activePlatform: 'playable',
        activeConfigId: '',
        configs: [
            {
                id: 'playable-dev',
                name: 'Playable - Development',
                platform: 'playable',
                scenes: [],
                defines: ['DEBUG'],
                playableSettings: {
                    startupScene: '',
                    isDevelopment: true,
                    minifyCode: false,
                    embedFonts: true,
                    outputPath: 'build/playable-dev.html',
                },
            },
            {
                id: 'playable-prod',
                name: 'Playable - Production',
                platform: 'playable',
                scenes: [],
                defines: [],
                playableSettings: {
                    startupScene: '',
                    isDevelopment: false,
                    minifyCode: true,
                    embedFonts: true,
                    outputPath: 'build/playable.html',
                },
            },
            {
                id: 'wechat-dev',
                name: 'WeChat - Development',
                platform: 'wechat',
                scenes: [],
                defines: ['DEBUG'],
                wechatSettings: {
                    appId: '',
                    version: '1.0.0',
                    bundleMode: 'subpackage',
                    outputDir: 'build/wechat-dev',
                    orientation: 'portrait',
                },
            },
            {
                id: 'wechat-prod',
                name: 'WeChat - Production',
                platform: 'wechat',
                scenes: [],
                defines: [],
                wechatSettings: {
                    appId: '',
                    version: '1.0.0',
                    bundleMode: 'subpackage',
                    outputDir: 'build/wechat',
                    orientation: 'portrait',
                },
            },
        ],
    };
}
