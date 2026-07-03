# Post-Processing

A gallery of the engine's `PostProcessVolume` effects. Page through the ten
built-in effects with on-screen buttons; the last page shows a **local volume**
sweeping across the camera.

## Controls

| Input                   | Action                              |
| ----------------------- | ----------------------------------- |
| **Prev / Next** buttons | Page to the previous / next effect  |
| `←` / `→` / `Space`     | Same, from the keyboard             |

## The effects

`Bloom` · `Blur` · `Pixelate` · `Chromatic Aberration` · `Lens Distortion` ·
`Vignette` · `Grayscale` · `Color Grade` · `Tonemap (ACES)` · `FXAA` — each is a
full-screen pass with its own uniforms (see `src/config.ts`). The final
`Local Volume` page is a spatial demo rather than a single effect.

## How it works

Post-processing here is **data-driven**: the scene owns one global
`PostProcessVolume` (tagged `SceneVolume`) and the engine's `postProcessVolumeSystem`
reads it every frame and rebuilds the camera's pass stack. Nothing calls the
pipeline imperatively.

- **Switching** (`src/systems/switch.ts`) just rewrites the volume's `effects`
  array via `Mut(PostProcessVolume)`; the volume system applies it next frame.
  A click surfaces as a `'click'` UI event that the system reads with
  `events.query('click').some(e => e.target === entity)`. The title and hint
  `Text` are updated on each switch.
- **The buttons** are plain UI entities in the scene (`UINode` + `UIVisual` +
  `Interactable`, with a `Text` label child).
- **The local volume** (`src/config.ts` `spawnLocalVolume`) is a non-global
  sphere volume with a warm grade + bloom, carrying a `Sweep` component that
  ping-pongs it along x. The camera is fixed, so as the volume drifts past,
  `computeVolumeFactor` fades its effect in near the centre and out at the edges
  — the camera-relative blend that `blendVolumeEffects` resolves each frame.
  It's tagged `ShowcaseOwned` and despawned when you page away.

The backdrop — a bright core ringed by orbiting colored sprites — gives the
effects something with highlights and edges to act on.

## Files

```
assets/
  scenes/main.esscene     # camera, backdrop, SceneVolume, UI (title/hint + Prev/Next)
src/
  main.ts                 # registers the systems
  config.ts               # the ten effects + spawnLocalVolume()
  components.ts            # tags (buttons, SceneVolume, ShowcaseOwned) + Orbit + Sweep
  state.ts                # the current effect index
  systems/
    setup.ts              # apply the first effect, set the labels
    switch.ts             # buttons / keys page through the effects
    animate.ts            # orbit the backdrop sprites
    sweep.ts              # ping-pong the local volume across the camera
```
