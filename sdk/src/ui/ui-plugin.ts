// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/ui-plugin.ts
 * @brief   UIPlugin — the single declarative UI pipeline.
 *
 * Composes the separate concept plugins (layout, mask, safe-area, text,
 * interaction, behavior, controller, drag, focus, text-input, render-order) into one
 * plugin so the app's plugin list carries a single UI entry instead of ten
 * hand-ordered ones. System *execution* order is still defined declaratively by
 * each system's runAfter/runBefore labels; composition only fixes *build* order
 * so resources exist before their readers (UIInteraction inserts UIEvents before
 * UIBehavior reads it at build). The concept plugins stay individually exported
 * for granular/advanced wiring (e.g. a layout-only test harness).
 */
import type { App, Plugin } from '../app';
import type { Entity } from '../types';

import { uiLayoutPlugin } from './layout/layout';
import { uiMaskPlugin } from './render/mask';
import { safeAreaPlugin } from './layout/safe-area';
import { textPlugin } from './text/plugin';
import { inlineImagePlugin } from './text/inline-image-plugin';
import { uiInteractionPlugin } from './input/interaction';
import { uiBehaviorPlugin } from './behavior/plugin';
import { uiControllerPlugin } from './controller/plugin';
import { dragPlugin } from './input/drag';
import { focusPlugin } from './input/focus';
import { textInputPlugin } from './text/text-input-plugin';
import { uiRenderOrderPlugin } from './render/render-order';

import type { UIEventQueue } from './core/events';
import type { ListView } from './collection/list-view';
import type { ScrollContainer } from './collection/scroll-container';

// Build order is dependency-ordered (not execution order): layout first (it
// owns the layout resources), then interaction before behavior so the shared
// UIEvents resource exists when behavior reads it at build.
const SUB_PLUGINS: Plugin[] = [
    uiLayoutPlugin,
    uiMaskPlugin,
    safeAreaPlugin,
    textPlugin,
    inlineImagePlugin,
    uiInteractionPlugin,
    uiBehaviorPlugin,
    uiControllerPlugin,
    dragPlugin,
    focusPlugin,
    textInputPlugin,
    uiRenderOrderPlugin,
];

export class UIPlugin implements Plugin {
    name = 'ui';

    build(app: App): void {
        for (const plugin of SUB_PLUGINS) {
            plugin.build(app);
        }
    }

    // App.quit only reaches *installed* plugins — the composed sub-plugins'
    // cleanups are unreachable unless forwarded here.
    cleanup(app?: App): void {
        for (let i = SUB_PLUGINS.length - 1; i >= 0; i--) {
            SUB_PLUGINS[i].cleanup?.(app);
        }
    }

    /** Shared UI event bus (delegates to the behavior layer). */
    get events(): UIEventQueue {
        return uiBehaviorPlugin.events;
    }

    registerListView(list: ListView<unknown>): void {
        uiBehaviorPlugin.registerListView(list);
    }

    unregisterListView(list: ListView<unknown>): void {
        uiBehaviorPlugin.unregisterListView(list);
    }

    attachScrollContainer(entity: Entity, container: ScrollContainer): void {
        uiBehaviorPlugin.attachScrollContainer(entity, container);
    }

    detachScrollContainer(entity: Entity): void {
        uiBehaviorPlugin.detachScrollContainer(entity);
    }
}

export const uiPlugin = new UIPlugin();
