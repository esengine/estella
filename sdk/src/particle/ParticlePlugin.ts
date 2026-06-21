import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { playModeOnly } from '../env';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Particle, ParticleAPI } from './ParticleAPI';

export class ParticlePlugin implements Plugin {
    name = 'particle';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        app.insertResource(Particle, new ParticleAPI(module, registry));

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
