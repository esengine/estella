import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { registerPostProcessVolumeInspector } from '../panels/inspector/PostProcessVolumeInspector';
import { COMPONENT_SCHEMA } from '../container/tokens';

const PostProcessVolumeSchema: ComponentSchema = {
    name: 'PostProcessVolume',
    category: 'builtin',
    properties: [],
};

export const postProcessPlugin: EditorPlugin = {
    name: 'post-process',
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, PostProcessVolumeSchema.name, PostProcessVolumeSchema);
        registerPostProcessVolumeInspector(ctx.registrar);
    },
};
