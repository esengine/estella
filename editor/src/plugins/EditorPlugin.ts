import type { Editor } from '../Editor';

export interface EditorPluginContext {
    editor: Editor;
    projectPath: string | null;
    onOpenScene: (path: string) => void;
}

export interface EditorPlugin {
    name: string;
    dependencies?: string[];
    register(ctx: EditorPluginContext): void;
}
