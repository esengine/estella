import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { initParticleAPI, shutdownParticleAPI, Particle } from './ParticleAPI';

export class ParticlePlugin implements Plugin {
    name = 'ParticlePlugin';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        initParticleAPI(module, registry);

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                Particle.update(time.delta);
            },
            { name: 'ParticleSystem' }
        ));
    }

    cleanup(): void {
        shutdownParticleAPI();
    }
}

export const particlePlugin = new ParticlePlugin();
