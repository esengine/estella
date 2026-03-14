import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';

const DataBindingSchema: ComponentSchema = {
    name: 'DataBinding',
    category: 'ui',
    properties: [
        { name: 'source', type: 'string', tooltip: 'Resource name (e.g., "GameState")' },
        { name: 'bindings', type: 'data-bindings' },
    ],
    editorDefaults: () => ({ source: '', bindings: [] }),
};

export const dataBindingPlugin: EditorPlugin = {
    name: 'data-binding',
    dependencies: ['core-components'],
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, DataBindingSchema.name, DataBindingSchema);
    },
};
