// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scenePlugin.ts
 * @brief   Plugin that provides scene management capabilities
 */

import type { App, Plugin } from './app';
import { SceneManager, SceneManagerState } from './sceneManager';
import { SceneStreaming, SceneStreamingController } from './sceneStreaming';
import { defineSystem, Schedule, GetWorld } from './system';
import { Res, ResMut, Time } from './resource';
import { Transform, type TransformData } from './component';
import { playModeOnly } from './env';
import type { SystemDef } from './system';
import type { World } from './world';
import { log } from './logger';

const sceneTransitionSystem = defineSystem(
    [ResMut(SceneManager), Res(Time)],
    (scenesRes, time) => {
        const mgr = scenesRes.get();
        mgr.updateTransition(time.delta);
    },
    { name: 'SceneTransitionSystem' }
);

// Drives proximity streaming: pulls the focus from a follow-entity's Transform (if
// one is set), then reconciles resident cells. A no-op until cells are registered.
const sceneStreamingSystem = defineSystem(
    [Res(SceneStreaming), GetWorld()],
    (streaming: SceneStreamingController, world: World) => {
        const focus = streaming.getFocusEntity();
        if (focus != null && world.valid(focus) && world.has(focus, Transform)) {
            const t = world.get(focus, Transform) as TransformData;
            streaming.setFocus(t.position.x, t.position.y);
        }
        streaming.update();
    },
    { name: 'SceneStreamingSystem' }
);

export const sceneManagerPlugin: Plugin = {
    name: 'sceneManager',
    build(app: App): void {
        const state = new SceneManagerState(app);
        app.insertResource(SceneManager, state);
        app.insertResource(SceneStreaming, new SceneStreamingController(state));

        const initSystem: SystemDef = {
            _id: Symbol('SceneInitSystem'),
            _name: 'SceneInitSystem',
            _params: [],
            _fn: () => {
                const manager = app.getResource(SceneManager);
                const initial = manager.getInitial();
                if (initial) {
                    manager.load(initial).catch(err => {
                        log.error('scene', 'Failed to load initial scene', err);
                    });
                }
            },
        };

        app.addSystemToSchedule(Schedule.Startup, initSystem);
        app.addSystemToSchedule(Schedule.Last, sceneTransitionSystem);
        app.addSystemToSchedule(Schedule.Update, sceneStreamingSystem, { runIf: playModeOnly });
    },
};
