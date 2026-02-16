/**
 * @file    scenePlugin.ts
 * @brief   Plugin that provides scene management capabilities
 */

import type { App, Plugin } from './app';
import { SceneManager, SceneManagerState } from './sceneManager';
import { defineSystem, Schedule } from './system';
import { Res, ResMut, Time } from './resource';
import type { SystemDef } from './system';

const sceneTransitionSystem = defineSystem(
    [ResMut(SceneManager), Res(Time)],
    (scenesRes, time) => {
        const mgr = scenesRes.get();
        mgr.updateTransition(time.delta);
    },
    { name: 'SceneTransitionSystem' }
);

export const sceneManagerPlugin: Plugin = {
    name: 'SceneManager',
    build(app: App): void {
        const state = new SceneManagerState(app);
        app.insertResource(SceneManager, state);

        const initSystem: SystemDef = {
            _id: Symbol('SceneInitSystem'),
            _name: 'SceneInitSystem',
            _params: [],
            _fn: () => {
                const manager = app.getResource(SceneManager);
                const initial = manager.getInitial();
                if (initial) {
                    manager.load(initial).catch(err => {
                        console.error('Failed to load initial scene:', err);
                    });
                }
            },
        };

        app.addSystemToSchedule(Schedule.Startup, initSystem);
        app.addSystemToSchedule(Schedule.Last, sceneTransitionSystem);
    },
};
