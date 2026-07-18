# Input Actions

The **modern input stack**: a ship driven by **named actions** (`defineInputMap`)
instead of hard-coded keys, with keyboard **and** gamepad bindings, live
**rebinding** persisted via `Storage`, and a **gesture pad** (swipe / pinch via
`GestureDetector`). For the *raw* `Input` resource (per-key queries, mouse
position, trails) see [`input-demo`](../input-demo) — this example is the layer
you should normally build gameplay on.

- **Move** — WASD, arrow keys, or the gamepad left stick (all three bound to one
  `Move` action; the HUD shows the live axis value).
- **Fire** — Space or gamepad South (A / Cross). Firing flashes the ship and
  spawns bullet squares.
- **Rebind fire** — click the button, then press any key or gamepad button; the
  new binding is saved and survives a restart. **Reset** restores the defaults.
- **Gesture pad** (bottom strip) — swipe steps the ship, pinch scales it. On
  desktop: **drag = swipe**, **Shift-drag = pinch** (see below).

## InputMap in five lines

```ts
export const Actions = defineInputMap({
    Move: Axis2D(Keys2D('KeyW','KeyS','KeyA','KeyD'), Stick('left')),
    Fire: Button(Key('Space'), GpButton(GamepadButton.South)),
});
// anywhere:  Actions.pressed('Fire')   Actions.axis2d('Move')
```

`defineInputMap` registers one `PreUpdate` evaluation system that reads the raw
`Input` resource; gameplay systems just query the returned map by action name.

### Binding syntax

Every binding is **plain serializable data** (that's also the rebind/persistence
format). Constructors:

| Constructor | Data | Feeds |
| --- | --- | --- |
| `Key('Space')` | `{kind:'key', code}` (DOM `KeyboardEvent.code`) | button / axis |
| `MouseButton(0)` | `{kind:'mouse', button}` | button |
| `GpButton(GamepadButton.South, pad?)` | `{kind:'gpButton', button, pad}` — analog value for triggers | button / axis |
| `GpAxis(GamepadAxis.LeftX, pad?, scale?)` | `{kind:'gpAxis', axis, pad, scale}` | axis |
| `Keys1D('KeyQ','KeyE')` | neg/pos keys → signed −1…+1 | axis |
| `Keys2D(up,down,left,right)` | four keys → 2D vector (up = +y) | axis2d |
| `Stick('left'│'right', pad?)` | gamepad stick → 2D vector (Y inverted so up = +y) | axis2d |

Actions wrap bindings with a type: `Button(...)` (value 0–1, has
`pressed`/`released` edges), `Axis1D(...)` (−1…+1), `Axis2D(...)` (normalized
vector via `.axis2d(name)`, magnitude via `.value(name)`). Multiple bindings on
one action **sum** (then clamp/normalize), which is why WASD + arrows + stick
coexist on `Move`. An action reads as `down` at magnitude ≥ 0.5.

### Rebind flow (`src/systems/hud.ts`)

```ts
const binding = await Actions.rebind('Fire', { keyboard: true, gamepad: true });
if (binding) Actions.save(BINDINGS_KEY);           // persists via Storage
```

- `rebind(name, opts)` = `listenForBinding(opts)` + `setBindings(name, [b])`;
  pass `append: true` to add instead of replace.
- `ListenOptions` picks device families: `keyboard` and `gamepad` default **on**,
  `mouse` defaults **off** — so the click that opened the rebind UI is not
  captured. Axis sources are never captured; rebinding targets discrete inputs.
- The listener resolves on the **next pressed input** (any key, including
  Escape). To cancel, call `cancelListen()` — here, clicking the button again
  while `isListening()` does that (the promise resolves `null`).
- Persistence: `Actions.save(key)` / `Actions.load(key)` store `toJSON()`
  (bindings only) in `Storage`. `load` ignores action names the map doesn't
  declare, so stale saves can't resurrect removed actions. For data-driven maps
  there is also `toAsset()` / `loadInputMapAsset()` (full `.inputmap` JSON,
  including action types).

## Gestures (`src/systems/gestures.ts`)

`GestureDetector` wraps an `InputState` and fires callbacks from its **touch**
data. Call `detector.update(dt)` once per frame. Events and fields:

| Event | Fields | Fires when |
| --- | --- | --- |
| `onTap` | `(x, y)` — touch **start** position, screen px | released within 0.3 s and < 10 px of travel |
| `onSwipe` | `(direction, speed)` — `'left'│'right'│'up'│'down'`, px/s | travel ≥ 50 px at ≥ 200 px/s (dominant axis wins) |
| `onPinch` | `(scale, centerX, centerY)` — **per-frame** distance ratio (>1 spread, <1 pinch-in) and midpoint | exactly two active touches; multiply into your own accumulated scale |
| `onLongPress` | `(x, y)` | single touch held ≥ 0.5 s with < 10 px of travel |

Note `direction` is in **screen** coordinates (y grows downward): a swipe toward
the top of the screen reports `'up'`, and this demo maps it to +y in the world.

### What sources does it support?

**Touch only.** The detector reads `Input.touches` / `touchesStarted` /
`touchesEnded`, which the platform layer fills from real touch events (web
`touchstart`…, WeChat `onTouchStart`…). Mouse input does **not** reach it, so
this example bridges the mouse itself: `gestureSystem` owns a private
`InputState` fed from two sources — real touches whose start point is inside the
pad (bottom quarter of the screen), and **synthetic touches from mouse drags**
(left-drag = one finger; Shift-drag = a second finger mirrored across the press
point, driving the detector's genuine two-finger pinch path). The detector never
knows the difference — which is also a demonstration that it works on any
`InputState`-shaped touch source you construct.

Two practical details the bridge shows: gating by pad area must happen at the
*source* (swipe callbacks carry no position), and releasing a pinch often also
classifies as a swipe, so the pinch flag suppresses swipes for the rest of that
gesture.

## Files

- `src/actions.ts` — the `InputMap` (Move/Fire), defaults, `Storage` key, and
  binding pretty-printers for the HUD.
- `src/systems/ship.ts` — gameplay reads *only* named actions (`axis2d('Move')`,
  `pressed('Fire')`) + applies gesture steps/scale; bullets fade and despawn.
- `src/systems/gestures.ts` — the `GestureDetector`, pad gating, and the
  mouse→touch bridge.
- `src/systems/hud.ts` — binding labels, the Rebind/Reset buttons
  (`createButton`), rebind status.
- `assets/scenes/main.esscene` — camera, ship, HUD panel, gesture pad (UI built
  from scene-authored flex containers; buttons are added at runtime).
