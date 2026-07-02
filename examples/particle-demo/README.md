# Particle Effects

An interactive playground for the engine's `ParticleEmitter` component and the
`Particle` runtime API. A single emitter follows your mouse, leaving trails; you
switch its preset on the fly and fling fireworks with a click.

## Controls

| Input        | Action                                                        |
| ------------ | ------------------------------------------------------------- |
| Move mouse   | The follow emitter tracks the cursor (World space, so it trails) |
| `1`–`6`      | Jump to a preset                                              |
| `Space`      | Cycle to the next preset                                      |
| Left-click   | Spawn a one-shot firework burst at the cursor                 |
| `P`          | Pause / resume the follow stream                              |

## Presets

`1` Fire · `2` Sparks · `3` Smoke · `4` Magic · `5` Snow · `6` Fountain — each
remixes the emitter's shape, velocity, colour-over-life, size-over-life, gravity,
damping and blend mode (additive vs. normal). See `src/config.ts`.

## How it works

Particles are a plain ECS component (`ParticleEmitter`) simulated by the built-in
`ParticleSystem`. Nothing here runs per-particle code — a system only starts an
emitter, edits its fields, or calls the `Particle` resource.

- **The follow emitter** lives in the scene (so its `texture` resolves) with the
  lifecycle fields fixed (`looping`, `playOnStart`, `maxParticles`, World
  `simulationSpace`). `setupSystem` applies preset 0 at startup so `config.ts` is
  the single source for how each preset looks.
- **Switching presets** (`src/systems/control.ts`) mutates the emitter's fields
  live via `Query(Mut(ParticleEmitter))`. New particles adopt the look next
  frame; particles already alive finish with the look they were born with — a
  natural cross-fade, no reset needed.
- **Pausing** calls `Particle.stop(entity)` / `.play(entity)` — emission halts
  while live particles play out.
- **Click bursts** spawn a temporary emitter (`burstCount` > 0, `looping: false`,
  a short `duration` so it emits exactly once) that reuses the follow emitter's
  resolved `texture` handle. It has no self-despawn, so `cleanupSystem` removes it
  once `Particle.getAliveCount(entity)` reaches 0.

Particles draw as additive quads sampling `assets/textures/particle.png` (a soft
radial dot), so overlapping particles bloom into glows.

## Files

```
assets/
  scenes/main.esscene     # camera, dark backdrop, the follow emitter
  textures/particle.png   # soft radial particle sprite
src/
  main.ts                 # registers the four systems
  config.ts               # the six presets, the burst, applyPreset()
  components.ts           # Follow tag, Burst component
  systems/
    setup.ts              # applies preset 0 to the follow emitter
    follow.ts             # emitter tracks the cursor
    control.ts            # presets / pause / click-to-burst input
    cleanup.ts            # despawns fireworks once they finish
```
