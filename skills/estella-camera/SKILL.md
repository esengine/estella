---
name: estella-camera
description: How to film an Estella game - camera rigs that follow, frame, look at, ride a track or frame a group (Cinemachine's virtual cameras, from the Create menu, no camera code), several cameras with priorities and blends, shakes from a place, and a cutscene on a timeline with camera cuts, keys and events - and prove which camera is live and what it shows. Read it before writing anything that moves, switches or shakes a camera, or before making a cutscene.
---

# Cameras and cutscenes

A camera is an entity with `Camera` and the components that move it, run by the engine in play: a virtual camera,
as Cinemachine's. Do not write a system that moves a camera's `Transform`; pick a rig and give it a target.

## First: what moves the camera now

The top-down and pixel-rpg templates move the camera in `src/systems/follow.ts`, and 3d-starter in
`src/systems/camera.ts`. Each moves EVERY `Camera` in the scene, so it drags a rig and a cutscene's shot cameras with
it. Before adding a rig or a shot camera, delete that file and its `addSystemToSchedule` line in `src/main.ts`, then
`check_scripts`.

## Pick a rig

`apply_scene_ops { ops: [{ op: "create", template: "camera:follow-2d" }] }`, then point it at what it films:
`set_field { entity: <camera>, component: "PositionComposer", field: "target", type: "entity", value: <player> }`.

| Template | For | Its target field(s) |
|---|---|---|
| `camera:follow-2d` | a 2D game: holds the player at a screen point with a dead zone and a soft zone | `PositionComposer.target` |
| `camera:tracking` | third person: behind and above, framing the character, drawn in by walls | `FollowTarget.target`, `LookAtTarget.target` |
| `camera:look-at` | stays put, turns to its target (a security camera, a boss intro) | `LookAtTarget.target` |
| `camera:handheld` | a steady camera with hand-held drift | none; add a `LookAtTarget` to aim it |
| `camera:dolly` | a `Spline` track and a camera on it (`CameraDolly`: Fixed, Track Target or Speed) | `CameraDolly.target`, `LookAtTarget.target` |
| `camera:group-2d` / `camera:group-3d` | several players in one shot, zooming out as they spread | the group's `CameraTargetGroup.members` |
| `camera:state-driven` | which camera is live by an Animator's state (walk, sprint, aim) | its `rules` name the cameras |
| `camera:impulse` | a place a shake is fired from (an explosion) | none |
| `camera:brain` | one per scene: a change of camera blends instead of cutting | none |

A third-person game the player steers with the pointer wants `ThirdPersonCamera` instead (with a
`ThirdPersonController` on the player): it orbits under the pointer and keeps out of walls, and its fields give a fight
its view: `shoulder`, Q lock-on (`lockRange`), a wider view while sprinting (`sprintFov`), a shake when the player is hit
(`hitShake`) and a swing round behind a running player (`recenterDelay`). The 3D gameplay skill has the numbers.

`describe_component` lists a component's fields. Every camera runs, in order: one position stage (`FollowTarget`,
`PositionComposer` or `CameraDolly`), `LookAtTarget`, then `GroupFraming`, `CameraDeoccluder`, `CameraBounds` (an
orthographic camera kept inside the level), then `CameraNoise`. A 3D `FollowTarget` needs `followZ: true`, or the
camera never moves forward or back. Rigs move only in play: in the editor a camera stands where it was put.

## Several cameras

The live camera is the one with `isActive` and the highest `priority`; on a tie, the one switched on last. Switch shots
by raising a camera's `priority` or turning `isActive` on and off, from a script or a state machine, never by moving one
camera between places. With a `CameraBrain` the view blends over `defaultBlend` seconds; `customBlends` set it per
change by camera name (`{ from: "Wide", to: "Close", time: 0 }` cuts in). From code, `setViewTarget(app, camera, { time,
curve })` forces a view with its own blend. A shake: `CameraImpulseSource` on the thing that blows, fired by setting its
`fire` field or `fireImpulse(world, entity, force)`, felt by cameras with `CameraImpulseListener` by their distance (the
follow, tracking and group presets listen); `shakeCamera(app, { amplitude, duration })` shakes whatever is live.

## A cutscene

A cutscene is a timeline on a `TimelinePlayer`, built with the `timeline` tools (`enable_tools { groups: ["timeline"] }`):

1. Put the shot cameras under the entity that will play it, with `isActive` on and a `priority` below the gameplay
   camera's (-10): the timeline makes them live whatever their priority, and outside the cutscene they never win. A
   camera with `isActive` off is no candidate at all, and a shot of it shows nothing. Give each a rig (a
   `LookAtTarget` on the hero) or keep it still.
2. `create_asset { type: "animation" }`, set the player entity's `TimelinePlayer.timeline` to it, then `open_asset` it:
   opened from its player, every target is checked against what is under that entity.
3. `timeline_add_track { type: "camera" }`, then `timeline_add_items` with the shots `{ start, duration?, camera:
   <entity or name path>, curve? }`. Shots that touch cut; a shot running past the next one's start blends over the
   overlap. Where no shot is, the scene's own live camera has the view back.
4. Move things with `timeline_set_keys { target, component, property, keys }`, one number a channel (`position.x`);
   letterbox bars and props with an `activation` track; a fade by keying `ScreenFade.amount` on the player's entity
   (add the component first); sound with an `audio` track; `customEvent` items for the game to react to.
5. `save_asset_document`. Start it by setting `TimelinePlayer.playing` true (a script, or a state machine's
   `timeline.play`); `finished` turns true at the end, which is where gameplay takes over again.

## Prove it

Pause, step to the moment, and ask which camera is live: `play_probe` with
`return sdk.cameraDirectorReport(app)` answers `{ live, blend, timeline }`, `live` the camera's entity in the running
game (`find("Name")` names them). Then `screenshot { crop: "game" }` to see the framing, and `motion_sheet` across a
blend or a cutscene, as one frame shows neither. In the editor, `capture_camera_preview { entity }` shows a camera's
view without playing, from where it was put. In play the Outliner marks the live camera LIVE.
