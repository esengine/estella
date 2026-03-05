import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinGizmos } from '../gizmos/builtinGizmos';

export const coreGizmosPlugin: EditorPlugin = {
    name: 'core-gizmos',
    register(ctx: EditorPluginContext) {
        registerBuiltinGizmos(ctx.registrar);
    },
};
