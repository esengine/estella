// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/layout.ts
 * @brief   Layout concept — the Yoga-backed layout driver.
 *
 * Owns the PreUpdate `UILayoutSystem` (drives the C++ Yoga pass via
 * `uiLayout_update` + `transform_update`) plus the PostUpdate late/final
 * passes that re-solve after scroll/list mutations. Co-located with the
 * `flex`/`grid`/`safe-area` schemas in this module.
 *
 * Behaviour is byte-identical to the former flat `UILayoutPlugin.ts`, which
 * now re-exports from here (strangler-fig; legacy public symbols kept as
 * shims).
 */
import type { App, Plugin } from '../../app';
import { registerComponent } from '../../component';
import { defineSystem, Schedule } from '../../system';
import { SystemLabel } from '../../systemLabels';
import { Res } from '../../resource';
import { UINode } from '../core/ui-node';
import { UIVisual } from '../core/ui-visual';
import { FlexContainer } from './flex';
import { UICameraInfo } from '../UICameraInfo';
import type { UICameraData } from '../UICameraInfo';
import { UILayoutGeneration } from '../UILayoutGeneration';
import type { UILayoutGenerationData } from '../UILayoutGeneration';
import type { ESEngineModule } from '../../wasm';
import type { CppRegistry } from '../../wasm';
import { initUIHelpers } from '../uiHelpers';

export class UILayoutPlugin implements Plugin {
    name = 'uiLayout';

    build(app: App): void {
        registerComponent('UINode', UINode);
        registerComponent('UIVisual', UIVisual);
        registerComponent('FlexContainer', FlexContainer);

        const world = app.world;
        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;

        initUIHelpers(module, registry);

        const layoutGen: UILayoutGenerationData = { generation: 0 };
        app.insertResource(UILayoutGeneration, layoutGen);

        const layoutFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            module.uiLayout_update(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
            );
            module.transform_update(registry);
            layoutGen.generation++;
        };

        const layoutOnlyFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            module.uiLayout_update(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
            );
            layoutGen.generation++;
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutFn,
            { name: 'UILayoutSystem' }
        ));

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutOnlyFn,
            { name: 'UILayoutLateSystem' }
        ), { runBefore: [SystemLabel.UIRenderOrder] });

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => { module.transform_update(registry); },
            { name: 'UITransformFinalSystem' }
        ), { runAfter: [SystemLabel.ListView], runBefore: [SystemLabel.UIRenderOrder] });
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();
