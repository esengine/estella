/**
 * @file    BuildTemplates.ts
 * @brief   Preset build configuration templates
 */

import {
    BuildConfig,
    BuildPlatform,
    PlayableSettings,
    WeChatSettings,
} from '../types/BuildTypes';

// =============================================================================
// Types
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
// Preset Templates
// =============================================================================

export const BUILD_TEMPLATES: BuildTemplate[] = [
    {
        id: 'facebook-playable',
        name: 'Facebook Playable',
        description: 'Optimized for Facebook playable ads (2MB limit)',
        platform: 'playable',
        icon: 'facebook',
        defines: [],
        playableSettings: {
            isDevelopment: false,
            minifyCode: true,
            embedFonts: false,
            outputPath: 'build/facebook-playable.html',
        },
    },
    {
        id: 'google-playable',
        name: 'Google Playable',
        description: 'Optimized for Google playable ads (5MB limit)',
        platform: 'playable',
        icon: 'google',
        defines: [],
        playableSettings: {
            isDevelopment: false,
            minifyCode: true,
            embedFonts: true,
            outputPath: 'build/google-playable.html',
        },
    },
    {
        id: 'playable-debug',
        name: 'Playable Debug',
        description: 'Development build with debug features enabled',
        platform: 'playable',
        icon: 'bug',
        defines: ['DEBUG'],
        playableSettings: {
            isDevelopment: true,
            minifyCode: false,
            embedFonts: true,
            outputPath: 'build/playable-debug.html',
        },
    },
    {
        id: 'wechat-production',
        name: 'WeChat Production',
        description: 'Production build with subpackage support',
        platform: 'wechat',
        icon: 'package',
        defines: [],
        wechatSettings: {
            bundleMode: 'subpackage',
            orientation: 'portrait',
        },
    },
    {
        id: 'wechat-debug',
        name: 'WeChat Debug',
        description: 'Development build with debug features',
        platform: 'wechat',
        icon: 'bug',
        defines: ['DEBUG'],
        wechatSettings: {
            bundleMode: 'single',
            orientation: 'portrait',
        },
    },
    {
        id: 'wechat-single-file',
        name: 'WeChat Single File',
        description: 'Single file bundle for simple games',
        platform: 'wechat',
        icon: 'file',
        defines: [],
        wechatSettings: {
            bundleMode: 'singleFile',
            orientation: 'portrait',
        },
    },
    {
        id: 'wechat-landscape',
        name: 'WeChat Landscape',
        description: 'Landscape orientation for wide-screen games',
        platform: 'wechat',
        icon: 'monitor',
        defines: [],
        wechatSettings: {
            bundleMode: 'subpackage',
            orientation: 'landscape',
        },
    },
];

// =============================================================================
// Template Functions
// =============================================================================

export function getTemplates(): BuildTemplate[] {
    return BUILD_TEMPLATES;
}

export function getTemplatesByPlatform(platform: BuildPlatform): BuildTemplate[] {
    return BUILD_TEMPLATES.filter(t => t.platform === platform);
}

export function getTemplate(templateId: string): BuildTemplate | undefined {
    return BUILD_TEMPLATES.find(t => t.id === templateId);
}

export function createConfigFromTemplate(
    template: BuildTemplate,
    name?: string
): BuildConfig {
    const configId = `${template.platform}-${Date.now()}`;
    const configName = name || template.name;

    const config: BuildConfig = {
        id: configId,
        name: configName,
        platform: template.platform,
        scenes: [],
        defines: [...template.defines],
    };

    if (template.platform === 'playable') {
        config.playableSettings = {
            startupScene: '',
            isDevelopment: template.playableSettings?.isDevelopment ?? true,
            minifyCode: template.playableSettings?.minifyCode ?? false,
            embedFonts: template.playableSettings?.embedFonts ?? true,
            outputPath: template.playableSettings?.outputPath ?? 'build/playable.html',
            enableBuiltinCTA: template.playableSettings?.enableBuiltinCTA ?? false,
            ctaUrl: template.playableSettings?.ctaUrl ?? '',
        };
    } else {
        config.wechatSettings = {
            appId: '',
            version: '1.0.0',
            bundleMode: template.wechatSettings?.bundleMode ?? 'subpackage',
            outputDir: template.wechatSettings?.outputDir ?? 'build/wechat',
            orientation: template.wechatSettings?.orientation ?? 'portrait',
        };
    }

    return config;
}

export function applyTemplateToConfig(
    config: BuildConfig,
    template: BuildTemplate
): BuildConfig {
    if (config.platform !== template.platform) {
        throw new Error('Template platform does not match config platform');
    }

    const updated = { ...config };
    updated.defines = [...template.defines];

    if (template.platform === 'playable' && template.playableSettings && updated.playableSettings) {
        updated.playableSettings = {
            ...updated.playableSettings,
            ...template.playableSettings,
        };
    } else if (template.platform === 'wechat' && template.wechatSettings && updated.wechatSettings) {
        updated.wechatSettings = {
            ...updated.wechatSettings,
            ...template.wechatSettings,
        };
    }

    return updated;
}

// =============================================================================
// Template Icon Mapping
// =============================================================================

export function getTemplateIconSvg(iconId: string): string {
    const icons: Record<string, string> = {
        facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
        google: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
        bug: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a6 6 0 0112 0v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H3M6 17l-3 1M17.47 9c1.93-.2 3.53-1.9 3.53-4M18 13h3M18 17l3 1"/></svg>`,
        package: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>`,
        file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>`,
        monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8M12 17v4"/></svg>`,
        play: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
        box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>`,
    };

    return icons[iconId] || icons['box'];
}
