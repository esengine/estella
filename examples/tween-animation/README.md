# Tween Animation

A tour of the engine's built-in **tween** system — the `Tween` resource and its
`to()` / `sequence()` / `parallel()` / `.bezier()` API, plus the 16 easing
curves. Three things run at once:

- **Easing gallery** (left) — twelve dots race the same track, each with a
  different easing, looping back and forth. Because they start together and ease
  differently, they visibly spread apart and regroup — the quickest way to *see*
  what each curve does.
- **Hero** (upper right) — a square running an endless `sequence()`: move → spin
  + colour → move → spin + colour. Each spin/colour pair is grouped with
  `parallel()` so they play together.
- **Comet** (lower right) — click anywhere and it tweens to the cursor with an
  overshooting ease and an elastic size pop. Click again mid-flight to retarget.

## Controls

| Input       | Action                                             |
| ----------- | -------------------------------------------------- |
| Left-click  | Fling the comet to the cursor (retargets in-flight) |

Everything else runs on its own.

## The easing gallery, top to bottom

`Linear`, `EaseInQuad`, `EaseOutQuad`, `EaseInOutQuad`, `EaseInCubic`,
`EaseOutCubic`, `EaseInOutCubic`, `EaseOutBack`, `EaseInOutBack`,
`EaseOutElastic`, `EaseOutBounce`, `CubicBezier` (a custom curve set with
`TweenHandle.bezier()`).

## How it works

Tweens are driven by the built-in `TweenSystem` (registered by the
`AnimationPlugin`); a system only has to *start* them via the `Tween` resource,
and the C++ fast-path writes `Transform` / `Sprite` every frame — there is no
per-frame lerp code in this example.

- **Starting a tween** — `tween.to(entity, TweenTarget.PositionX, from, to,
  seconds, { easing, loop })`. `TweenTarget` covers position, scale, rotation,
  colour, size and camera ortho-size.
- **Looping** — `LoopMode.PingPong` (reverse each lap) or `LoopMode.Restart`.
- **Composition** — `tween.sequence([() => ..., () => ...])` runs factories one
  after another (each starts when the previous finishes); `tween.parallel([...])`
  runs tweens together. Both report completion via `.onComplete()`; the hero
  re-arms itself there to loop forever. See `src/systems/setup.ts`.
- **Custom curves** — `tween.to(...).bezier(p1x, p1y, p2x, p2y)` for a cubic
  bezier easing.
- **Retargeting** — `tween.cancelAll(entity)` stops an entity's tweens so a new
  one can start from its live position. See `src/systems/comet.ts`.

## Files

```
assets/scenes/
  main.esscene        # camera, 12 rail+dot rows, the hero, the comet
src/
  main.ts             # registers the setup + comet systems
  config.ts           # easing list, track, hero/comet tuning
  components.ts        # GalleryDot (easing index), Hero + Comet tags
  systems/
    setup.ts          # starts the gallery race + the looping hero sequence
    comet.ts          # click → tween the comet to the cursor
```
