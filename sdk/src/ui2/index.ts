// Layer 0 — Infrastructure

export {
    UIEventQueue,
    UIEventType,
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
