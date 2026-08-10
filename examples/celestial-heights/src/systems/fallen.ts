import {
    defineSystem, Query, Mut, Res, EventReader, Time, SceneManager, UINode, UIDisplay,
} from 'esengine';
import { FallenOverlay } from '../components';
import { Died } from '../events';
import { saves, SLOT, type RunState } from '../save';
import { session } from '../state';

/** How long the fallen screen holds before the run picks itself back up. */
const FALLEN_SECONDS = 2.2;

/**
 * What happens when Lyra runs out. A death that only empties a bar is a game
 * that stopped without saying so, so this is the one place the run ends and
 * starts again: the last save if there is one, and otherwise the area she fell
 * in, brought back up from its own data.
 */
export const fallenSystem = defineSystem(
    [EventReader(Died), Res(Time), Res(SceneManager)],
    (deaths, time, scenes) => {
        for (const death of deaths) {
            if (death.isPlayer && session.fallenFor <= 0) session.fallenFor = FALLEN_SECONDS;
        }
        if (session.fallenFor <= 0) return;

        // Real seconds: the fallen screen is not part of the simulation, and the
        // simulation is exactly what has been stopped.
        session.fallenFor -= time.unscaledDelta;
        if (session.fallenFor > 0) return;
        session.fallenFor = 0;

        const run = saves.load<RunState>(SLOT);
        if (run) {
            session.inventory = { ...(run.pack ?? {}) };
            session.restore = run;
            if (scenes.getActive() !== run.area) {
                void scenes.switchTo(run.area, { transition: 'fade', duration: 0.3 });
                return;
            }
        }
        // No save, or one taken in this very area: either way the area itself has
        // to come back — its enemies are as dead as she is.
        void scenes.reload({ transition: 'fade', duration: 0.3 });
    },
    { name: 'FallenSystem' },
);

/** Freezes the world while the fallen screen is up, and shows it. */
export const fallenOverlaySystem = defineSystem(
    [Query(Mut(UINode), FallenOverlay)],
    (overlays) => {
        const display = session.fallenFor > 0 ? UIDisplay.Flex : UIDisplay.None;
        for (const [, node] of overlays) {
            if (node.display !== display) node.display = display;
        }
    },
    { name: 'FallenOverlaySystem' },
);
