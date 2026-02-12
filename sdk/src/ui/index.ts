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
