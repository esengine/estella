import {
    defineSystem, Query, Mut, Res, Time,
    Transform, Sprite,
} from 'esengine';
import { Wave, Orbit, Spin } from '../components';

export const waveSystem = defineSystem(
    [Query(Mut(Transform), Wave), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, wave] of query) {
            transform.position.x += Math.sin(time.elapsed * wave.frequency + wave.phase) * wave.amplitude * time.delta;
        }
    },
    { name: 'WaveSystem' }
);

export const orbitSystem = defineSystem(
    [Query(Mut(Transform), Mut(Orbit)), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, orbit] of query) {
            orbit.angle += orbit.speed * time.delta;
            transform.position.x = orbit.centerX + Math.cos(orbit.angle) * orbit.radius;
            transform.position.y = orbit.centerY + Math.sin(orbit.angle) * orbit.radius;
        }
    },
    { name: 'OrbitSystem' }
);

export const spinSystem = defineSystem(
    [Query(Mut(Transform), Spin), Res(Time)],
    (query, time) => {
        for (const [_entity, transform] of query) {
            const angle = time.elapsed * 1.5;
            transform.rotation = { w: Math.cos(angle), x: 0, y: 0, z: Math.sin(angle) };
        }
    },
    { name: 'SpinSystem' }
);
