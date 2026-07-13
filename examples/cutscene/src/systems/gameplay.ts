import {
    defineSystem, Query, Mut, Res, Time, Input, Transform,
    StateMachineAgent, AiFsm,
} from 'esengine';
import { HeroControl } from '../components';

// The whole cutscene runs in DATA: the director's FSM (assets/ai/director.esfsm)
// uses only the engine's built-in names — `timeline.play` on entering the
// Cutscene state, `timeline.finished` to leave it. Game code never touches the
// timeline; it just reads the FSM's observable state and moves the hero while
// the director is in Gameplay.

export const heroMoveSystem = defineSystem(
    [Query(Mut(Transform), HeroControl), Query(StateMachineAgent), Res(Input), Res(Time)],
    (heroes, directors, input, time) => {
        let inGameplay = false;
        for (const [, agent] of directors) {
            if (agent.current === 'Gameplay') { inGameplay = true; break; }
        }
        if (!inGameplay) return;

        for (const [, transform, hero] of heroes) {
            let dx = 0;
            let dy = 0;
            if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy += 1;
            if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy -= 1;
            if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx -= 1;
            if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx += 1;
            if (dx === 0 && dy === 0) continue;
            const len = Math.sqrt(dx * dx + dy * dy);
            transform.position.x += (dx / len) * hero.speed * time.delta;
            transform.position.y += (dy / len) * hero.speed * time.delta;
        }
    },
    { name: 'HeroMoveSystem' },
);

// R fires the `replay` trigger; the Gameplay → Cutscene transition consumes it
// and the Cutscene state's onEnter replays the finished clip from the top (the
// TimelinePlayer replay contract). Gated on Gameplay so a press during the
// cutscene can't queue a stale replay.
export const replaySystem = defineSystem(
    [Query(StateMachineAgent), Res(Input), Res(AiFsm)],
    (directors, input, fsm) => {
        if (!input.isKeyPressed('KeyR')) return;
        for (const [entity, agent] of directors) {
            if (agent.current === 'Gameplay') fsm.fire(entity, 'replay');
        }
    },
    { name: 'CutsceneReplaySystem' },
);
