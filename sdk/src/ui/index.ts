// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/index.ts
 * @brief   UI module — public barrel.
 */

// Shared Types
export {
    FillDirection,
    type ColorTransition,
} from './uiTypes';

// Shared Helpers
export {
    initUIHelpers,
    applyColorTransition,
    wrapText,
    nextPowerOf2,
    ensureComponent,
    makeInteractable,
    syncFillSpriteSize,
    walkParentChain,
    withChildEntity,
    setEntityColor,
    setEntityEnabled,
    colorScale,
    colorWithAlpha,
    EntityStateMap,
} from './uiHelpers';

// UI Constants
export {
    TEXT_PADDING_RATIO,
    TEXT_CANVAS_SHRINK_FRAMES,
    TEXT_CANVAS_OVERSIZE_RATIO,
    TEXT_INPUT_LINE_HEIGHT_RATIO,
    CURSOR_BLINK_INTERVAL,
    SCROLL_WHEEL_SENSITIVITY,
    SCROLL_MAX_DT,
    SCROLL_VELOCITY_THRESHOLD,
    SCROLL_VELOCITY_LERP_SPEED,
    SCROLL_ELASTIC_SMOOTH_TIME,
    SCROLL_ELASTIC_SNAP_THRESHOLD,
    SCROLL_MAX_OVERSCROLL_RATIO,
    SCROLL_MAX_VELOCITY_RATIO,
    DROPDOWN_ITEM_HEIGHT,
    DROPDOWN_FONT_SIZE,
    DROPDOWN_HIGHLIGHT_COLOR,
} from './uiConstants';

// ─── Layer 0: Events ────────────────────────────────────────────────────────

export {
    UIEvents,
    UIEventQueue,
    UIEventType,
    type UIEvent,
    type UIEventHandler,
    type Unsubscribe,
} from './core/events';

// ─── Layer 1: Primitives ────────────────────────────────────────────────────

export { DimensionUnit, type Dimension, px, percent, auto, isAuto } from './core/dimension';
export { UINode, UIPositionType, AlignSelf, type UINodeData } from './core/ui-node';

export {
    UIVisual,
    UIVisualType,
    FillMethod,
    FillOrigin,
    type UIVisualData,
} from './core/ui-visual';

export { UIMask, MaskMode, type UIMaskData } from './core/ui-mask';

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    type TextData,
} from './core/text';

export {
    FlexContainer,
    FlexDirection,
    FlexWrap,
    JustifyContent,
    AlignItems,
    AlignContent,
    type FlexContainerData,
} from './layout/flex';

// ─── Layer 2: Behaviors ─────────────────────────────────────────────────────

export {
    Interactable,
    UIInteraction,
    type InteractableData,
    type UIInteractionData,
} from './behavior/interactable';

export {
    StateMachine,
    type StateMachineData,
} from './behavior/state-machine';

export {
    StateVisuals,
    TransitionFlag,
    visualState,
    type VisualState,
    type StateVisualsData,
} from './behavior/state-visuals';

export {
    Focusable,
    FocusManager,
    FocusManagerState,
    type FocusableData,
} from './behavior/focusable';

export {
    Draggable,
    DragState,
    type DraggableData,
    type DragStateData,
} from './behavior/draggable';

export {
    driverStateFor,
    findStateSlot,
    createInteractableDriverSystem,
    createStateMachineDiffSystem,
    createStateVisualsApplySystem,
} from './behavior/systems';

export { UIBehaviorPlugin, uiBehaviorPlugin } from './plugin';

// ─── Collection ─────────────────────────────────────────────────────────────

export {
    ViewPool,
    type ViewPoolOptions,
    type ViewPoolTemplate,
} from './collection/view-pool';

export {
    type DataSource,
    type DataSourceChange,
    ArrayDataSource,
    arrayDataSource,
} from './collection/data-source';

export {
    type LayoutProvider,
    type Rect,
    type LinearLayoutOptions,
    type GridLayoutOptions,
    LinearLayoutProvider,
    GridLayoutProvider,
} from './collection/layout-provider';

export {
    ListView,
    ListViewRegistry,
    type ListViewOptions,
    type ListViewItemTemplate,
} from './collection/list-view';

export {
    ScrollContainer,
    ScrollContainerRegistry,
    type ScrollContainerOptions,
    type ScrollListener,
} from './collection/scroll-container';

// ─── Widgets (Layer 3 factories) ────────────────────────────────────────────

export {
    identityTransform,
    buildUINode,
    buildUIVisual,
    buildText,
    spawnUIEntity,
    setUIVisible,
    type UINodeInit,
    type UIVisualInit,
    type TextInit,
    type UIEntityInit,
} from './widgets/helpers';

export {
    createButton,
    setButtonState,
    type ButtonOptions,
    type ButtonStateVisual,
} from './widgets/button';

export {
    createToggle,
    type ToggleOptions,
    type ToggleHandle,
} from './widgets/toggle';

