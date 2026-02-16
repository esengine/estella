export const DEFAULT_DESIGN_WIDTH = 1920;
export const DEFAULT_DESIGN_HEIGHT = 1080;
export const DEFAULT_PIXELS_PER_UNIT = 100;
export const DEFAULT_TEXT_CANVAS_SIZE = 512;

export const RuntimeConfig = {
    sceneTransitionDuration: 0.3,
    sceneTransitionColor: { r: 0, g: 0, b: 0, a: 1 } as { r: number; g: number; b: number; a: number },
    defaultFontFamily: 'Arial',
    canvasScaleMode: 1,
    canvasMatchWidthOrHeight: 0.5,
    maxDeltaTime: 0.25,
    maxFixedSteps: 8,
    textCanvasSize: 512,
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
