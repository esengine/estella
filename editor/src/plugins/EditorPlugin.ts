import type { PluginRegistrar } from '../container';

export interface EditorPluginContext {
    registrar: PluginRegistrar;
    projectPath: string | null;
}

export interface EditorPlugin {
    name: string;
    dependencies?: string[];
    register(ctx: EditorPluginContext): void;
}