export {
    createProgress,
    type ProgressOptions,
    type ProgressHandle,
} from './widgets/progress';

export {
    createDialog,
    type DialogOptions,
    type DialogHandle,
} from './widgets/dialog';

export {
    createSlider,
    type SliderOptions,
    type SliderHandle,
} from './widgets/slider';

export {
    createDropdown,
    type DropdownOptions,
    type DropdownHandle,
} from './widgets/dropdown';

// ─── Rendering / text helpers ───────────────────────────────────────────────

// All text — display (Text) and editable (TextInput) — now renders through the
// SDF glyph atlas; the Canvas2D TextRenderer was retired.
export { TextPlugin, textPlugin } from './text/plugin';

// UI Math Utilities
export {
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    pointInOBB,
    quaternionToAngle2D,
    worldToScreen,
    createInvVPCache,
    type ScreenRect,
} from './uiMath';

// ─── Plugins (composed UI pipeline + the concept plugins it builds) ─────────

// `uiPlugin` is the single declarative UI pipeline. The concept
// plugins below remain exported for granular/advanced wiring.
export { UIPlugin, uiPlugin } from './ui-plugin';

export { UIMaskPlugin, uiMaskPlugin } from './render/mask';

export {
    UICameraInfo,
    type UICameraData,
} from './UICameraInfo';

export {
    UILayoutGeneration,
    type UILayoutGenerationData,
} from './UILayoutGeneration';

export { UILayoutPlugin, uiLayoutPlugin } from './layout/layout';

export { UIInteractionPlugin, uiInteractionPlugin } from './input/interaction';

export {
    TextInput,
    type TextInputData,
} from './TextInput';

export { TextInputPlugin, textInputPlugin } from './TextInputPlugin';

export { DragPlugin, dragPlugin } from './input/drag';

export { FocusPlugin, focusPlugin } from './input/focus';

export {
    SafeArea,
    type SafeAreaData,
} from './SafeArea';

export { SafeAreaPlugin, safeAreaPlugin } from './layout/safe-area';

export { UIRenderOrderPlugin, uiRenderOrderPlugin } from './render/render-order';

// ─── Theme (design tokens) ──────────────────────────────────────────────────

export {
    DARK_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    type ThemeTokens,
    type ThemeColors,
} from './theme/tokens';

// Property Path Utilities
export {
    getNestedProperty,
    setNestedProperty,
    parsePropertyPath,
    getEntityProperty,
    setEntityProperty,
    type ParsedPropertyPath,
} from './propertyPath';

// Rich Text
export {
    parseRichText,
    type TextRun,
    type TextSegment,
    type ImageSegment,
    type ImageValign,
    type RichTextRun,
} from './RichTextParser';

export {
    createFontSet,
    layoutRichText,
    measureLayoutWidth,
    type FontSet,
    type PositionedRun,
    type TextPositionedRun,
    type ImagePositionedRun,
    type LayoutLine,
} from './RichTextLayout';

export {
    setImageResolver,
    getImageResolver,
    DefaultImageResolver,
    type ImageResolver,
    type ResolvedImage,
} from './ImageResolver';

// ─── SDF glyph-atlas text ───────────────────────────────────────────────────

export {
    UI_TEXT_BOLD,
    UI_TEXT_ITALIC,
    composeTRS,
    rectTextBox,
} from './text/text-transform';

export {
    SdfTextRenderer,
    drawTextWith,
    type DrawTextParams,
    type GlyphBatchSink,
    type TextRendererOptions,
} from './text/text-renderer';

export {
    GlyphAtlas,
    type GlyphRasterizer,
    type AtlasPageStore,
    type RasterGlyph,
    type GlyphEntry,
    type GlyphAtlasOptions,
} from './text/glyph-atlas';

export {
    CanvasGlyphRasterizer,
    extractAlpha,
    sdfToAtlasRgba,
    type CanvasGlyphRasterizerOptions,
} from './text/glyph-rasterizer';

export { EngineAtlasPageStore } from './text/atlas-page-store';

export {
    layoutLine,
    layoutRichLine,
    layoutText,
    wrapLine,
    measureWidth,
    buildGlyphVertices,
    TEXT_ALIGN_LEFT,
    TEXT_ALIGN_CENTER,
    TEXT_ALIGN_RIGHT,
    type TextLayout,
    type TextLayoutOptions,
    type RichTextLayoutOptions,
    type MultilineTextOptions,
    type LaidGlyph,
    type RGBA,
    type GlyphVertexData,
} from './text/layout';

export { ShelfPacker, type Packer, type PackPos } from './text/atlas-packer';
export { sdfFromAlpha } from './text/sdf';
export { submitTextBatch, TEXT_VERTEX_FLOATS } from './text/submit';

export const AnimOverride = {
    POS_X: 1,
    POS_Y: 2,
    ROT_Z: 4,
    SCALE_X: 8,
    SCALE_Y: 16,
} as const;
