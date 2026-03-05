import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';

const ShapeRendererSchema: ComponentSchema = {
    name: 'ShapeRenderer',
    category: 'builtin',
    properties: [
        {
            name: 'shapeType',
            type: 'enum',
            options: [
                { label: 'Circle', value: 0 },
                { label: 'Capsule', value: 1 },
                { label: 'RoundedRect', value: 2 },
            ],
        },
        { name: 'color', type: 'color' },
        { name: 'size', type: 'vec2' },
        { name: 'cornerRadius', type: 'number', min: 0 },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX },
    ],
};

export const shapeRendererPlugin: EditorPlugin = {
    name: 'shape-renderer',
    register() {
        registerComponentSchema(ShapeRendererSchema);
    },
};
