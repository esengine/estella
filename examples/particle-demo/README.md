# Particle Effects

A gallery of the engine's `ParticleEmitter`. Page through eleven composed effects
with on-screen buttons, and click empty space to throw fireworks.

## Controls

| Input                | Action                                          |
| -------------------- | ----------------------------------------------- |
| **Prev / Next** buttons | Page to the previous / next effect           |
| `←` / `→` / `Space`  | Same, from the keyboard                          |
| Left-click empty space | Throw a one-shot firework at the cursor        |

## The effects

`Campfire` (fire + smoke + embers) · `Fireworks` (staggered colored bursts) ·
`Magic Portal` (a swirling ring) · `Fountain` (ballistic jet + mist) ·
`Snowfall` (a wide, slow drift) · `Sparkles` (a twinkling field) ·
`Bursting Rockets` (**sub-emitter** — rockets that explode into a shell burst on
death) · `Turbulent Smoke` (curl-**noise** flow — smoke that rolls, embers that
weave) · `Comet Trails` (per-particle **trail** — sparks that drag fading ribbons) ·
`Vortex Galaxy` (**force fields** — a vortex + point pull swirl sparks into a spiral) ·
`Bouncing Sparks` (floor **collision** — a fountain that bounces and settles on a floor).
Each mixes shape, velocity, colour/size-over-life, gravity, spin, blend mode, and now
noise, sub-emitters, trails, force fields and collision — see `src/config.ts`.

## How it works

It's **one scene, no reloads** — each effect is a *group of emitters* spawned on
switch and despawned on the next switch, so the camera and UI persist and there's
no load latency. (Runtime `.esscene` switching exists via `SceneManager`, but
entity-group swapping is the idiomatic fit here.)

- **The buttons** are plain UI entities in the scene (`UINode` + `UIVisual` +
  `Button` + `Interactable`, with a `Text` label child). A click surfaces as a
  `'click'` UI event, which `switchSystem` reads with
  `events.query('click').some(e => e.target === entity)` — the same pattern the
  audio demo uses. The title `Text` is retitled on each switch.
- **Spawning a group** (`src/config.ts` `spawnShowcase`) inserts each effect's
  emitters via `Commands`, tagged `ShowcaseEmitter` so they can be despawned as a
  set. Commands can't set a texture by asset path, so every emitter reuses the
  handle read from an invisible `TexHolder` sprite that references
  `assets/textures/particle.png`.
- **Fireworks** (`src/systems/spark.ts`) spawn a one-shot burst emitter
  (`burstCount` > 0, `looping: false`, a short `duration`); `isPointerOverUI()`
  keeps button clicks from also firing one, and `cleanupSystem` despawns each
  once `Particle.getAliveCount()` hits 0.

Particles draw as additive quads sampling a soft radial dot, so overlaps bloom
into glows.

## Files

```
assets/
  scenes/main.esscene     # camera, backdrop, UI (title + Prev/Next), TexHolder
  textures/particle.png   # soft radial particle sprite
src/
  main.ts                 # registers the systems
  config.ts               # the eleven showcases, the firework, spawnShowcase()
  components.ts           # tags (buttons, TexHolder, ShowcaseEmitter) + Burst
  state.ts                # the current showcase index
  systems/
    setup.ts              # spawn the first showcase, set the title
    switch.ts             # buttons / keys page through the showcases
    spark.ts              # click empty space → firework
    cleanup.ts            # despawn fireworks once they finish
```
