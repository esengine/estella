/**
 * @file    ui/index.ts
 * @brief   UI module exports
 */

// Text Component
export {
    Text,
    TextAlign,
    TextBaseline,
    type TextData,
} from './text';

// Text Renderer
export {
    TextRenderer,
    type TextRenderResult,
} from './TextRenderer';

// Text Plugin
export {
    TextPlugin,
    textPlugin,
    TextRendererRes,
    type TextRendererData,
} from './TextPlugin';
