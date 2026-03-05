import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { registerBoundsProvider } from '../bounds/BoundsRegistry';
import { spineAnimationBoundsProvider } from '../bounds/SpineAnimationBoundsProvider';
import {
    LAYER_MIN, LAYER_MAX,
    TIME_SCALE_MAX,
    SKELETON_SCALE_MIN, SKELETON_SCALE_MAX,
} from '../schemas/schemaConstants';

const SpineAnimationSchema: ComponentSchema = {
    name: 'SpineAnimation',
    category: 'builtin',
    properties: [
        { name: 'skeletonPath', type: 'spine-file', fileFilter: ['.json', '.skel'] },
        { name: 'atlasPath', type: 'spine-file', fileFilter: ['.atlas'] },
        { name: 'material', type: 'material-file' },
        { name: 'skin', type: 'spine-skin', dependsOn: 'skeletonPath' },
        { name: 'animation', type: 'spine-animation', dependsOn: 'skeletonPath' },
        { name: 'timeScale', type: 'number', min: 0, max: TIME_SCALE_MAX, step: 0.1 },
        { name: 'loop', type: 'boolean' },
        { name: 'playing', type: 'boolean' },
        { name: 'flipX', type: 'boolean' },
        { name: 'flipY', type: 'boolean' },
        { name: 'color', type: 'color' },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX },
        { name: 'skeletonScale', type: 'number', min: SKELETON_SCALE_MIN, max: SKELETON_SCALE_MAX, step: 0.01 },
    ],
};

export const spinePlugin: EditorPlugin = {
    name: 'spine',
    register() {
        registerComponentSchema(SpineAnimationSchema);
        registerBoundsProvider('SpineAnimation', spineAnimationBoundsProvider);
    },
};
