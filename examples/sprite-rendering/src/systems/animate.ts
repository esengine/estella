import {
    defineSystem, Query, Mut, Res, Time,
    Transform, Sprite,
} from 'esengine';
import { Wave, Orbit, FlipDemo } from '../components';

export const waveSystem = defineSystem(
    [Query([Mut(Transform), Wave]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, wave] of query) {
            transform.position.x += Math.sin(time.elapsed * wave.frequency + wave.phase) * wave.amplitude * time.delta;
        }
    },
    { name: 'WaveSystem' }
);

export const orbitSystem = defineSystem(
    [Query([Mut(Transform), Mut(Orbit)]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, orbit] of query) {
            orbit.angle += orbit.speed * time.delta;
            transform.position.x = orbit.centerX + Math.cos(orbit.angle) * orbit.radius;
            transform.position.y = orbit.centerY + Math.sin(orbit.angle) * orbit.radius;
        }
    },
    { name: 'OrbitSystem' }
);

export const flipSystem = defineSystem(
    [Query([Mut(Transform), FlipDemo]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform] of query) {
            const bounce = Math.sin(time.elapsed * 2) * 5;
            transform.position.y += bounce * time.delta;
        }
    },
    { name: 'FlipSystem' }
);
