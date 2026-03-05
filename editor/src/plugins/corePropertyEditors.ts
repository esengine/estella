import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinEditors } from '../property/editors';

export const corePropertyEditorsPlugin: EditorPlugin = {
    name: 'core-property-editors',
    register(ctx: EditorPluginContext) {
        registerBuiltinEditors(ctx.registrar);
    },
};
