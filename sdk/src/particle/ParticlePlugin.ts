import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Particle, ParticleAPI } from './ParticleAPI';

export class ParticlePlugin implements Plugin {
    name = 'particle';

    build(app: App): void {
        const module = app.wasmModule as ESEngineModule;
        const registry = app.world.getCppRegistry() as CppRegistry;
        app.insertResource(Particle, new ParticleAPI(module, registry));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Particle)],
            (time: TimeData, particle: ParticleAPI) => {
                particle.update(time.delta);
            },
            { name: 'ParticleSystem' }
        ));
    }
}

export const particlePlugin = new ParticlePlugin();
