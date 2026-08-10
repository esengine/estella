import { defineSystem, Query, Mut, ResMut, Time, UINode, UIDisplay } from 'esengine';
import { Actions } from '../actions';
import { PauseOverlay } from '../components';
import { session } from '../state';

// These systems stay OUT of the gameplay set: one has to be able to lift the
// pause, and the others have to be able to draw it and to stop the world.

export const pauseInputSystem = defineSystem(
    [],
    () => {
        if (Actions.pressed('Pause')) session.paused = !session.paused;
    },
    { name: 'PauseInputSystem' },
);

/**
 * Stops the simulation. The run condition on the gameplay set only reaches this
 * project's systems; everything the engine drives — the character controller
 * integrating the velocity last written, navigation, behaviour trees — advances
 * by `Time.delta`, so setting the scale to zero is what actually holds the world.
 */
export const pauseTimeSystem = defineSystem(
    [ResMut(Time)],
    (time) => {
        const scale = session.paused ? 0 : 1;
        if (time.get().scale !== scale) time.modify((t) => { t.scale = scale; });
    },
    { name: 'PauseTimeSystem' },
);

export const pauseOverlaySystem = defineSystem(
    [Query(Mut(UINode), PauseOverlay)],
    (overlays) => {
        const display = session.paused ? UIDisplay.Flex : UIDisplay.None;
        for (const [, node] of overlays) {
            if (node.display !== display) node.display = display;
        }
    },
    { name: 'PauseOverlaySystem' },
);
