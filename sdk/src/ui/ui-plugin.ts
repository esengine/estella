// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/ui-plugin.ts
 * @brief   UIPlugin — the single declarative UI pipeline.
 *
 * Composes the formerly separate concept plugins (layout, mask, safe-area,
 * text, interaction, behavior, drag, focus, text-input, render-order) into one
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
import { uiInteractionPlugin } from './input/interaction';
import { uiBehaviorPlugin } from './behavior/plugin';
import { dragPlugin } from './input/drag';
import { focusPlugin } from './input/focus';
import { textInputPlugin } from './text/text-input-plugin';
import { uiRenderOrderPlugin } from './render/render-order';

import type { UIEventQueue } from './core/events';
import type { ListView } from './collection/list-view';
import type { ScrollContainer } from './collection/scroll-container';

export class UIPlugin implements Plugin {
    name = 'ui';

    build(app: App): void {
        // Build order is dependency-ordered (not execution order): layout first
        // (it owns the layout resources), then interaction before behavior so
        // the shared UIEvents resource exists when behavior reads it at build.
        uiLayoutPlugin.build(app);
        uiMaskPlugin.build(app);
        safeAreaPlugin.build(app);
        textPlugin.build(app);
        uiInteractionPlugin.build(app);
        uiBehaviorPlugin.build(app);
        dragPlugin.build(app);
        focusPlugin.build(app);
        textInputPlugin.build(app);
        uiRenderOrderPlugin.build(app);
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
