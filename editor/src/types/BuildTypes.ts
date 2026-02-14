/**
 * @file    BuildTypes.ts
 * @brief   Build configuration type definitions
 */

// =============================================================================
// Platform Types
// =============================================================================

export type BuildPlatform = 'playable' | 'wechat';

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
