import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { registerBuiltinPanels } from '../panels/builtinPanels';

export const corePanelsPlugin: EditorPlugin = {
    name: 'core-panels',
    register(ctx: EditorPluginContext) {
        registerBuiltinPanels(ctx.registrar, {
            projectPath: ctx.projectPath ?? undefined,
            onOpenScene: ctx.onOpenScene,
        });
    },
};
