import { defineComponent } from 'esengine';

export const Player = defineComponent('Player', {
    speed: 70,
});

/**
 * The clip that walks each way.
 *
 * Asset FIELDS, not paths in code: a clip nothing in the scene references is
 * one the scene never loads, so the switch would land on nothing at runtime.
 */
export const Facings = defineComponent('Facings', {
    down: '',
    left: '',
    right: '',
    up: '',
}, {
    assetFields: [
        { field: 'down', type: 'anim-clip' },
        { field: 'left', type: 'anim-clip' },
        { field: 'right', type: 'anim-clip' },
        { field: 'up', type: 'anim-clip' },
    ],
});

/** Something with a line to say when you stand next to it and press Space. */
export const Talkable = defineComponent('Talkable', {
    line: '',
    range: 24,
});

/** The one label the world talks through. */
export const SayLine = defineComponent('SayLine', {
    idle: 'Arrow keys or WASD to walk.',
});
