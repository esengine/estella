import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';

const CollectionViewSchema: ComponentSchema = {
    name: 'CollectionView',
    category: 'ui',
    properties: [
        { name: 'itemCount', type: 'number', min: 0 },
        { name: 'layout', type: 'enum', options: [
            { label: 'Linear', value: 'linear' },
            { label: 'Grid', value: 'grid' },
            { label: 'Fan', value: 'fan' },
        ]},
        { name: 'virtualized', type: 'boolean' },
        { name: 'overscan', type: 'number', min: 0, max: 10 },
        { name: 'selectionMode', type: 'enum', options: [
            { label: 'None', value: 0 },
            { label: 'Single', value: 1 },
            { label: 'Multiple', value: 2 },
        ]},
        { name: 'itemPrefab', type: 'string' },
    ],
};

const LinearLayoutSchema: ComponentSchema = {
    name: 'LinearLayout',
    category: 'ui',
    properties: [
        { name: 'direction', type: 'enum', options: [
            { label: 'Horizontal', value: 0 },
            { label: 'Vertical', value: 1 },
        ]},
        { name: 'itemSize', type: 'number', min: 1 },
        { name: 'spacing', type: 'number', min: 0 },
        { name: 'reverseOrder', type: 'boolean' },
    ],
};

const GridLayoutSchema: ComponentSchema = {
    name: 'GridLayout',
    category: 'ui',
    properties: [
        { name: 'direction', type: 'enum', options: [
            { label: 'Vertical', value: 0 },
            { label: 'Horizontal', value: 1 },
        ]},
        { name: 'crossAxisCount', type: 'number', min: 1, max: 20 },
        { name: 'itemSize', type: 'vec2' },
        { name: 'spacing', type: 'vec2' },
    ],
};

const FanLayoutSchema: ComponentSchema = {
    name: 'FanLayout',
    category: 'ui',
    properties: [
        { name: 'radius', type: 'number', min: 10 },
        { name: 'maxSpreadAngle', type: 'number', min: 0, max: 180 },
        { name: 'maxCardAngle', type: 'number', min: 0, max: 45 },
        { name: 'tiltFactor', type: 'number', min: -2, max: 2, step: 0.1 },
        { name: 'cardSpacing', type: 'number', min: 0, step: 1 },
        { name: 'direction', type: 'enum', options: [
            { label: 'Up', value: 0 },
            { label: 'Down', value: 1 },
        ]},
    ],
};

const SelectableSchema: ComponentSchema = {
    name: 'Selectable',
    category: 'ui',
    properties: [
        { name: 'selected', type: 'boolean' },
        { name: 'group', type: 'number', min: 0 },
    ],
};

const CollectionItemSchema: ComponentSchema = {
    name: 'CollectionItem',
    category: 'tag',
    removable: false,
    properties: [
        { name: 'dataIndex', type: 'number', readOnly: true },
        { name: 'selected', type: 'boolean', readOnly: true },
    ],
};

export const collectionViewEditorPlugin: EditorPlugin = {
    name: 'collection-view',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, CollectionViewSchema.name, CollectionViewSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, LinearLayoutSchema.name, LinearLayoutSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, GridLayoutSchema.name, GridLayoutSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, FanLayoutSchema.name, FanLayoutSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, CollectionItemSchema.name, CollectionItemSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, SelectableSchema.name, SelectableSchema);
    },
};
