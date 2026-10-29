// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/pass.ts
 * @brief   The end-of-frame pass that aligns widgets and arranges layouts.
 *
 * Cocos does both after the frame's scripts have run, so a script that moves or resizes something this frame is answered by the
 * alignment in the same frame. Widgets go first (a stretched container changes what its layout sees), then layouts innermost-first,
 * then widgets once more for the ones that follow a size the layouts just set (those set to align every frame).
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../../ecs/system';
import { setCurrentWorld } from '../node';
import { alignAllWidgets, declareWidget } from './widget';
import { layoutAll, declareLayout } from './layout';

export function declareUiPass(): void {
    declareWidget();
    declareLayout();
    const system = defineSystem(
        [GetWorld()],
        (world) => {
            const previous = setCurrentWorld(world);
            try {
                alignAllWidgets(world);
                layoutAll(world);
                alignAllWidgets(world);
            } finally {
                setCurrentWorld(previous);
            }
        },
        { name: 'Cocos:UiPass', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.Last, system);
}
