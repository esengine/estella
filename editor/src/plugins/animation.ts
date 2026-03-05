import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { TIME_SCALE_MAX } from '../schemas/schemaConstants';

const SpriteAnimatorSchema: ComponentSchema = {
    name: 'SpriteAnimator',
    category: 'builtin',
    properties: [
        { name: 'clip', type: 'anim-file' },
        { name: 'speed', type: 'number', min: 0, max: TIME_SCALE_MAX, step: 0.1 },
        { name: 'playing', type: 'boolean' },
        { name: 'loop', type: 'boolean' },
        { name: 'enabled', type: 'boolean' },
    ],
};

export const animationPlugin: EditorPlugin = {
    name: 'animation',
    register() {
        registerComponentSchema(SpriteAnimatorSchema);
    },
};
