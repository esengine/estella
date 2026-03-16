import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { TIME_SCALE_MAX } from '../schemas/schemaConstants';

export const animationPlugin: EditorPlugin = {
    name: 'animation',
    register(_ctx: EditorPluginContext) {
        defineSchema('SpriteAnimator', {
            overrides: {
                speed: { min: 0, max: TIME_SCALE_MAX, step: 0.1 },
            },
        });
    },
};
