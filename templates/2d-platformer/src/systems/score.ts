import { defineSystem, Query, Mut, Text } from 'esengine';
import { ScoreDisplay } from '../components';

export const scoreSystem = defineSystem(
    [Query(ScoreDisplay, Mut(Text))],
    (query) => {
        for (const [_entity, score, text] of query) {
            text.content = `Score: ${score.score}`;
        }
    },
    { name: 'ScoreSystem' }
);
