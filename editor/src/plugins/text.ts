import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { textBoundsProvider } from '../bounds/TextBoundsProvider';
import { COMPONENT_SCHEMA, BOUNDS_PROVIDER } from '../container/tokens';
import { LAYER_MIN, LAYER_MAX, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../schemas/schemaConstants';

const TextSchema: ComponentSchema = {
    name: 'Text',
    category: 'ui',
    properties: [
        { name: 'content', type: 'string' },
        { name: 'fontFamily', type: 'font' },
        { name: 'fontSize', type: 'number', min: FONT_SIZE_MIN, max: FONT_SIZE_MAX },
        { name: 'color', type: 'color' },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        {
            name: 'verticalAlign',
            type: 'enum',
            options: [
                { label: 'Top', value: 0 },
                { label: 'Middle', value: 1 },
                { label: 'Bottom', value: 2 },
            ],
        },
        { name: 'wordWrap', type: 'boolean' },
        {
            name: 'overflow',
            type: 'enum',
            options: [
                { label: 'Visible', value: 0 },
                { label: 'Clip', value: 1 },
                { label: 'Ellipsis', value: 2 },
            ],
        },
        { name: 'lineHeight', type: 'number', min: 0.5, max: 3, step: 0.1 },
    ],
};

const BitmapTextSchema: ComponentSchema = {
    name: 'BitmapText',
    category: 'ui',
    properties: [
        { name: 'text', type: 'string' },
        { name: 'font', type: 'bitmap-font-file' },
        { name: 'color', type: 'color' },
        { name: 'fontSize', type: 'number', min: 0.1, step: 0.1 },
        {
            name: 'align',
            type: 'enum',
            options: [
                { label: 'Left', value: 0 },
                { label: 'Center', value: 1 },
                { label: 'Right', value: 2 },
            ],
        },
        { name: 'spacing', type: 'number', step: 0.1 },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX },
    ],
};

export const textPlugin: EditorPlugin = {
    name: 'text',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, TextSchema.name, TextSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, BitmapTextSchema.name, BitmapTextSchema);
        ctx.registrar.provide(BOUNDS_PROVIDER, 'Text', textBoundsProvider);
    },
};

export { TextSchema };
