---
name: estella-3d-gameplay
description: How to make a playable 3D game in Estella - a character that walks and jumps over ground and props, physics and triggers, a camera that follows, a lit world that looks finished, terrain, plants and models - and prove each part works by playing it and looking at it from every side. Read it before building 3D gameplay or a 3D scene.
---

# 3D gameplay

Start from the `3d-starter` template (`list_project_templates`): a lit world with ground, props, a Sun and a sky light,
a capsule `Hero` you walk with WASD and Space, and a camera that follows it. Change what the task asks for rather than
rebuilding what is there. A world unit is a centimetre (100 to the metre) unless the project says otherwise: a person
is about 160 tall, a walk about 340 a second.

## A character that walks and jumps

`CharacterController3D` is a kinematic mover swept against the world. Each fixed step a system writes `velocity.x` and
`velocity.z` (normalise the diagonal) and reads `isOnFloor`; it leaves `velocity.y` alone, because the controller carries
gravity there, and sets it only to jump. `radius` and `halfHeight` are its capsule, `stepHeight` what it climbs,
`maxSlope` (radians) the steepest ground it stands on. The template's `src/systems/walk.ts` is the pattern: it runs in
`Schedule.FixedPreUpdate`, where the controller reads it. Movement that turns the body to face where it walks writes
the `Transform` rotation in the same system.

## An action game that feels right

A third-person fighter needs no movement code: `ThirdPersonController` beside the `CharacterController3D`, a
`ThirdPersonCamera`, and an `Animator` whose graph answers the triggers `dodge`, `attack` and `stagger` (from
`esengine/gameplay`). What makes it feel right are numbers on components, not systems:

- Jump forgiveness is on by default: `coyoteTime` 0.12 s after walking off an edge, `jumpBuffer` 0.14 s before landing.
- `sprintSpeed` (about 1.5x `moveSpeed`) turns Left Shift into hold to sprint, tap to dodge; the animator hears the bool
  `sprint`.
- A `Stamina` on the player makes sprint, dodge, attack and jump cost (`sprintCost` a second, `dodgeCost`, `attackCost`,
  `jumpCost`); an empty bar refuses them. Show it with a UIMeter.
- The dodge clip declares its invulnerable frames as an `invulnerable` window (a custom event with a duration, like
  `attack-active`): from a tenth of the way in to about two thirds through the roll.
- `MeleeAttack.hitStop` 0.04 to 0.08 holds the game still when a swing lands; that stop is most of what makes a blow
  heavy. Leave it 0 in a networked game.
- On enemies, `Health.poise` (about a third of their health) staggers them after enough blows; a staggered Hunter loses
  its swing. `Health.graceTime` gives a hit player a moment untouchable.

Prove it by playing: hold Shift and read the speed, tap it and read the trigger, land a swing and read `Time.scale`.

## Physics and triggers

- A solid thing is a `RigidBody3D` and a collider together (`BoxCollider3D`, `SphereCollider3D`, `CapsuleCollider3D`,
  `MeshCollider3D` for static level geometry). `bodyType` is 0 static (ground, walls), 1 kinematic (moved by code),
  2 dynamic (falls and is pushed). A body with no collider falls through the world. `configure_physics_body` is 2D only:
  add the 3D components with `add_component` or `apply_scene_ops`.
- A trigger (a pickup, a door zone) is a collider with `isSensor: true`. A script reads `Res(Physics3DEvents)`:
  `sensorEnters` lists `{ sensorEntity, visitorEntity }`, `contactEnters` the solid hits.
- Collider sizes are half extents and radii in world units, measured from the entity's centre: a 100-unit cube has
  `halfExtents` 50, 50, 50.

## Camera

The template's `src/systems/camera.ts` eases every camera toward the character plus an offset. For more than that, use a
rig and delete that file and its line in `src/main.ts`, or it drags the rig too: `camera:tracking` (from
`apply_scene_ops` `create`) stands behind and above the character, frames it and is drawn in by walls; set its
`FollowTarget.target` and `LookAtTarget.target` to the character. A `FollowTarget` alone needs `followZ` on, or the
camera never moves forward or back with the character. Several cameras, shakes and cutscenes are in `estella-camera`.

## A world that looks finished

A 3D scene that looks flat, grey or washed out is missing settings, not renderer features. `audit_look` lists what the
scene lacks (shadows are off until a light has `meshShadows`; no sky light, fog, exposure or grade); `apply_look` adds
them in one undo step. Then `screenshot { crop: "game" }` and change one thing at a time: sun direction, sky, fog,
exposure, grade. Light intensity multiplies albedo directly: a three.js number divided by pi is the one to use here.

- Land: `terrain_write`, look at it with `terrain_views`, then `terrain_apply`.
- Plants: `audit_vegetation` before adding them; short grass casts no shadow.
- Props and characters: `model_write`. Read its topics with `tool_guide` first (a person: people, organic, colour, hair,
  drape), and judge a model from every side, not the front alone.
- Fire, smoke, sparks and explosions are particle effects, not solid meshes: make them with `vfx_write` (read its `craft` and `recipes` topics first), which writes a prefab and shows the effect at chosen moments without Play.

## Prove it by playing, then look

Write the acceptance before building, one expectation per mechanic the task names:

```json
{ "frames": 180,
  "inputs": [
    { "frame": 10, "kind": "key_down", "code": "KeyW" },
    { "frame": 60, "kind": "key_down", "code": "Space" },
    { "frame": 70, "kind": "key_up", "code": "Space" },
    { "frame": 150, "kind": "key_up", "code": "KeyW" }],
  "expect": [
    { "entity": "Hero", "component": "Transform", "field": "position.z", "op": "changed", "says": "the character walks forward" },
    { "entity": "Hero", "component": "Transform", "field": "position.y", "op": ">", "value": -1000, "says": "it did not fall through the ground" },
    { "entity": "Coin", "op": "absent", "says": "the pickup was collected" }] }
```

`verify { acceptance }` plays it deterministically and fails what does not hold. Pick inputs that really reach the
thing (walk into the pickup you test) and check a value the game changes, not one you set. A 3D scene is not judged
from one picture: `screenshot { crop: "game" }` for what the player sees, then `scene_views` on what you built (front,
side, top) or `view_from` a place, because a prop floating above the ground or sunk into it looks right from the front.
For cost, `step` a few hundred frames to warm it, then `get_stats` (`gpuDraws` against `drawCalls`).
