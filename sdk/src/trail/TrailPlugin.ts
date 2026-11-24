// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { PluginInstallations } from '../app/pluginInstallations';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import { fxPreviewOrPlayMode } from '../ecs/env';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { TrailRenderer } from '../ecs/component';
import { Trail, TrailAPI } from './TrailAPI';

export class TrailPlugin implements Plugin {
    name = 'trail';
    private readonly offDespawn_ = new PluginInstallations<() => void>();

    build(app: App): void {
        this.cleanup(app);
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets
        // the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new TrailAPI(engine, registry);
        app.insertResource(Trail, api);

        // Trail history lives in a C++ side table keyed by entity, not in the
        // component — drop it on despawn or the recorded points leak.
        this.offDespawn_.set(app, app.world.onDespawn((entity) => {
            if (app.world.has(entity, TrailRenderer)) api.clear(entity);
        }));

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

    cleanup(app?: App): void {
        this.offDespawn_.take(app)?.();
    }
}

export const trailPlugin = new TrailPlugin();
