import { defineSystem, Query, Mut, Res, Time, GetWorld, setControllerPage } from 'esengine';
import { GameState } from '../components';

// The round owns the clock and nothing else: when it runs out it moves the
// canvas to its `over` page, and what that page looks like is authored there.
export const roundSystem = defineSystem(
    [Query(Mut(GameState)), Res(Time), GetWorld()],
    (games, time, world) => {
        for (const [entity, state] of games) {
            if (!state.running) continue;
            state.timeLeft = Math.max(0, state.timeLeft - time.delta);
            if (state.timeLeft > 0) continue;
            state.running = false;
            setControllerPage(world, entity, 'screens', 'over');
        }
    },
    { name: 'RoundSystem' },
);
