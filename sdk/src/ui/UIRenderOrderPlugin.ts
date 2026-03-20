import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { PluginName } from '../systemLabels';

export class UIRenderOrderPlugin implements Plugin {
    name = PluginName.UIRenderOrder;
    dependencies = [PluginName.UILayout];
    after = [
        PluginName.Text, PluginName.Image, PluginName.UIMask,
        PluginName.UIInteraction, PluginName.ScrollView,
        PluginName.CollectionView, PluginName.LayoutGroup,
    ];

    build(app: App): void {
        const world = app.world;
        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => { module.uiRenderOrder_update(registry); },
            { name: 'UIRenderOrderSystem' }
        ));
    }
}

export const uiRenderOrderPlugin = new UIRenderOrderPlugin();
