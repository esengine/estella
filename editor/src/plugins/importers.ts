import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { getImporterRegistry } from '../asset/ImporterRegistry';

export const importersPlugin: EditorPlugin = {
    name: 'importers',
    dependencies: ['asset-infra'],
    register(_ctx: EditorPluginContext) {
        getImporterRegistry();
    },
};
