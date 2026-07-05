# Enemy AI

Two enemies hunt the player, each driven by a **different, editor-authored AI
asset**, but sharing the same senses and actions:

- **Enemy A** runs a **state machine** (`assets/ai/enemy.esfsm`): `Patrol ⇄ Chase`.
- **Enemy B** runs a **behavior tree** (`assets/ai/enemy.esbt`): a Selector that
  chases when it sees the player, otherwise patrols.

Move the player with **WASD** / arrow keys; walk into an enemy's sight range and
it paths toward you (A\* navigation), then breaks off and idles when you slip away.

## What it shows

- **Editor-authored AI assets, not code.** Open `assets/ai/enemy.esfsm` and
  `assets/ai/enemy.esbt` in the editor (double-click them in the Content Browser)
  to see and edit the graphs. The scene's `StateMachineAgent.fsm` /
  `BehaviorTreeAgent.bt` just point at these asset paths; the engine loads them —
  there is no `registerFsm`/`registerBt` in the project code.
- **A state machine and a behavior tree side by side** — the same behavior, two
  paradigms, so you can compare them.
- **One shared registry.** The `seesPlayer` / `lostPlayer` conditions and the
  `chase` / `patrol` actions (in `src/enemy.ts`) serve *both* the FSM and the BT.
- **Perception → decision → navigation.** A `Perceiver` senses the player (a
  `PerceptionTarget`) into a `Perception` component; the FSM/BT read it via
  `ctx.get(Perception)`; the `chase` action calls `setNavDestination`, and the
  built-in nav plugin paths the agent there.

## Files

- `assets/ai/enemy.esfsm` — the state machine (open it in the editor to edit).
- `assets/ai/enemy.esbt` — the behavior tree (open it in the editor to edit).
- `src/enemy.ts` — the shared conditions/actions + the startup nav grid.
- `src/player.ts` + `src/components.ts` — the WASD player and its `PlayerControl`.
- `src/main.ts` — registers the player + nav-grid systems (perception, the FSM/BT
  ticks and nav follow are all built-in engine plugins).

`StateMachineAgent` / `BehaviorTreeAgent` / `NavAgent` / `Perceiver` /
`PerceptionTarget` are engine built-ins, so they aren't declared in
`src/components.ts` — only the project's own `PlayerControl` is.
