// Layer 0 — Infrastructure

export {
    UIEventQueue,
    UIEventType,
    UIEventBus,
    type UIEvent,
    type UIEventHandler,
    type Unsubscribe,
} from './core/events';

export {
    ViewPool,
    type ViewPoolOptions,
    type ViewPoolTemplate,
} from './collection/view-pool';

// Layer 1 — Primitives

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

// Layer 2 — Behaviors

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

// Collection

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

// Widgets

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
