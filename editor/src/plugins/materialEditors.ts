import type { EditorPlugin } from './EditorPlugin';
import { registerMaterialEditors } from '../property/materialEditors';

export const materialEditorsPlugin: EditorPlugin = {
    name: 'material-editors',
    dependencies: ['core-property-editors'],
    register() {
        registerMaterialEditors();
    },
};
