// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/plugin.ts
 * @brief   UIControllerPlugin — wires the controller/gear systems.
 *
 * Runs the `$interaction` driver after the hit-test has written UIInteraction,
 * then the gear-apply pass after the driver so a pointer-driven page change lands
 * the same frame. Neither system is play-gated: in edit mode the driver is inert
 * (no UIInteraction is written outside play), while gear-apply still reflects each
 * controller's authored `current` page — that is the editor's live preview.
 */
import type { App, Plugin } from '../../app';
import { Schedule } from '../../system';
import { SystemLabel } from '../../systemLabels';
import { createGearApplySystem, createInteractionControllerDriverSystem } from './gear-apply';

export class UIControllerPlugin implements Plugin {
    name = 'uiController';

    build(app: App): void {
        app.addSystemToSchedule(
            Schedule.Update,
            createInteractionControllerDriverSystem(app.world),
            { runAfter: [SystemLabel.UIInteraction] },
        );
        app.addSystemToSchedule(
            Schedule.Update,
            createGearApplySystem(app.world),
            { runAfter: ['InteractionControllerDriverSystem'] },
        );
    }
}

export const uiControllerPlugin = new UIControllerPlugin();
