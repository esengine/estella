/**
 * @file    ui/index.ts
 * @brief   UI module exports
 */

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
    worldRectToScreen,
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
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
