import {
    defineSystem, EventReader, ResMut,
} from 'esengine';
import { CollectEventDef, Score } from '../events';

export const scoreSystem = defineSystem(
    [EventReader(CollectEventDef), ResMut(Score)],
    (reader, score) => {
        for (const event of reader) {
            score.value += event.points;
        }
    },
    { name: 'ScoreSystem' }
);
