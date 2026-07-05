# Enemy AI

Two enemies **patrol** until they **sense** the player, then **chase** via A\*
navigation — a state machine and the nav agent working together. Move the player
with **WASD** / arrow keys; walk within range and the red enemies path toward you,
break off and idle when you slip away.

## What it shows

- **State machine** (`registerFsm`) as pure data: `Patrol ⇄ Chase`, switched by a
  `seesPlayer` blackboard guard. Authorable in the editor's State Machine editor
  (a `.esfsm` asset) or in code as here.
- **Named actions** (`registerAction`): the `chase` leaf steers the agent's
  NavAgent at the player — decision (FSM) and locomotion (nav) stay decoupled.
- **Navigation** (`NavGrid` + `NavAgent` + `setNavDestination`): grid A\* plans the
  path; the built-in nav plugin follows it. No per-frame movement code.
- **Perception** feeding the blackboard: a small system writes `seesPlayer` from
  enemy↔player distance, which the FSM guard reads.

## Files

- `src/enemy.ts` — the FSM definition, the `chase` action, the perception system,
  and the startup grid.
- `src/player.ts` — the WASD-controlled player.
- `src/main.ts` — registers the systems (the fsm/nav plugins are built in).

The `StateMachineAgent` and `NavAgent` components are attached to the enemies in
`assets/scenes/main.esscene`; the FSM they reference (`"enemy"`) is registered in
code. Both are engine built-ins — no plugin wiring needed.
