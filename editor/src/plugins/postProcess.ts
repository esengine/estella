import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { registerPostProcessVolumeInspector } from '../panels/inspector/PostProcessVolumeInspector';

const PostProcessVolumeSchema: ComponentSchema = {
    name: 'PostProcessVolume',
    category: 'builtin',
    properties: [],
};

export const postProcessPlugin: EditorPlugin = {
    name: 'post-process',
    register() {
        registerComponentSchema(PostProcessVolumeSchema);
        registerPostProcessVolumeInspector();
    },
};
