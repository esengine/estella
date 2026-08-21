import { defineSystem, Query, Mut, Text } from 'esengine';
import { GameState, HudField, HudLabel } from '../components';

export const hudSystem = defineSystem(
    [Query(GameState), Query(HudLabel, Mut(Text))],
    (games, labels) => {
        const game = [...games][0];
        if (!game) return;
        const [, state] = game;
        for (const [, label, text] of labels) {
            if (label.field === HudField.Score) text.content = `Score ${state.score}`;
            else if (label.field === HudField.Time) text.content = `${state.timeLeft.toFixed(1)}s`;
            else text.content = `You scored ${state.score}`;
        }
    },
    { name: 'HudSystem' },
);
