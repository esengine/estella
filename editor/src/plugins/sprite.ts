import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { registerBoundsProvider } from '../bounds/BoundsRegistry';
import { spriteBoundsProvider } from '../bounds/SpriteBoundsProvider';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';

const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    category: 'builtin',
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2', hiddenWhen: { hasComponent: 'UIRect' } },
        { name: 'uvOffset', type: 'vec2' },
        { name: 'uvScale', type: 'vec2' },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
    ],
};

export const spritePlugin: EditorPlugin = {
    name: 'sprite',
    dependencies: ['core-components'],
    register() {
        registerComponentSchema(SpriteSchema);
        registerBoundsProvider('Sprite', spriteBoundsProvider);
    },
};

export { SpriteSchema };
