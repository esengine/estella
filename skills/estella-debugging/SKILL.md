---
name: estella-debugging
description: How to find why an Estella game or scene is not doing what it should - a failed verify, an error, something not drawn, input that does nothing, a value that never changes. Read it when verify fails or the game looks wrong.
---

# Finding why it fails

Start from `verify` (see `estella-workflow`): it names the failed check and its findings. Fix the first finding of the
first failed check before anything else; later ones often follow from it. Then look in this order.

## The game did not start (`play` failed)

`get_logs { tail: 50 }` has the first error. A script that throws when the game starts, a component registered twice, an
asset that will not load. Fix it, then `verify` again: nothing inside the game was checked while it could not start.

## An error while it ran (`errors` failed)

The finding's `detail` has the stack. `read_project_file` the file and line it names. A script reading a component the
entity does not have is the usual one: `world.get` throws for a missing component, `world.tryGet` answers null.

## The scene is incomplete (`scene` failed)

`get_diagnostics` lists each problem by entity, component and field: a required field left empty (an AudioSource with no
clip), a reference to an asset that does not exist, an asset that loaded with part of it missing. `list_assets` shows what
does exist.

## Nothing is drawn (`look` failed, or the screenshot is empty)

1. Is there a camera? `find_entities { component: "Camera" }` in the running game; it must be active.
2. Does it see the content? `inspect_entity` the camera and the thing that should show: an orthographic camera shows
   `orthoSize` world units above and below its position, so a sprite at y 2000 under an orthoSize of 540 is off screen.
3. Is the content drawable? A `Sprite` needs a size, a `MeshRenderer` a mesh and a material; the entity and its parents
   must be active. A Sprite with no texture draws a tinted quad, not nothing.
4. UI: a screen `Canvas` draws on top of every camera; a node with no size or `display: none` draws nothing.
5. `capture_frame` lists every draw of the frame with the entities it came from: what is not in it was not submitted.

## Input does nothing

`play_input` sends canvas-relative screen pixels, y down, and key codes as `KeyboardEvent.code` (`Space`, `KeyA`,
`ArrowLeft`). After a press, `step { frames: 1 }` or more: the press lasts one frame. A UI control under the pointer takes
the event first. `inspect_entity` the controlled entity before and after: if its input component changed and its position
did not, the problem is movement (physics, a script), not input.

## A value never changes

- A script that does not run: is its system registered in `src/main.ts` with `addSystemToSchedule`? `get_systems` lists
  what runs.
- A write the engine does not see: the script changed the object `world.get` returned instead of going through
  `Mut(...)`, `world.set` or `world.insert`.
- A game that is not moving: you read twice without `step` in between (see `estella-workflow`).

## Physics that does not move or collide

A body needs a `RigidBody2D` (or `RigidBody3D`) and a collider of matching dimension; `configure_physics_body` sets both
consistently. A static body never moves, a kinematic one moves only when set. Sizes are in world units (100 to the metre).

## Still stuck

Change one thing, `verify`, and read what changed in the result. Two changes at once hide which one mattered.
