# Timers

Every gameplay codebase grows little `phase += time.delta; if (phase >= 0.8) {
phase -= 0.8; …}` accumulator systems. `TimerManager` (the `Timer` resource)
replaces that boilerplate with scheduled callbacks: **`delay()`** for one-shots,
**`interval()`** for repeats, and a **`TimerHandle`** to pause / resume / cancel
/ reset each one. This playground drives everything visual through timers:

- **Heartbeat** — an `interval(0.8, …)` kicks the red square's scale and bumps
  the counter; a per-frame system only decays the scale back. No accumulator.
- **Firework in 1s** — a `delay(1, …)` fuse bursts colored sparks, and a second
  `delay(1.4, …)` despawns the batch (delay-as-lifetime).
- **Countdown ×3** — `interval(1, cb, 3)` fires exactly three times, then
  removes itself (`isActive` flips to false with no `cancel()` call).
- **Spawner row** — an `interval(0.7, …)` drops drifting squares; Pause /
  Resume / Cancel / Restart exercise the full `TimerHandle` surface. Each
  drifter's death is a `delay(7, …)`.
- **Scale row** — sets `TimerManager.timeScale`. All timers slow down or speed
  up; the drifters keep falling at the same speed because motion runs on
  `Time.delta`, which the timer scale does not touch. Watch spawn density
  change while fall speed doesn't.

## API

The plugin is part of the default web/headless app plugin sets — nothing to
register. Get the manager in a system with `Res(TimerRes)`.

### `TimerManager`

| Member | Default | Semantics |
| ------ | ------- | --------- |
| `delay(seconds, cb)` | — | One-shot. Fires once when `elapsed >= seconds`, then the timer removes itself. Returns a `TimerHandle`. |
| `interval(seconds, cb, maxRepeat?)` | `maxRepeat = 0` | Repeating. First fire after `seconds`, then every `seconds`. `maxRepeat = 0` means forever; `maxRepeat = n` fires exactly `n` times, then the timer removes itself. |
| `timeScale` | `1` | Multiplies the dt fed to **all** timers (clamped to `>= 0`; `0` freezes them). Independent of `Time` — per-frame systems are unaffected. |
| `cancelAll()` | — | Removes every timer. |
| `activeCount` | — | Number of live timers (shown in the HUD's scale line). |
| `pause/resume/cancel/reset(id)` | — | Id-based forms of the handle methods below. |

### `TimerHandle` (returned by `delay` / `interval`)

| Member | Semantics |
| ------ | --------- |
| `pause()` / `resume()` | Freeze / unfreeze this timer's `elapsed` clock. Chainable. |
| `cancel()` | Remove the timer. A cancelled handle is dead — `resume()` on it is a no-op; schedule a new timer (the Restart button shows both paths). |
| `reset()` | Rewind `elapsed` and `repeatCount` to 0 on a live timer (a spent `maxRepeat` timer is already gone — reset can't revive it). |
| `isActive` | False once the timer fired its last shot or was cancelled. |
| `elapsed` | Seconds (scaled) into the current cycle. |
| `repeatCount` | Completed fires. **Inside the callback it is the count of *previous* fires** — it increments after the callback returns (the countdown uses this: first fire sees `0`). |
| `id` | Stable numeric id, usable with the manager's id-based methods. |

The callback receives the handle (`(t) => …`), so an infinite interval can
`t.cancel()` itself when a condition is met.

### The clock — what timers tick on

- The `TimerSystem` runs in **`Schedule.PreUpdate`** and advances every timer
  by `Time.delta * timeScale`. Callbacks therefore run **before** your Update
  systems in the same frame, on the main thread, in scheduling order.
- Firing is **frame-quantized**: a timer fires on the first tick at/past its
  deadline, so actual latency is up to one frame late. Don't use timers for
  sub-frame precision (audio scheduling, physics) — they're gameplay-grade.
- A timer fires **at most once per frame**. A long hitch doesn't burst-fire a
  short interval; the overshoot remainder is carried into the next cycle, so
  intervals don't drift over time.
- The system is gated `playModeOnly` — timers are **frozen in the editor's
  edit mode** and advance in play mode, like game time.

## Lifetime rules

Timers live on the `TimerManager` **app resource** — they are not attached to
entities or scenes:

- **Despawning an entity does not cancel timers** whose callbacks captured it.
  Either cancel the handle when the entity dies, or guard in the callback:
  `if (world.valid(entity)) world.despawn(entity)` (see `spawnDrifter`).
- **Loading another scene does not clear timers.** A pending callback will run
  against the new world; `findEntityByName` / `world.valid` guards keep that
  safe, or call `cancelAll()` / cancel your handles on teardown.
- A fresh play session builds a fresh app, so a fresh (empty) `TimerManager`.

## Timers vs `Time.delta` accumulation vs tween delays

| Use | When |
| --- | ---- |
| **`TimerManager`** | *Scheduling* — "in 2s", "every 0.7s", "3 times then stop", anything you'd otherwise write an accumulator for, especially when it must be pausable/cancellable from elsewhere (ability cooldowns, spawn waves, timed despawns, countdowns). |
| **`Time.delta` accumulation in a system** | *Continuous per-frame math* — integration, easing, decay, anything evaluated every frame anyway (`motion.ts` here). Also per-entity clocks you want serialized with the entity: component fields save/replicate; timers don't. |
| **Tween `delay` option** | A wait that exists only to sequence an *animation* (`tween(target, { delay: 0.3, … })`). The delay lives and dies with the tween — cancel the tween, the wait goes too. Don't schedule gameplay logic with it. |

Rule of thumb: timers decide **when**, systems compute **every frame**, tweens
animate **values**.

## Files

```
assets/
  scenes/main.esscene    # camera, heart square, HUD panel (labels + empty button rows)
src/
  main.ts                # registers the systems
  components.ts          # Heart, Spark, Drifter
  state.ts               # module state + the TimerHandles the buttons control
  systems/
    build.ts             # schedules all timers, builds the buttons
    motion.ts            # per-frame integration (sparks, drifters, heart decay)
    hud.ts               # labels track state + live handle fields (elapsed, repeatCount)
```
