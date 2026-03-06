import type { EditorPlugin, EditorPluginContext } from '../plugins/EditorPlugin';

export class PluginManager {
    private plugins_: EditorPlugin[] = [];
    private pluginNames_ = new Set<string>();
    private context_: EditorPluginContext;

    constructor(context: EditorPluginContext) {
        this.context_ = context;
    }

    addPlugin(plugin: EditorPlugin): void {
        if (this.pluginNames_.has(plugin.name)) return;
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this.pluginNames_.has(dep)) {
                    throw new Error(`Plugin "${plugin.name}" requires "${dep}"`);
                }
            }
        }
        plugin.register(this.context_);
        this.plugins_.push(plugin);
        this.pluginNames_.add(plugin.name);
    }

    hasPlugin(name: string): boolean {
        return this.pluginNames_.has(name);
    }

    get plugins(): readonly EditorPlugin[] {
        return this.plugins_;
    }
}
