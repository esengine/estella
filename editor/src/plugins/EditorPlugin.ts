import type { Editor } from '../Editor';
import type { PluginRegistrar } from '../container';

export interface EditorPluginContext {
    registrar: PluginRegistrar;
    editor: Editor;
    projectPath: string | null;
    onOpenScene: (path: string) => void;
}

export interface EditorPlugin {
    name: string;
    dependencies?: string[];
    register(ctx: EditorPluginContext): void;
}
