import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { spriteBoundsProvider } from '../bounds/SpriteBoundsProvider';
import { BOUNDS_PROVIDER } from '../container/tokens';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';
import { getSettingsValue } from '../settings/SettingsRegistry';

let SpriteSchema: ComponentSchema;

export const spritePlugin: EditorPlugin = {
    name: 'sprite',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        const hasTiling = (data: Record<string, unknown>) => {
            const ts = data.tileSize as { x: number; y: number } | undefined;
            return ts != null && (ts.x > 0 || ts.y > 0);
        };

        SpriteSchema = defineSchema('Sprite', {
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
                tileSize: { displayName: 'Tile Size', group: 'Tiling' },
                tileSpacing: { displayName: 'Tile Spacing', group: 'Tiling',
                    visibleWhen: hasTiling },
            },
        });

        ctx.registrar.provide(BOUNDS_PROVIDER, 'Sprite', spriteBoundsProvider);
    },
};

export { SpriteSchema };
