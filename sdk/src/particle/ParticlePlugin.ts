// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import { fxPreviewOrPlayMode } from '../env';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { registerSceneComponentCodec } from '../scene';
import { Particle, ParticleAPI } from './ParticleAPI';
import { bakeGradient, type Gradient } from './gradient';
import { bakeCurve, type Curve } from './curve';

export class ParticlePlugin implements Plugin {
    name = 'particle';

    /** Entity → authored color-over-life gradient (out-of-band; baked to the C++ LUT). */
    private readonly gradients_ = new Map<number, Gradient>();
    /** Entity → authored size-over-life curve (out-of-band; baked to the C++ LUT). */
    private readonly sizeCurves_ = new Map<number, Curve>();
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
        // Whichever core is present; a core built without ES_ENABLE_PARTICLES simply
        // answers no particle_* entry point, which the API already tolerates.
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets
        // the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new ParticleAPI(engine, registry);
        app.insertResource(Particle, api);

        // The color gradient is authored as stops in the component data but isn't a
        // C++ field — carry it out-of-band and bake it into the sim's LUT on load.
        const gradients = this.gradients_;
        const sizeCurves = this.sizeCurves_;

        this.offDespawn_ = app.world.onDespawn((entity) => {
            if (gradients.delete(entity)) api.setColorLut(entity, null);
            if (sizeCurves.delete(entity)) api.setSizeLut(entity, null);
        });

        registerSceneComponentCodec('ParticleEmitter', {
            outOfBandFields: ['colorGradient', 'sizeCurve'],
            importData: (entity, outOfBand) => {
                const g = outOfBand.colorGradient as Gradient | undefined;
                api.setColorLut(entity, bakeGradient(g));
                if (g?.stops?.length) gradients.set(entity, g);
                else gradients.delete(entity);

                const c = outOfBand.sizeCurve as Curve | undefined;
                api.setSizeLut(entity, bakeCurve(c));
                if (c?.keys?.length) sizeCurves.set(entity, c);
                else sizeCurves.delete(entity);
            },
            exportData: (entity, data) => {
                const g = gradients.get(entity);
                if (g) data.colorGradient = g;
                const c = sizeCurves.get(entity);
                if (c) data.sizeCurve = c;
            },
        });

        // Particle advance is gameplay — frozen in editor edit mode, runs in
        // play mode / standalone runtime (matches animation/physics/timeline).
        // The FX edit-preview flag is the one authoring exception (env.ts).
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Particle)],
            (time: TimeData, particle: ParticleAPI) => {
                particle.update(time.delta);
            },
            { name: 'ParticleSystem' }
        ), { runIf: fxPreviewOrPlayMode });
    }

    cleanup(): void {
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.gradients_.clear();
        this.sizeCurves_.clear();
    }
}

export const particlePlugin = new ParticlePlugin();
