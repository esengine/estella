import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { spriteBoundsProvider } from '../bounds/SpriteBoundsProvider';
import { BOUNDS_PROVIDER } from '../container/tokens';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';
import { getSettingsValue } from '../settings/SettingsRegistry';

const SpriteSchema = defineSchema('Sprite', {
    editorDefaults: () => {
        const w = getSettingsValue<number>('rendering.defaultSpriteWidth');
        const h = getSettingsValue<number>('rendering.defaultSpriteHeight');
        if (w != null || h != null) {
            return { size: { x: w ?? 100, y: h ?? 100 } };
        }
        return null;
    },
    overrides: {
        size: { hiddenWhen: { hasComponent: 'UIRect' } },
        layer: { min: LAYER_MIN, max: LAYER_MAX },
    },
});

export const spritePlugin: EditorPlugin = {
    name: 'sprite',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(BOUNDS_PROVIDER, 'Sprite', spriteBoundsProvider);
    },
};

export { SpriteSchema };
