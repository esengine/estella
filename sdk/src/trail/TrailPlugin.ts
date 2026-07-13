// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { fxPreviewOrPlayMode } from '../env';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Trail, TrailAPI } from './TrailAPI';

export class TrailPlugin implements Plugin {
    name = 'trail';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new TrailAPI(module, registry);
        app.insertResource(Trail, api);

        // Trail point recording is gameplay — frozen in editor edit mode, runs in
        // play mode / standalone runtime (matches particles/animation/physics).
        // The FX edit-preview flag is the one authoring exception (env.ts):
        // with it on, dragging an entity in the viewport draws its trail live.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Trail)],
            (time: TimeData, trail: TrailAPI) => {
                trail.update(time.delta);
            },
            { name: 'TrailSystem' }
        ), { runIf: fxPreviewOrPlayMode });
    }
}

export const trailPlugin = new TrailPlugin();
