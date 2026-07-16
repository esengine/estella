// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/index.ts
 * @brief   UI module — public barrel.
 */

// Shared Helpers
export {
    initUIHelpers,
    nextPowerOf2,
    ensureComponent,
    walkParentChain,
    EntityStateMap,
} from './util/helpers';

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
} from './util/constants';

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
    TextRenderMode,
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

export {
    AnchorAxis,
    ANCHOR_AXES,
    anchorPresetFields,
    detectAnchor,
    type AnchorPreset,
    type AnchorFields,
} from './layout/anchor';

// ─── Layer 2: Behaviors ─────────────────────────────────────────────────────

export {
    Interactable,
    UIInteraction,
    type InteractableData,
    type UIInteractionData,
} from './input/interactable';

export {
    Focusable,
    FocusManager,
    FocusManagerState,
    type FocusableData,
} from './input/focusable';

export {
    Draggable,
    DragState,
    type DraggableData,
    type DragStateData,
} from './input/draggable';

export { UIBehaviorPlugin, uiBehaviorPlugin } from './behavior/plugin';

// ─── Controllers + Gears (shared UI state) ──────────────────────────────────

export {
    UIController,
    INTERACTION_CONTROLLER,
    INTERACTION_PAGES,
    interactionController,
    controllerState,
    findControllerOwner,
    getControllerPage,
    setControllerPage,
    type ControllerState,
    type UIControllerData,
} from './controller/ui-controller';

export {
    UIGear,
    gearBinding,
    type GearValue,
    type GearTween,
    type GearBinding,
    type UIGearData,
} from './controller/ui-gear';

export {
    createInteractionControllerDriverSystem,
    createGearApplySystem,
    driverStateFor,
    readFieldPath,
    writeFieldPath,
    isLerpable,
    lerpGearValue,
} from './controller/gear-apply';

export { bindControllerPage } from './controller/bind-page';
export { ensureControllerAiRegistrations } from './controller/ai-builtins';

export { UIControllerPlugin, uiControllerPlugin } from './controller/plugin';

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

export {
    KineticScroll,
    type KineticScrollOptions,
} from './collection/kinetic-scroll';

// ─── Widgets (Layer 3 factories) ────────────────────────────────────────────

export {
    identityTransform,
    buildUINode,
    buildUIVisual,
    buildText,
    spawnUIEntity,
    setUIVisible,
    FILL_AXIS,
    type LinearFillDirection,
    type UINodeInit,
    type UIVisualInit,
    type TextInit,
    type UIEntityInit,
} from './widgets/helpers';

export {
    createButton,
    setButtonState,
    themeButtonStates,
    interactionGears,
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

export {
    createListView,
    type CreateListViewOptions,
    type ListViewHandle,
    type ListItemTemplate,
    type ListLayoutSpec,
} from './widgets/list-view';

export { widgetToPrefab } from './widgets/toPrefab';
export { BUILTIN_UI_PREFABS, BUILTIN_UI_WIDGET_NAMES } from './widgets/prefabs/generated';

// ─── Rendering / text helpers ───────────────────────────────────────────────

// All text — display (Text) and editable (TextInput) — now renders through the
// SDF glyph atlas; the Canvas2D TextRenderer was retired.
export { TextPlugin, textPlugin, resolveTextRenderMode } from './text/plugin';

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
} from './util/math';

// ─── Plugins (composed UI pipeline + the concept plugins it builds) ─────────

// `uiPlugin` is the single declarative UI pipeline. The concept
// plugins below remain exported for granular/advanced wiring.
export { UIPlugin, uiPlugin } from './ui-plugin';

export { UIMaskPlugin, uiMaskPlugin } from './render/mask';

export {
    UICameraInfo,
    type UICameraData,
} from './core/ui-camera-info';

export { screenToUiWorld, uiWorldToScreen, uiHitTestWorld, uiPickWorld, uiPickAllWorld } from './util/ui-pick';

export {
    UILayoutGeneration,
    type UILayoutGenerationData,
} from './layout/ui-layout-generation';

export { UILayoutPlugin, uiLayoutPlugin } from './layout/layout';

export { UIInteractionPlugin, uiInteractionPlugin } from './input/interaction';

export {
    TextInput,
    type TextInputData,
} from './text/text-input';

export { TextInputPlugin, textInputPlugin } from './text/text-input-plugin';

export { DragPlugin, dragPlugin } from './input/drag';

export { FocusPlugin, focusPlugin } from './input/focus';

export {
    SafeArea,
    SafeAreaPlugin,
    safeAreaPlugin,
    type SafeAreaData,
} from './layout/safe-area';

export { UIRenderOrderPlugin, uiRenderOrderPlugin } from './render/render-order';

// ─── Theme (design tokens) ──────────────────────────────────────────────────

export {
    DARK_TOKENS,
    LIGHT_TOKENS,
    getTheme,
    setTheme,
    themeColors,
    themeType,
    type ThemeTokens,
    type ThemeColors,
    type ThemeType,
} from './theme/tokens';

export {
    ThemeStyle,
    markThemed,
    type ThemeStyleData,
    type ColorRole,
} from './theme/theme-style';

export { applyThemeToWorld, switchTheme } from './behavior/theme-apply';

// ─── Binding (reactive data → component fields) ─────────────────────────────

export { signal, derived, type Signal, type ReadonlySignal } from './binding/signal';
export { bind } from './binding/bind';

// Property Path Utilities
export {
    getNestedProperty,
    setNestedProperty,
    parsePropertyPath,
    getEntityProperty,
    setEntityProperty,
    type ParsedPropertyPath,
} from './util/property-path';

// Rich Text
export {
    parseRichText,
    type TextRun,
    type TextSegment,
    type ImageSegment,
    type ImageValign,
    type RichTextRun,
} from './text/rich-text-parser';

export {
    createFontSet,
    layoutRichText,
    measureLayoutWidth,
    type FontSet,
    type PositionedRun,
    type TextPositionedRun,
    type ImagePositionedRun,
    type LayoutLine,
} from './text/rich-text-layout';

export {
    setImageResolver,
    getImageResolver,
    DefaultImageResolver,
    type ImageResolver,
    type ResolvedImage,
} from './text/image-resolver';

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
