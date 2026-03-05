import type { EditorPlugin } from './EditorPlugin';
import { getImporterRegistry } from '../asset/ImporterRegistry';

export const importersPlugin: EditorPlugin = {
    name: 'importers',
    dependencies: ['asset-infra'],
    register() {
        getImporterRegistry();
    },
};
