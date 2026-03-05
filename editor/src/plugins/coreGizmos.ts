import type { EditorPlugin } from './EditorPlugin';
import { registerBuiltinGizmos } from '../gizmos/builtinGizmos';

export const coreGizmosPlugin: EditorPlugin = {
    name: 'core-gizmos',
    register() {
        registerBuiltinGizmos();
    },
};
