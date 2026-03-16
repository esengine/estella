import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { getSettingsValue } from '../settings/SettingsRegistry';
import { Constraints } from '../schemas/schemaConstants';

const NameSchema = defineSchema('Name', {
    removable: false,
});

const ParentSchema = defineSchema('Parent', {
    removable: false,
    hidden: true,
    overrides: {
        entity: { type: 'entity' },
    },
});

const ChildrenSchema = defineSchema('Children', {
    category: 'tag',
    removable: false,
    hidden: true,
});

const TransformSchema = defineSchema('Transform', {
    removable: false,
    overrides: {
        rotation: { type: 'euler' },
    },
});

const VelocitySchema = defineSchema('Velocity', {
});

const SceneOwnerSchema = defineSchema('SceneOwner', {
    removable: false,
});

const CanvasSchema = defineSchema('Canvas', {
    editorDefaults: () => {
        const ppu = getSettingsValue<number>('rendering.pixelsPerUnit');
        if (ppu != null) {
            return { pixelsPerUnit: ppu };
        }
        return null;
    },
    overrides: {
        pixelsPerUnit: { min: 1, step: 1 },
        scaleMode: {
            type: 'enum',
            options: [
                { label: 'FixedWidth', value: 0 },
                { label: 'FixedHeight', value: 1 },
                { label: 'Expand', value: 2 },
                { label: 'Shrink', value: 3 },
                { label: 'Match', value: 4 },
            ],
        },
        matchWidthOrHeight: { min: 0, max: 1, step: 0.1 },
    },
});

const CameraSchema = defineSchema('Camera', {
    overrides: {
        priority: { ...Constraints.positiveInt },
        projectionType: {
            type: 'enum',
            displayName: 'Projection',
            options: [
                { label: 'Perspective', value: 0 },
                { label: 'Orthographic', value: 1 },
            ],
        },
        fov: {
            ...Constraints.fov,
            displayName: 'Field of View',
            visibleWhen: { field: 'projectionType', equals: 0 },
        },
        orthoSize: {
            min: 0.1,
            displayName: 'Size',
            visibleWhen: { field: 'projectionType', equals: 1 },
        },
        nearPlane: { step: 0.1, displayName: 'Near', group: 'Clipping' },
        farPlane: { step: 1, displayName: 'Far', group: 'Clipping' },
        viewportX: { ...Constraints.percentage, group: 'Viewport' },
        viewportY: { ...Constraints.percentage, group: 'Viewport' },
        viewportW: { ...Constraints.percentage, group: 'Viewport' },
        viewportH: { ...Constraints.percentage, group: 'Viewport' },
        clearFlags: {
            type: 'enum',
            group: 'Viewport',
            options: [
                { label: 'None', value: 0 },
                { label: 'Color Only', value: 1 },
                { label: 'Depth Only', value: 2 },
                { label: 'Color + Depth', value: 3 },
            ],
        },
        showFrustum: { group: 'Debug' },
    },
});

export const coreComponentsPlugin: EditorPlugin = {
    name: 'core-components',
    register(_ctx: EditorPluginContext) {},
};

export { TransformSchema, CameraSchema };
