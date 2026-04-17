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
    computeFillAnchors,
    computeHandleAnchors,
    computeFillSize,
    applyDirectionalFill,
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

export { UIRect, type UIRectData } from './core/ui-rect';

export {
    UIRenderer,
    UIVisualType,
    type UIRendererData,
} from './core/ui-renderer';

export { UIMask, MaskMode, type UIMaskData } from './core/ui-mask';

export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    type TextData,
} from './core/text';

export {
    Image,
    ImageType,
    FillMethod,
    FillOrigin,
    type ImageData,
} from './core/image';

export {
    FlexContainer,
    FlexDirection,
    FlexWrap,
    JustifyContent,
    AlignItems,
    AlignContent,
    type FlexContainerData,
    FlexItem,
    AlignSelf,
    type FlexItemData,
} from './layout/flex';

export {
    GridLayout,
    GridLayoutDirection,
    type GridLayoutData,
} from './layout/grid';

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
    STATE_VISUALS_SLOT_COUNT,
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
    buildUIRect,
    buildUIRenderer,
    buildText,
    spawnUIEntity,
    setUIVisible,
    type UIRectInit,
    type UIRendererInit,
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

export {
    TextRenderer,
    type TextRenderResult,
} from './TextRenderer';

export { TextPlugin, textPlugin } from './TextPlugin';

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

// ─── Legacy plugins / resources still in ui/ ────────────────────────────────

export { UIMaskPlugin, uiMaskPlugin } from './UIMaskPlugin';

export {
    UICameraInfo,
    type UICameraData,
} from './UICameraInfo';

export {
    computeUIRectLayout,
    type LayoutRect,
    type LayoutResult,
} from './uiHelpers';

export {
    UILayoutGeneration,
    type UILayoutGenerationData,
} from './UILayoutGeneration';

export { UILayoutPlugin, uiLayoutPlugin } from './UILayoutPlugin';

export { UIInteractionPlugin, uiInteractionPlugin } from './UIInteractionPlugin';

export {
    TextInput,
    type TextInputData,
} from './TextInput';

export { TextInputPlugin, textInputPlugin } from './TextInputPlugin';

export { ImagePlugin, imagePlugin } from './ImagePlugin';

export { DragPlugin, dragPlugin } from './DragPlugin';

export {
    ScrollView,
    type ScrollViewData,
} from './ScrollView';

export { ScrollViewPlugin, scrollViewPlugin } from './ScrollViewPlugin';

export { FocusPlugin, focusPlugin } from './FocusPlugin';

export {
    SafeArea,
    type SafeAreaData,
} from './SafeArea';

export { SafeAreaPlugin, safeAreaPlugin } from './SafeAreaPlugin';

export { UIRenderOrderPlugin, uiRenderOrderPlugin } from './UIRenderOrderPlugin';

// UI Theme
export {
    UIThemeRes,
    DARK_THEME,
    type UITheme,
} from './UITheme';

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

export const AnimOverride = {
    POS_X: 1,
    POS_Y: 2,
    ROT_Z: 4,
    SCALE_X: 8,
    SCALE_Y: 16,
} as const;
