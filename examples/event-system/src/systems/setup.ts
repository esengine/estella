import { defineSystem, Commands } from 'esengine';
import { Score } from '../events';

export const setupSystem = defineSystem(
    [Commands()],
    (cmds) => {
        cmds.insertResource(Score, { value: 0 });
    },
    { name: 'SetupSystem' }
);
