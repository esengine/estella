// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { COMPONENT_META } from './ecs/component.generated';
import { getResourceManager, setRetainedBudget, setTextureBudget } from './wasm/resourceManager';

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
    /**
     * How many bytes of CPU copies the graphics device may keep to survive a GPU
     * loss before it warns (see setRetainedBudget). The engine keeps about 28 KiB
     * of its own; this is one 2048×2048 image. 0 never warns.
     */
    retainedBudget: 16 * 1024 * 1024,
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
    retainedBudget?: number;
}

/**
 * What every {@link RuntimeBuildConfig} field is when a project says nothing, in the units the config is written in (seconds, milliseconds,
 * bytes, `#rrggbb`). A project block carries only what differs from these, so an untouched project ships the bytes it always did.
 */
export const RUNTIME_BUILD_DEFAULTS: Readonly<Required<RuntimeBuildConfig>> = {
    sceneTransitionDuration: 0.3,
    sceneTransitionColor: '#000000',
    defaultFontFamily: DEFAULT_FONT_FAMILY,
    maxDeltaTime: 0.25,
    maxFixedSteps: 8,
    textCanvasSize: 512,
    assetLoadTimeout: 30000,
    assetFailureCooldown: 5000,
    textureCacheBudget: 64 * 1024 * 1024,
    audioCacheBudget: 32 * 1024 * 1024,
    retainedBudget: 16 * 1024 * 1024,
};

const RUNTIME_BUILD_LIMITS = {
    sceneTransitionDuration: [0, 10, false],
    maxDeltaTime: [0.01, 5, false],
    maxFixedSteps: [1, 64, true],
    textCanvasSize: [64, 4096, true],
    assetLoadTimeout: [1000, 600000, true],
    assetFailureCooldown: [0, 600000, true],
    textureCacheBudget: [0, 4096 * 1024 * 1024, true],
    audioCacheBudget: [0, 1024 * 1024 * 1024, true],
    retainedBudget: [0, 1024 * 1024 * 1024, true],
} as const satisfies Record<string, readonly [min: number, max: number, integer: boolean]>;

/**
 * The runtime tuning a project declared, read from untrusted JSON: a field of the wrong type is dropped, a number is held to its range, and a value
 * equal to its default is dropped too (absence is how a default is written everywhere else in a project). Nothing here invents a value.
 * @experimental
 */
export function parseRuntimeBuildConfig(value: unknown): RuntimeBuildConfig {
    const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const config: RuntimeBuildConfig = {};
    for (const [key, [min, max, integer]] of Object.entries(RUNTIME_BUILD_LIMITS) as [keyof typeof RUNTIME_BUILD_LIMITS, readonly [number, number, boolean]][]) {
        const v = raw[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const held = Math.min(max, Math.max(min, integer ? Math.round(v) : v));
        if (held !== RUNTIME_BUILD_DEFAULTS[key]) config[key] = held;
    }
    const color = raw.sceneTransitionColor;
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== RUNTIME_BUILD_DEFAULTS.sceneTransitionColor) {
        config.sceneTransitionColor = color.toLowerCase();
    }
    const family = raw.defaultFontFamily;
    if (typeof family === 'string' && family.trim() !== '' && family.length <= 200 && family !== RUNTIME_BUILD_DEFAULTS.defaultFontFamily) {
        config.defaultFontFamily = family;
    }
    return config;
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
    if (config.retainedBudget !== undefined) {
        RuntimeConfig.retainedBudget = config.retainedBudget;
        if (getResourceManager()) setRetainedBudget(config.retainedBudget);
    }
    if (config.audioCacheBudget !== undefined) {
        // AudioAPI reads this live at every budget check — no push needed.
        RuntimeConfig.audioCacheBudget = config.audioCacheBudget;
    }
}
