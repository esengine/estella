# Sprite Animation

The engine's frame-animation stack in one controllable scene: `.esanim` clips,
the `SpriteAnimator` playback channel, the **Animator state machine** (Unity
Animator model: parameters, triggers, 1D blend, exit time) on top of it, and
**frame events** turned into gameplay.

## Controls

| Input            | Action                                    |
| ---------------- | ----------------------------------------- |
| ←/→ or A/D       | Walk (the sprite flips with direction)    |
| hold Shift       | Run — the Move blend crosses its threshold and re-selects the walk clip at 1.9× |
| Space            | Hop — a trigger fires a non-looping clip; its exit time returns to Idle |

## How it works

- **Clips, two authoring paths** — `idle`/`walk` load from `.esanim` assets
  referenced by the scene; the `hop` clip is registered from code at startup
  (`SpriteAnimation.registerClip`), built out of frames the asset clips already
  loaded (`src/systems/setup.ts`).
- **The state machine** (`setup.ts`) declares a `speed` float and a `hop`
  trigger. `Idle ↔ Move` transitions compare `speed` against enter/exit
  thresholds; `Move` is a **1D blend** whose thresholds pick the walk clip at
  1.0× or 1.9× playback as `speed` rises — idle→walk→run from one parameter.
  `Hop` plays a non-looping clip and its `hasExitTime` transition auto-advances
  back to `Idle` when the clip finishes.
- **Control** (`src/systems/control.ts`) never touches the `SpriteAnimator`:
  it eases a velocity, writes `|vx|` into the `speed` parameter
  (`AnimatorController.setFloat`) and Space into the trigger (`setTrigger`).
  The state machine picks every clip — gameplay code and animation selection
  stay decoupled.
- **Frame events** (`setup.ts` + `src/systems/puffs.ts`) — the walk clip's two
  contact frames carry a `footstep` event; a global listener queues each one
  and `puffSystem` spawns a fading dust puff at the feet through `Commands`.
- The two **bystander aliens** run plain `SpriteAnimator` clips at their own
  speeds — the playback channel needs no state machine when a loop is all you
  want.

Play the scene in the editor and select the Player while it runs: the Details
panel shows `Animator.currentState` flipping between `Idle`, `Move`, and `Hop`
live.

## Files

```
assets/
  animations/         # idle.esanim, walk.esanim (the hop clip is code-registered)
  scenes/main.esscene # camera, ground, the FSM-driven player, two bystanders
src/
  main.ts             # registers the systems
  config.ts           # tuning (speeds, thresholds, hop arc, puff life)
  components.ts       # Player, Puff, the footstep event queue
  systems/
    setup.ts          # controller definition + hop clip + footstep events
    control.ts        # input → movement + Animator parameters
    puffs.ts          # footstep events → dust puffs
```
