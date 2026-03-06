import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';
import { getSettingsValue } from '../settings/SettingsRegistry';
import { Constraints } from '../schemas/schemaConstants';

const NameSchema: ComponentSchema = {
    name: 'Name',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'value', type: 'string' },
    ],
};

const ParentSchema: ComponentSchema = {
    name: 'Parent',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'entity', type: 'entity' },
    ],
};

const ChildrenSchema: ComponentSchema = {
    name: 'Children',
    category: 'tag',
    removable: false,
    properties: [],
};

const TransformSchema: ComponentSchema = {
    name: 'Transform',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'position', type: 'vec3' },
        { name: 'rotation', type: 'euler' },
        { name: 'scale', type: 'vec3' },
    ],
};

const VelocitySchema: ComponentSchema = {
    name: 'Velocity',
    category: 'builtin',
    properties: [
        { name: 'linear', type: 'vec3' },
        { name: 'angular', type: 'vec3' },
    ],
};

const SceneOwnerSchema: ComponentSchema = {
    name: 'SceneOwner',
    category: 'builtin',
    removable: false,
    properties: [
        { name: 'scene', type: 'string' },
        { name: 'persistent', type: 'boolean' },
    ],
};

const CanvasSchema: ComponentSchema = {
    name: 'Canvas',
    category: 'builtin',
    editorDefaults: () => {
        const ppu = getSettingsValue<number>('rendering.pixelsPerUnit');
        if (ppu != null) {
            return { pixelsPerUnit: ppu };
        }
        return null;
    },
    properties: [
        { name: 'designResolution', type: 'vec2' },
        { name: 'pixelsPerUnit', type: 'number', min: 1, step: 1 },
        {
            name: 'scaleMode',
            type: 'enum',
            options: [
                { label: 'FixedWidth', value: 0 },
                { label: 'FixedHeight', value: 1 },
                { label: 'Expand', value: 2 },
                { label: 'Shrink', value: 3 },
                { label: 'Match', value: 4 },
            ],
        },
        { name: 'matchWidthOrHeight', type: 'number', min: 0, max: 1, step: 0.1 },
        { name: 'backgroundColor', type: 'color' },
    ],
};

const CameraSchema: ComponentSchema = {
    name: 'Camera',
    category: 'builtin',
    properties: [
        { name: 'isActive', type: 'boolean' },
        { name: 'priority', type: 'number', ...Constraints.positiveInt },
        {
            name: 'projectionType',
            type: 'enum',
            displayName: 'Projection',
            options: [
                { label: 'Perspective', value: 0 },
                { label: 'Orthographic', value: 1 },
            ],
        },
        { name: 'fov', type: 'number', ...Constraints.fov, displayName: 'Field of View',
          visibleWhen: { field: 'projectionType', equals: 0 } },
        { name: 'orthoSize', type: 'number', min: 0.1, displayName: 'Size',
          visibleWhen: { field: 'projectionType', equals: 1 } },
        { name: 'nearPlane', type: 'number', step: 0.1, displayName: 'Near', group: 'Clipping' },
        { name: 'farPlane', type: 'number', step: 1, displayName: 'Far', group: 'Clipping' },
        { name: 'viewportX', type: 'number', ...Constraints.percentage, group: 'Viewport' },
        { name: 'viewportY', type: 'number', ...Constraints.percentage, group: 'Viewport' },
        { name: 'viewportW', type: 'number', ...Constraints.percentage, group: 'Viewport' },
        { name: 'viewportH', type: 'number', ...Constraints.percentage, group: 'Viewport' },
        {
            name: 'clearFlags',
            type: 'enum',
            group: 'Viewport',
            options: [
                { label: 'None', value: 0 },
                { label: 'Color Only', value: 1 },
                { label: 'Depth Only', value: 2 },
                { label: 'Color + Depth', value: 3 },
            ],
        },
        { name: 'showFrustum', type: 'boolean', group: 'Debug' },
    ],
};

const CORE_SCHEMAS: ComponentSchema[] = [
    NameSchema, ParentSchema, ChildrenSchema, TransformSchema,
    VelocitySchema, SceneOwnerSchema, CanvasSchema, CameraSchema,
];

export const coreComponentsPlugin: EditorPlugin = {
    name: 'core-components',
    register(ctx: EditorPluginContext) {
        for (const schema of CORE_SCHEMAS) {
            ctx.registrar.provide(COMPONENT_SCHEMA, schema.name, schema);
        }
    },
};

export { TransformSchema, CameraSchema };
