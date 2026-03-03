import {
    defineSystem, Query, Mut, Res, Time, UIRect,
} from 'esengine';
import { Visualizer } from '../components';

let barIndex = 0;

export const visualizerSystem = defineSystem(
    [Query(Mut(UIRect), Visualizer), Res(Time)],
    (query, time) => {
        barIndex = 0;
        for (const [_entity, rect] of query) {
            const height = 20 + Math.abs(Math.sin(time.elapsed * 3 + barIndex * 0.5)) * 100;
            rect.size = { x: rect.size.x, y: height };
            barIndex++;
        }
    },
    { name: 'VisualizerSystem' }
);
