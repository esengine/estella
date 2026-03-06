import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';
import { Constraints } from '../schemas/schemaConstants';

const ShapeRendererSchema: ComponentSchema = {
    name: 'ShapeRenderer',
    category: 'builtin',
    properties: [
        {
            name: 'shapeType',
            type: 'enum',
            displayName: 'Shape',
            options: [
                { label: 'Circle', value: 0 },
                { label: 'Capsule', value: 1 },
                { label: 'RoundedRect', value: 2 },
            ],
        },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2' },
        { name: 'cornerRadius', type: 'number', min: 0, displayName: 'Corner Radius',
          visibleWhen: { field: 'shapeType', equals: 2 } },
        { name: 'layer', type: 'number', ...Constraints.layer },
    ],
};

export const shapeRendererPlugin: EditorPlugin = {
    name: 'shape-renderer',
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, ShapeRendererSchema.name, ShapeRendererSchema);
    },
};
