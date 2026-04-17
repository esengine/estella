/**
 * @file    core-ui.ts
 * @brief   UI layer surface (text, rect, renderer, interactables, layout).
 *
 * Most application code reaches for `Text` / `UIRect` / `Interactable`
 * directly. The `compute*` / `withChildEntity` / `setEntityColor`-style
 * helpers are engine-internal glue re-exported for now so that the
 * UILayout / UIInteraction plugins that ship in the SDK can consume
 * them; they are not intended to be part of the stable public API.
 *
 * Re-exported wholesale by `core.ts`.
 */

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    UIRect,
    UIRenderer,
    UIVisualType,
    UILayoutGeneration,
    UIMask,
    TextRenderer,
    textPlugin,
    DefaultImageResolver,
    setImageResolver,
    getImageResolver,
    parseRichText,
    type ImageResolver,
    type ResolvedImage,
    type RichTextRun,
    type TextSegment,
    type ImageSegment,
    GridLayout,
    type GridLayoutData,
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    pointInOBB,
    quaternionToAngle2D,
    Interactable,
    UIInteraction,
    AnimOverride,
    UIEvents,
    UIEventQueue,
    makeInteractable,
    UICameraInfo,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    computeUIRectLayout,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    computeFillAnchors,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    computeHandleAnchors,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    computeFillSize,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    applyDirectionalFill,
    /** @internal layout-compute helper; used by UILayoutPlugin, unstable */
    syncFillSpriteSize,
    TextInput,
    Image,
    ImageType,
    FillMethod,
    FillOrigin,
    Draggable,
    DragState,
    ScrollView,
    FillDirection,
    Focusable,
    FocusManager,
    FocusManagerState,
    SafeArea,
    type TextData,
    type UIRectData,
    type UIMaskData,
    type MaskMode,
    type TextRenderResult,
    type ScreenRect,
    type InteractableData,
    type UIInteractionData,
    type UIEvent,
    type UIEventType,
    type UIEventHandler,
    type Unsubscribe,
    type UICameraData,
    type LayoutRect,
    type LayoutResult,
    type TextInputData,
    type UIRendererData,
    type UILayoutGenerationData,
    type ImageData,
    type DraggableData,
    type DragStateData,
    type ScrollViewData,
    type FocusableData,
    type SafeAreaData,
    UIThemeRes,
    DARK_THEME,
    /** @internal entity-tree helper for widget composition */
    withChildEntity,
    /** @internal state-driven tint helper used by widget state-visuals */
    setEntityColor,
    /** @internal component-toggle helper used by widget state-visuals */
    setEntityEnabled,
    /** @internal color math; prefer explicit Color objects in game code */
    colorScale,
    /** @internal color math; prefer explicit Color objects in game code */
    colorWithAlpha,
    /** @internal per-entity state map used by interaction behaviour */
    EntityStateMap,
    type UITheme,
} from './ui';
