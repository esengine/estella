/**
 * @file    ui/index.ts
 * @brief   UI module exports
 */

// Shared Types
export {
    FillDirection,
    type ColorTransition,
} from './uiTypes';

// Shared Helpers
export {
    ensureSprite,
    computeFillAnchors,
    computeHandleAnchors,
    computeFillSize,
    applyDirectionalFill,
    applyColorTransition,
    wrapText,
    nextPowerOf2,
    ensureComponent,
    syncFillSpriteSize,
    layoutChildEntity,
} from './uiHelpers';

// Snapshot Utilities
export {
    createSnapshotUtils,
    type Snapshot,
} from './uiSnapshot';

// UI Constants
export {
    TEXT_PADDING_RATIO,
    TEXT_CANVAS_SHRINK_FRAMES,
    TEXT_CANVAS_OVERSIZE_RATIO,
    TEXT_INPUT_LINE_HEIGHT_RATIO,
    CURSOR_BLINK_INTERVAL,
    SCROLL_VELOCITY_SMOOTHING,
    SCROLL_VELOCITY_NEW_WEIGHT,
    SCROLL_WHEEL_SENSITIVITY,
    SCROLL_MAX_DT,
    SCROLL_FPS_REFERENCE,
    SCROLL_VELOCITY_THRESHOLD,
    DROPDOWN_ITEM_HEIGHT,
    DROPDOWN_FONT_SIZE,
    DROPDOWN_HIGHLIGHT_COLOR,
} from './uiConstants';

// Text Component
export {
    Text,
    TextAlign,
    TextVerticalAlign,
    TextOverflow,
    type TextData,
} from './text';

// UIRect Component
export {
    UIRect,
    type UIRectData,
} from './UIRect';

// Text Renderer
export {
    TextRenderer,
    type TextRenderResult,
} from './TextRenderer';

// Text Plugin
export {
    TextPlugin,
    textPlugin,
} from './TextPlugin';

// UIMask Component
export {
    UIMask,
    type MaskMode,
    type UIMaskData,
} from './UIMask';

// UIMask Plugin
export {
    UIMaskPlugin,
    uiMaskPlugin,
    createMaskProcessor,
} from './UIMaskPlugin';

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

// Interactable Component
export {
    Interactable,
    type InteractableData,
} from './Interactable';

// UIInteraction Component
export {
    UIInteraction,
    type UIInteractionData,
} from './UIInteraction';

// Button Component
export {
    Button,
    ButtonState,
    type ButtonTransition,
    type ButtonData,
} from './Button';

// UI Events
export {
    UIEvents,
    UIEventQueue,
    type UIEvent,
    type UIEventType,
} from './UIEvents';

// UI Camera Info Resource
export {
    UICameraInfo,
    type UICameraData,
} from './UICameraInfo';

// ScreenSpace Tag
export {
    ScreenSpace,
} from './ScreenSpace';

// UI Layout Calculation
export {
    computeUIRectLayout,
    type LayoutRect,
    type LayoutResult,
} from './uiLayout';

// UI Layout Plugin
export {
    UILayoutPlugin,
    uiLayoutPlugin,
} from './UILayoutPlugin';

// UI Interaction Plugin
export {
    UIInteractionPlugin,
    uiInteractionPlugin,
} from './UIInteractionPlugin';

// TextInput Component
export {
    TextInput,
    type TextInputData,
} from './TextInput';

// TextInput Plugin
export {
    TextInputPlugin,
    textInputPlugin,
} from './TextInputPlugin';

// Image Component
export {
    Image,
    ImageType,
    FillMethod,
    FillOrigin,
    type ImageData,
} from './Image';

// Image Plugin
export {
    ImagePlugin,
    imagePlugin,
} from './ImagePlugin';

// Toggle Component
export {
    Toggle,
    type ToggleTransition,
    type ToggleData,
} from './Toggle';

// ToggleGroup Component
export {
    ToggleGroup,
    type ToggleGroupData,
} from './ToggleGroup';

// Toggle Plugin
export {
    TogglePlugin,
    togglePlugin,
} from './TogglePlugin';

// ProgressBar Component
export {
    ProgressBar,
    ProgressBarDirection,
    type ProgressBarData,
} from './ProgressBar';

// ProgressBar Plugin
export {
    ProgressBarPlugin,
    progressBarPlugin,
} from './ProgressBarPlugin';

// Draggable Component
export {
    Draggable,
    DragState,
    type DraggableData,
    type DragStateData,
} from './Draggable';

// Drag Plugin
export {
    DragPlugin,
    dragPlugin,
} from './DragPlugin';

// ScrollView Component
export {
    ScrollView,
    type ScrollViewData,
} from './ScrollView';

// ScrollView Plugin
export {
    ScrollViewPlugin,
    scrollViewPlugin,
} from './ScrollViewPlugin';

// Slider Component
export {
    Slider,
    SliderDirection,
    type SliderData,
} from './Slider';

// Slider Plugin
export {
    SliderPlugin,
    sliderPlugin,
} from './SliderPlugin';

// Focusable Component
export {
    Focusable,
    FocusManager,
    FocusManagerState,
    type FocusableData,
} from './Focusable';

// Focus Plugin
export {
    FocusPlugin,
    focusPlugin,
} from './FocusPlugin';

// SafeArea Component
export {
    SafeArea,
    type SafeAreaData,
} from './SafeArea';

// SafeArea Plugin
export {
    SafeAreaPlugin,
    safeAreaPlugin,
} from './SafeAreaPlugin';

// ListView Component
export {
    ListView,
    type ListViewData,
    type ListViewItemRenderer,
} from './ListView';

// ListView Plugin
export {
    ListViewPlugin,
    listViewPlugin,
    setListViewRenderer,
} from './ListViewPlugin';

// Dropdown Component
export {
    Dropdown,
    type DropdownData,
} from './Dropdown';

// Dropdown Plugin
export {
    DropdownPlugin,
    dropdownPlugin,
} from './DropdownPlugin';

// LayoutGroup Component
export {
    LayoutGroup,
    LayoutDirection,
    ChildAlignment,
    type LayoutGroupData,
} from './LayoutGroup';

// LayoutGroup Plugin
export {
    LayoutGroupPlugin,
    layoutGroupPlugin,
} from './LayoutGroupPlugin';

// UIRenderOrder Plugin
export {
    UIRenderOrderPlugin,
    uiRenderOrderPlugin,
} from './UIRenderOrderPlugin';
