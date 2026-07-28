// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/layout.ts
 * @brief   Layout concept — the Yoga-backed layout driver.
 *
 * Owns the PreUpdate `UILayoutSystem` (drives the C++ Yoga pass via
 * `uiLayout_update` + `transform_update`) plus the PostUpdate late pass
 * that re-solves after scroll/list mutations. Co-located with the
 * `flex`/`safe-area` schemas in this module.
 */
import type { App, Plugin } from '../../app/app';
import { registerComponent } from '../../ecs/component';
import { defineSystem, Schedule } from '../../ecs/system';
import { SystemLabel } from '../../ecs/systemLabels';
import { Res } from '../../ecs/resource';
import { UINode } from '../core/ui-node';
import { UIVisual } from '../core/ui-visual';
import { FlexContainer } from './flex';
import { UICameraInfo } from '../core/ui-camera-info';
import type { UICameraData } from '../core/ui-camera-info';
import { UILayoutGeneration } from './ui-layout-generation';
import type { UILayoutGenerationData } from './ui-layout-generation';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';
import { initUIHelpers } from '../util/helpers';

export class UILayoutPlugin implements Plugin {
    name = 'uiLayout';

    build(app: App): void {
        registerComponent('UINode', UINode);
        registerComponent('UIVisual', UIVisual);
        registerComponent('FlexContainer', FlexContainer);

        const world = app.world;
        // The wasm module on the web, the native host's bindings on a device —
        // the layout pass is the same either way.
        const engine = engineApi(app);
        const registry = world.getCppRegistry() as CppRegistry;

        initUIHelpers(engine, registry);

        const layoutGen: UILayoutGenerationData = { generation: 0 };
        app.insertResource(UILayoutGeneration, layoutGen);

        // Track UINode/FlexContainer edits so an authored change is an O(1) signal
        // the C++ solve honours (skip-when-clean). Every input write goes through
        // world.set / insert / Mut-writeback, which record the change; C++ writes
        // only layout OUTPUTS, and tween-driven Transform writes are covered by the
        // engine's own anim_override_ scan — so this pair is the complete authored
        // property signal.
        world.enableChangeTracking(UINode);
        world.enableChangeTracking(FlexContainer);

        // Ticks are per-frame, and both passes run within one tick, so a change can
        // still land at the current tick after this check. Report changes strictly
        // after `solvedTick`, then only advance the watermark to the PREVIOUS tick —
        // anyChangedSince uses '>', so using the current tick would drop a same-frame
        // write. The one extra solve this costs while a change settles is negligible.
        let solvedTick = -1;
        const propertyDirty = (): boolean => {
            const dirty = world.anyChangedSince(UINode, solvedTick)
                       || world.anyChangedSince(FlexContainer, solvedTick);
            solvedTick = world.getWorldTick() - 1;
            return dirty;
        };

        const layoutFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            engine?.uiLayout_update?.(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
                propertyDirty(),
            );
            engine?.transform_update?.(registry);
            layoutGen.generation++;
        };

        const layoutOnlyFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            engine?.uiLayout_update?.(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
                propertyDirty(),
            );
            layoutGen.generation++;
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutFn,
            { name: 'UILayoutSystem' }
        ));

        // No transform pass after the late layout: nothing between PostUpdate and
        // render reads world transforms (UIRenderOrder walks hierarchy only), and
        // the renderer's ensureTransformsUpdated composes worlds before collect.
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutOnlyFn,
            { name: 'UILayoutLateSystem' }
        ), { runAfter: [SystemLabel.ListView], runBefore: [SystemLabel.UIRenderOrder] });
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();
