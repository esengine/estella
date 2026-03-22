export const DEFAULT_DESIGN_WIDTH = 1920;
export const DEFAULT_DESIGN_HEIGHT = 1080;
export const DEFAULT_PIXELS_PER_UNIT = 100;
export const DEFAULT_TEXT_CANVAS_SIZE = 512;
export const DEFAULT_SPRITE_SIZE = { x: 100, y: 100 };
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
    defaultFontFamily: 'Arial',
    canvasScaleMode: 1,
    canvasMatchWidthOrHeight: 0.5,
    maxDeltaTime: 0.25,
    maxFixedSteps: 8,
    textCanvasSize: 512,
    assetLoadTimeout: 30000,
    assetFailureCooldown: 5000,
};

export function applyRuntimeConfig(components: {
    Text?: { _default: Record<string, unknown> };
    TextInput?: { _default: Record<string, unknown> };
    Canvas?: { _default: Record<string, unknown> };
}): void {
    if (components.Text) components.Text._default.fontFamily = RuntimeConfig.defaultFontFamily;
    if (components.TextInput) components.TextInput._default.fontFamily = RuntimeConfig.defaultFontFamily;
    if (components.Canvas) {
        components.Canvas._default.scaleMode = RuntimeConfig.canvasScaleMode;
        components.Canvas._default.matchWidthOrHeight = RuntimeConfig.canvasMatchWidthOrHeight;
    }
}

// =============================================================================
// Build Runtime Config
// =============================================================================

export interface RuntimeBuildConfig {
    sceneTransitionDuration?: number;
    sceneTransitionColor?: string;
    defaultFontFamily?: string;
    canvasScaleMode?: string;
    canvasMatchWidthOrHeight?: number;
    maxDeltaTime?: number;
    maxFixedSteps?: number;
    textCanvasSize?: number;
    assetLoadTimeout?: number;
    assetFailureCooldown?: number;
}

const CANVAS_SCALE_MODE_MAP: Record<string, number> = {
    FixedWidth: 0, FixedHeight: 1, Expand: 2, Shrink: 3, Match: 4, ShowAll: 2, NoBorder: 3,
};

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
    if (config.canvasScaleMode !== undefined) {
        RuntimeConfig.canvasScaleMode = CANVAS_SCALE_MODE_MAP[config.canvasScaleMode] ?? 1;
    }
    if (config.canvasMatchWidthOrHeight !== undefined) {
        RuntimeConfig.canvasMatchWidthOrHeight = config.canvasMatchWidthOrHeight;
    }
    if (config.assetLoadTimeout !== undefined) {
        RuntimeConfig.assetLoadTimeout = config.assetLoadTimeout;
    }
    if (config.assetFailureCooldown !== undefined) {
        RuntimeConfig.assetFailureCooldown = config.assetFailureCooldown;
    }
}
