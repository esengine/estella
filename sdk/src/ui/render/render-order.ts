// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { defineSystem, Schedule } from '../../ecs/system';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';
import { PluginName } from '../../ecs/systemLabels';

export class UIRenderOrderPlugin implements Plugin {
    name = PluginName.UIRenderOrder;
    dependencies = [PluginName.UILayout];
    after = [
        PluginName.Text, PluginName.UIMask,
        PluginName.UIInteraction,
    ];

    build(app: App): void {
        const world = app.world;
        const engine = engineApi(app);
        const registry = world.getCppRegistry() as CppRegistry;

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => { engine?.uiRenderOrder_update?.(registry); },
            { name: 'UIRenderOrderSystem' }
        ));
    }
}

export const uiRenderOrderPlugin = new UIRenderOrderPlugin();
