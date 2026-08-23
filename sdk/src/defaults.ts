// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { COMPONENT_META } from './ecs/component.generated';
import { getResourceManager, setTextureBudget } from './wasm/resourceManager';

// Values with a C++ backing read the generated metadata (Canvas ctor defaults,
// Sprite's editor_default annotation) so these constants cannot drift from the
// ES_PROPERTY sites they restate.
const canvasDefaults = COMPONENT_META.Canvas.defaults as {
    designResolution: { x: number; y: number };
    pixelsPerUnit: number;
};
export const DEFAULT_DESIGN_WIDTH = canvasDefaults.designResolution.x;
export const DEFAULT_DESIGN_HEIGHT = canvasDefaults.designResolution.y;
export const DEFAULT_PIXELS_PER_UNIT = canvasDefaults.pixelsPerUnit;
export const DEFAULT_TEXT_CANVAS_SIZE = 512;
export const DEFAULT_SPRITE_SIZE = {
    ...(COMPONENT_META.Sprite.editorDefaults as { size: { x: number; y: number } }).size,
};
export const DEFAULT_FONT_FAMILY = 'Arial';
export const DEFAULT_FONT_SIZE = 24;
export const DEFAULT_LINE_HEIGHT = 1.2;
export const DEFAULT_MAX_DELTA_TIME = 0.5;
export const DEFAULT_FALLBACK_DT = 1 / 60;
export const DEFAULT_GRAVITY = { x: 0, y: -9.81 };
export const DEFAULT_FIXED_TIMESTEP = 1 / 60;
export const DEFAULT_SPINE_SKIN = 'default';

export const RuntimeConfig = {
    sceneTransitionDuration: 0.3,
    sceneTransitionColor: { r: 0, g: 0, b: 0, a: 1 } as { r: number; g: number; b: number; a: number },
    /** The family a Text with no `fontFamily` of its own rasterizes with. */
    defaultFontFamily: DEFAULT_FONT_FAMILY,
    maxDeltaTime: 0.25,
    maxFixedSteps: 8,
    textCanvasSize: 512,
    assetLoadTimeout: 30000,
    assetFailureCooldown: 5000,
    /**
     * Resident GPU-texture byte budget (see setTextureBudget). Released-but-
     * budgeted textures stay resident as an evictable LRU cache, so re-entering
     * a scene (or streaming an area back in) revives them instead of
     * re-fetching + re-decoding. 0 turns the cache off (free at refcount 0).
     */
    textureCacheBudget: 64 * 1024 * 1024,
    /**
     * Decoded audio-buffer byte budget — the audio mirror of
     * textureCacheBudget. Released buffers stay as an evictable warm cache
     * (instantly playable, revived without re-fetch + re-decode) and the
     * oldest are dropped past this budget. Read live by AudioAPI, so changes
     * apply without re-init. 0 turns the warm cache off.
     */
    audioCacheBudget: 32 * 1024 * 1024,
};

// =============================================================================
// Build Runtime Config
// =============================================================================

export interface RuntimeBuildConfig {
    sceneTransitionDuration?: number;
    sceneTransitionColor?: string;
    defaultFontFamily?: string;
    maxDeltaTime?: number;
    maxFixedSteps?: number;
    textCanvasSize?: number;
    assetLoadTimeout?: number;
    assetFailureCooldown?: number;
    textureCacheBudget?: number;
    audioCacheBudget?: number;
}

export function applyBuildRuntimeConfig(app: { setMaxDeltaTime(v: number): void; setMaxFixedSteps(v: number): void }, config: RuntimeBuildConfig): void {
    if (config.maxDeltaTime !== undefined) {
        RuntimeConfig.maxDeltaTime = config.maxDeltaTime;
        app.setMaxDeltaTime(config.maxDeltaTime);
    }
    if (config.maxFixedSteps !== undefined) {
        RuntimeConfig.maxFixedSteps = config.maxFixedSteps;
        app.setMaxFixedSteps(config.maxFixedSteps);
    }
    if (config.textCanvasSize !== undefined) {
        RuntimeConfig.textCanvasSize = config.textCanvasSize;
    }
    if (config.defaultFontFamily !== undefined) {
        RuntimeConfig.defaultFontFamily = config.defaultFontFamily;
    }
    if (config.sceneTransitionDuration !== undefined) {
        RuntimeConfig.sceneTransitionDuration = config.sceneTransitionDuration;
    }
    if (config.sceneTransitionColor) {
        const hex = config.sceneTransitionColor.replace('#', '');
        RuntimeConfig.sceneTransitionColor = {
            r: parseInt(hex.substring(0, 2), 16) / 255,
            g: parseInt(hex.substring(2, 4), 16) / 255,
            b: parseInt(hex.substring(4, 6), 16) / 255,
            a: 1,
        };
    }
    if (config.assetLoadTimeout !== undefined) {
        RuntimeConfig.assetLoadTimeout = config.assetLoadTimeout;
    }
    if (config.assetFailureCooldown !== undefined) {
        RuntimeConfig.assetFailureCooldown = config.assetFailureCooldown;
    }
    if (config.textureCacheBudget !== undefined) {
        RuntimeConfig.textureCacheBudget = config.textureCacheBudget;
        // This runs after app creation, where corePlugin already applied the
        // default budget — push the configured value through to the pool.
        if (getResourceManager()) setTextureBudget(config.textureCacheBudget);
    }
    if (config.audioCacheBudget !== undefined) {
        // AudioAPI reads this live at every budget check — no push needed.
        RuntimeConfig.audioCacheBudget = config.audioCacheBudget;
    }
}
