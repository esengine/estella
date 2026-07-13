# Cutscene

A **code-free cutscene** driven by a state machine. The director entity carries a
`StateMachineAgent` and a `TimelinePlayer`; its FSM (`assets/ai/director.esfsm`)
uses only the engine's **built-in AI names**:

- entering the `Cutscene` state runs `timeline.play` → the intro timeline starts;
- the `timeline.finished` condition fires when the clip completes → transition to
  `Gameplay`.

The timeline (`assets/timelines/intro.estimeline`) hops the hero onto the stage
(property track on the `Hero` child) and holds the letterbox bars visible for the
shot (activation tracks on `BarTop`/`BarBottom`).

Game code (`src/systems/gameplay.ts`) never touches the timeline — it reads the
FSM's observable `current` state to enable hero movement, and fires the `replay`
trigger.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Move the hero (only once the cutscene has finished). |
| R | Replay the cutscene — the finished clip restarts from the top. |

## What to look at

- `assets/ai/director.esfsm` — the whole cutscene flow, no registered actions.
- `assets/timelines/intro.estimeline` — property + activation tracks by child path.
- `src/systems/gameplay.ts` — gating gameplay on `StateMachineAgent.current` and
  firing a trigger through the `AiFsm` resource.
