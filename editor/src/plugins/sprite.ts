import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { spriteBoundsProvider } from '../bounds/SpriteBoundsProvider';
import { COMPONENT_SCHEMA, BOUNDS_PROVIDER } from '../container/tokens';
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
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, SpriteSchema.name, SpriteSchema);
        ctx.registrar.provide(BOUNDS_PROVIDER, 'Sprite', spriteBoundsProvider);
    },
};

export { SpriteSchema };
