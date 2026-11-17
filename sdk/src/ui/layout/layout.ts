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
import { registerComponent, type AnyComponentDef } from '../../ecs/component';
import type { World } from '../../ecs/world';
import { defineSystem, Schedule } from '../../ecs/system';
import { SystemLabel } from '../../ecs/systemLabels';
import { Res } from '../../ecs/resource';
import { UINode } from '../core/ui-node';
import { UIVisual } from '../core/ui-visual';
import { FlexContainer } from './flex';
import { ScreenLayout } from '../core/screen-layout';
import type { ScreenLayoutData } from '../core/screen-layout';
import { UILayoutGeneration } from './ui-layout-generation';
import type { UILayoutGenerationData } from './ui-layout-generation';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';
import { initUIHelpers } from '../util/helpers';

export function changeGate(world: World, components: readonly AnyComponentDef[]): () => boolean {
    const latest = (): number => {
        let revision = 0;
        for (const component of components) {
            revision = Math.max(revision, world.mutationRevision(component, 'write'), world.mutationRevision(component, 'topology'));
        }
        return revision;
    };
    latest();
    let solved = -1;
    return () => {
        const revision = latest();
        const changed = revision !== solved;
        solved = revision;
        return changed;
    };
}

export class UILayoutPlugin implements Plugin {
    name = 'uiLayout';
    readonly profileDomain = 'ui';

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

        const propertyDirty = changeGate(world, [UINode, FlexContainer]);

        // The box is the SCREEN's: the design resolution fitted to the viewport,
        // centred on the origin — which is what makes a screen root's placement a
        // fact about the screen rather than about where something is looking.
        const solve = (screen: ScreenLayoutData): void => {
            const changed = engine?.uiLayout_update?.(
                registry,
                screen.left, screen.bottom,
                screen.right, screen.top,
                propertyDirty(),
            );
            if (changed !== false) layoutGen.generation++;
        };

        const layoutFn = (screen: ScreenLayoutData) => {
            if (!screen.valid) return;
            solve(screen);
            world.ensureTransformsComposed();
        };

        const layoutOnlyFn = (screen: ScreenLayoutData) => {
            if (!screen.valid) return;
            solve(screen);
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(ScreenLayout)],
            layoutFn,
            { name: 'UILayoutSystem', runWhenPaused: true }
        ));

        // No transform pass after the late layout: nothing between PostUpdate and
        // render reads world transforms (UIRenderOrder walks hierarchy only), and
        // the renderer's ensureTransformsUpdated composes worlds before collect.
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(ScreenLayout)],
            layoutOnlyFn,
            { name: 'UILayoutLateSystem', runWhenPaused: true }
        ), { runAfter: [SystemLabel.ListView], runBefore: [SystemLabel.UIRenderOrder] });
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();
