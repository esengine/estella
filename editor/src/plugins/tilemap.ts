import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';

const TilemapSchema: ComponentSchema = {
    name: 'Tilemap',
    category: 'builtin',
    properties: [
        { name: 'source', type: 'tilemap-file' },
    ],
};

const TilemapLayerSchema: ComponentSchema = {
    name: 'TilemapLayer',
    category: 'builtin',
    hidden: true,
    properties: [
        { name: 'width', type: 'number', min: 1, max: 1000 },
        { name: 'height', type: 'number', min: 1, max: 1000 },
        { name: 'tileWidth', type: 'number', min: 1, max: 512 },
        { name: 'tileHeight', type: 'number', min: 1, max: 512 },
        { name: 'texture', type: 'number' },
        { name: 'tilesetColumns', type: 'number', min: 1, max: 256 },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX },
    ],
};

export const tilemapPlugin: EditorPlugin = {
    name: 'tilemap',
    register() {
        registerComponentSchema(TilemapSchema);
        registerComponentSchema(TilemapLayerSchema);
    },
};
