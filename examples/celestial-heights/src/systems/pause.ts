import { defineSystem, Query, Mut, Res, Input, UINode, UIDisplay } from 'esengine';
import { PauseOverlay } from '../components';
import { session } from '../state';

// Both systems stay OUT of the gameplay set: one has to be able to lift the
// pause, and the other has to be able to draw it.

// ENGINE-GAP(no-simulation-pause): this pause reaches the project's systems and
// nothing the engine drives, so the world keeps moving behind the overlay.

export const pauseInputSystem = defineSystem(
    [Res(Input)],
    (input) => {
        if (input.isKeyPressed('Escape')) session.paused = !session.paused;
    },
    { name: 'PauseInputSystem' },
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
