import {
    defineSystem, Res, Time, EventWriter,
} from 'esengine';
import { SpawnRequestEvent } from '../events';

const SPAWN_INTERVAL = 1.5;
let timer = 0;

const COLORS = [
    { r: 1, g: 0.3, b: 0.3 },
    { r: 0.3, g: 1, b: 0.3 },
    { r: 0.3, g: 0.5, b: 1 },
    { r: 1, g: 0.8, b: 0.2 },
    { r: 0.8, g: 0.3, b: 1 },
];

export const timerSystem = defineSystem(
    [Res(Time), EventWriter(SpawnRequestEvent)],
    (time, writer) => {
        timer += time.delta;
        if (timer < SPAWN_INTERVAL) return;
        timer = 0;

        const x = (Math.random() - 0.5) * 600;
        const y = (Math.random() - 0.5) * 400;
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        writer.send({ x, y, color });
    },
    { name: 'TimerSystem' }
);
