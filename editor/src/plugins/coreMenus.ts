import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinMenus } from '../menus/builtinMenus';
import { registerBuiltinStatusbarItems } from '../menus/builtinStatusbar';

export const coreMenusPlugin: EditorPlugin = {
    name: 'core-menus',
    register(ctx: EditorPluginContext) {
        registerBuiltinMenus(ctx.registrar, ctx.editor);
    },
};

export const coreStatusbarPlugin: EditorPlugin = {
    name: 'core-statusbar',
    dependencies: ['core-menus', 'core-panels'],
    register(ctx: EditorPluginContext) {
        registerBuiltinStatusbarItems(ctx.registrar, ctx.editor);
    },
};
