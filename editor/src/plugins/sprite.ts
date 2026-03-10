import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { spriteBoundsProvider } from '../bounds/SpriteBoundsProvider';
import { COMPONENT_SCHEMA, BOUNDS_PROVIDER } from '../container/tokens';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';
import { getSettingsValue } from '../settings/SettingsRegistry';

const SpriteSchema: ComponentSchema = {
    name: 'Sprite',
    category: 'builtin',
    editorDefaults: () => {
        const w = getSettingsValue<number>('rendering.defaultSpriteWidth');
        const h = getSettingsValue<number>('rendering.defaultSpriteHeight');
        if (w != null || h != null) {
            return { size: { x: w ?? 100, y: h ?? 100 } };
        }
        return null;
    },
    properties: [
        { name: 'texture', type: 'texture' },
        { name: 'material', type: 'material-file' },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2', hiddenWhen: { hasComponent: 'UIRect' } },
        { name: 'pivot', type: 'vec2' },
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
