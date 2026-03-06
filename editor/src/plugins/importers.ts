import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';

export const importersPlugin: EditorPlugin = {
    name: 'importers',
    dependencies: ['asset-infra'],
    register(_ctx: EditorPluginContext) {
    },
};
