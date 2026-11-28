---
name: estella-2d-gameplay
description: How to make a playable 2D game in Estella - a player that moves and jumps, things to collide with and pick up, a camera that follows, a score - and prove each part works by playing it. Read it before building 2D gameplay.
---

# 2D gameplay

Start from a template when the task allows: `list_project_templates` has a 2D platformer and a top-down game whose scenes
already have a player, ground, a camera and a HUD. Change what the task asks for rather than rebuilding what is there.

## A player that runs and jumps

The built-in `PlatformerController2D` (with a `CharacterController2D` and a collider) runs, jumps, coyote-times and
buffers jumps. With `readKeyboard` on it reads A / D or the arrows to move and Space, W or Up to jump; off, a script or
an AI writes `moveInput` (-1..1), `jumpPressed` and `jumpHeld`. Tune `moveSpeed`, `jumpSpeed`, `gravity` (world units a
second, 100 to the metre) rather than writing movement code.

A dash is `dashSpeed` (about 3.5x `moveSpeed`), `dashTime` and `dashCooldown`: Shift or K bursts along the way it last
faced with no gravity, once in the air until it lands, and the `Health` on it takes no blow meanwhile. With a `Stamina` on
the player each dash takes `dashCost` and an empty bar refuses it. `Health.graceTime` (about 1 s) is the blink a hit
player gets; `MeleeAttack.hitStop` and `Health.poise` work the same as in 3D.

A top-down mover, or anything with rules of its own, is a script: a component for its state and a system that reads
`Res(Input)` (`isKeyDown('KeyA')`, `isKeyPressed('Space')`) and writes the Transform through `Mut(Transform)`.

## Collision and pickups

- `configure_physics_body { entity, body: "dynamic" | "kinematic" | "static", shape: "box" | "circle", size }` adds the
  body and the collider together: a body with no collider falls through the world.
- Ground and walls are static. A pickup is a `sensor: true` collider: it reports contacts and blocks nothing.
- A script reacts to contacts through `Res(Physics2DEvents)`: `sensorEnters` lists `{ sensorEntity, ... }` each frame.

## Camera

Use a rig, not a script: `apply_scene_ops { ops: [{ op: "create", template: "camera:follow-2d" }] }` and its
`PositionComposer.target` set to the player holds the player at a screen point with a dead zone it may wander in, and a
`CameraBounds` on it keeps the view inside the level. The top-down and pixel-rpg templates follow in
`src/systems/follow.ts`, which moves every camera: delete it (and its line in `src/main.ts`) when adding a rig. Several
cameras, shakes and cutscenes are in `estella-camera`.

## Scripts

A component and a system, registered in `src/main.ts`:

```ts
// src/components.ts
export const Coin = defineComponent('Coin', { value: 1 });
// src/systems/pickup.ts
export const pickupSystem = defineSystem(
    [Res(Physics2DEvents), Query(Coin), Query(Mut(Score)), Commands()],
    (events, coins, scores, cmds) => { /* despawn the coin, add to the score */ },
    { name: 'PickupSystem' });
// src/main.ts
addSystemToSchedule(Schedule.Update, pickupSystem);
```

`create_behavior` does the file, the registration and the attaching in one call. `check_scripts` after every script.
Something placed many times (coins, enemies) is a prefab: build one, `create_prefab_from_entity`, then create instances.

## Prove it by playing

Write the acceptance before building, one expectation per mechanic the task names:

```json
{ "frames": 180,
  "inputs": [
    { "frame": 10, "kind": "key_down", "code": "KeyD" },
    { "frame": 60, "kind": "key_down", "code": "Space" },
    { "frame": 70, "kind": "key_up", "code": "Space" },
    { "frame": 150, "kind": "key_up", "code": "KeyD" }],
  "expect": [
    { "entity": "Player", "component": "Transform", "field": "position.x", "op": "changed", "says": "the player moves right" },
    { "entity": "Player", "component": "Transform", "field": "position.y", "op": ">", "value": -1000, "says": "the player did not fall out of the level" },
    { "entity": "Coin", "op": "absent", "says": "the coin was picked up" }] }
```

`verify { acceptance }` plays it deterministically and fails what does not hold. Pick inputs that really reach the thing
(walk the player into the coin you test) and check a value the game changes, not one you set. Then
`screenshot { crop: "game" }` once: a game that passes every expectation and draws its player off screen is still wrong.
