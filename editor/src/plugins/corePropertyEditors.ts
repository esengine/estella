import type { EditorPlugin } from './EditorPlugin';
import { registerBuiltinEditors } from '../property/editors';

export const corePropertyEditorsPlugin: EditorPlugin = {
    name: 'core-property-editors',
    register() {
        registerBuiltinEditors();
    },
};
