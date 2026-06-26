// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { playModeOnly } from '../env';
import type { ESEngineModule, CppRegistry } from '../wasm';
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

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new ParticleAPI(module, registry);
        app.insertResource(Particle, api);

        // The color gradient is authored as stops in the component data but isn't a
        // C++ field — carry it out-of-band and bake it into the sim's LUT on load.
        const gradients = this.gradients_;
        const sizeCurves = this.sizeCurves_;
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
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Particle)],
            (time: TimeData, particle: ParticleAPI) => {
                particle.update(time.delta);
            },
            { name: 'ParticleSystem' }
        ), { runIf: playModeOnly });
    }
}

export const particlePlugin = new ParticlePlugin();
