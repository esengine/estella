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

// UIRenderer Component
export {
    UIRenderer,
    UIVisualType,
    type UIRendererData,
} from './UIRenderer';

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
    MaskMode,
    type UIMaskData,
} from './UIMask';

// UIMask Plugin
export {
    UIMaskPlugin,
    uiMaskPlugin,
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
    type UIEventHandler,
    type Unsubscribe,
} from './UIEvents';

// UI Camera Info Resource
export {
    UICameraInfo,
    type UICameraData,
} from './UICameraInfo';

// UI Layout Calculation
export {
    computeUIRectLayout,
    type LayoutRect,
    type LayoutResult,
} from './uiHelpers';

// UI Layout Generation Resource
export {
    UILayoutGeneration,
    type UILayoutGenerationData,
} from './UILayoutGeneration';

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

// FlexContainer Component
export {
    FlexContainer,
    FlexDirection,
    FlexWrap,
    JustifyContent,
    AlignItems,
    type FlexContainerData,
} from './FlexContainer';

// FlexItem Component
export {
    FlexItem,
    type FlexItemData,
} from './FlexItem';

// UIRenderOrder Plugin
export {
    UIRenderOrderPlugin,
    uiRenderOrderPlugin,
} from './UIRenderOrderPlugin';

// UI Theme
export {
    UIThemeRes,
    DARK_THEME,
    type UITheme,
} from './UITheme';

// StateMachine Component
export {
    StateMachine,
    type StateMachineData,
    type StateNode,
    type Transition,
    type Condition,
    type InputDef,
    type ListenerDef,
} from './StateMachine';

// StateMachine Plugin
export {
    StateMachinePlugin,
    stateMachinePlugin,
    evaluateCondition,
} from './StateMachinePlugin';


// Property Path Utilities
export {
    getNestedProperty,
    setNestedProperty,
    parsePropertyPath,
    getEntityProperty,
    setEntityProperty,
    type ParsedPropertyPath,
} from './propertyPath';

// UI Builder (Factory Functions & Declarative Tree)
export {
    UI,
    initUIBuilder,
    type UIEntityDef,
    type ButtonOptions,
    type SliderOptions,
    type ToggleOptions,
    type ProgressBarOptions,
    type ScrollViewOptions,
    type TextInputOptions,
    type DropdownOptions,
    type LabelOptions,
    type PanelOptions,
    type FlexOptions,
    type UINode,
    type UIElementNode,
    type UIButtonNode,
    type UISliderNode,
    type UIToggleNode,
    type UITextInputNode,
    type UIDropdownNode,
    type UIProgressBarNode,
    type UILabelNode,
    type UIPanelNode,
    type UIFlexRowNode,
    type UIFlexColumnNode,
    type UIScrollViewNode,
} from './UIBuilder';
