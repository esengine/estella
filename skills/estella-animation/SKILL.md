---
name: estella-animation
description: How to make things move in Estella - pick the right tool (tween, sprite clip, timeline, animator state machine, 2D rig, Spine, a skinned 3D model's clips, spring bones for hair), drive it from gameplay, and prove the motion is right by looking at it over time rather than at one frame. Read it before animating a character, a UI or a cutscene.
---

# Animation

One picture cannot show motion. Whatever you build here is checked with `motion_sheet` (below), not with a screenshot.

## Pick the tool

| What moves | Use |
|---|---|
| A one-off change: a button pop, a fade, a slide | a tween: `Res(Tween)`, `tween.to(entity, TweenTarget.PositionX, from, to, seconds, { easing })` |
| Looping frame art (a walk cycle on a sprite sheet) | `SpriteAnimator` playing an `animclip` asset |
| Keyed fields over time: a door, a cutscene, a UI flourish | a timeline (`.estimeline`) on a `TimelinePlayer` |
| A camera that follows, frames or cuts between shots | a camera rig, not keys (`estella-camera`) |
| A character whose clip depends on gameplay (idle, run, jump) | an `Animator` state machine over any of the above |
| A 2D character that bends | a 2D rig (`.esrig`): bones are entities, keyed in a timeline |
| A Spine or DragonBones export | `SpineAnimation` / `DragonBonesAnimation` |
| A skinned 3D model | the clips its import made, played by `TimelinePlayer` or `Animator` |
| Hair, tails, cloth that should lag and swing | `SpringBone` on the top bone of each strand |

A UI button's look per state is not animation code either: that is a controller and gears (`estella-screen-ui`).

## Clips and timelines

- `create_asset { type: "animclip" }` makes a sprite clip and `type: "animation"` a timeline; `open_asset` opens its
  editor, and `get_asset_document` reads it. Read the document, not the file: the file is stale while the editor has
  edits. Open a timeline from the entity whose `TimelinePlayer` plays it, so the targets you name are checked.
- A timeline is built with the `timeline` tools: `timeline_add_track` (any track type, on an entity by id or name path),
  `timeline_add_items` (clips, sounds, spawns, markers, events, camera shots), `timeline_set_keys` (keys of an animatable
  field, making its property track). `edit_asset_document` only changes a value that is already there
  (`frames.0.duration`, `tracks.0.channels.0.keyframes.1.value`); `save_asset_document` writes the file. A cutscene's
  cameras are in `estella-camera`.
- `SpriteAnimator`: set `clip`, `speed`, `playing`, `loop`; `finished` latches when a one-shot ends.
- `TimelinePlayer`: `timeline`, `playing`, `speed`, `wrapMode` (`once`, `loop`, `pingPong`). The flags are the control:
  raise `playing` to play, and raising it on a finished clip replays it. `Res(Timeline)` seeks (`setTime`). A timeline
  holds property tracks (any numeric field by dotted path), sprite, audio, activation (show and hide), Spine, camera
  and custom-event tracks; a track names its target by its path of names under the player's entity.
- An imported model carries one `.estimeline` per animation in the file, named `<model>_<animation>`, and its prefab
  root has a `TimelinePlayer` on the first one with `playing` off: nothing moves until the scene or a script says so.

## A character: the Animator

An animator controller holds states, transitions with conditions, and blends, driven by named parameters. Gameplay
never names a clip; it sets parameters, each frame, and the controller picks:

```ts
const drive = defineSystem([Query(Animator, CharacterController3D), Res(AnimatorController)], (q, anim) => {
    for (const [entity, , body] of q) {
        anim.setFloat(entity, 'speed', Math.hypot(body.realVelocity.x, body.realVelocity.z));
        anim.setBool(entity, 'grounded', body.isOnFloor);
    }
});
```

`setTrigger(entity, 'jump')` fires once. A state's motion is a sprite clip, a Spine animation or a timeline clip (how a
skinned 3D rig is animated); a transition's `duration` crossfades where both sides can be sampled. Drive `speed` from
the velocity the body really has, not from the keys held, or the legs run against a wall. Set the `Animator`'s
`controller` to the `.esanimator` asset, or to a name registered from code with `Res(AnimatorController)`'s `registerController(name, def)`.

## Rigs and secondary motion

- 2D rig: the `.esrig` is authored in its editor (parts, bones, mesh, weights); saving writes the `.esmesh` and
  `.esprefab` scenes use. Its bones are ordinary entities named by path (`hips/spine/arm`), so a timeline keys them and
  an `IK2D` on the last bone of a limb reaches for a `target` after the clip has played.
- Spine: `SpineAnimation` with `skeletonPath`, `atlasPath`, `animation`, `skin`, `loop`. Many Spine characters cost
  real CPU: measure before adding a crowd (`estella-performance`).
- `SpringBone` goes on the TOP bone of a strand and simulates everything below it: `stiffness` pulls back to the
  animated pose, `drag` settles it, `gravity` is in world units (980 at 100 units a metre). Add `SpringBoneCollider`
  spheres on the head and shoulders and list them in `colliders`, or hair passes through the body. A model whose bones
  are named `Hair_<region>_<chain>_00` gets its chains from the Spring Bones import setting.

## Prove the motion

`set_play { state: "paused" }`, bring the game to the moment (inputs with `play_input`, frames with `step`), then
`motion_sheet { count, every }`: that many moments on one sheet, `every` game frames apart. `region` shows a part (the
hair, the feet). Read it for what a screenshot hides:

- Does it move at all? A clip whose paths do not match the entity's children plays and moves nothing.
- Feet that slide: the walk speed and the clip's stride disagree; scale the clip's `speed` with the velocity.
- A pop between two clips: the transition has no `duration`, or the clips do not share a pose where they meet.
- A loop that jumps at the seam, hair that never settles (`drag` too low) or hangs stiff (`stiffness` too high).

In a `verify` acceptance, expect a value the animation changes (`Animator.currentState`, a bone's
`Transform.rotation`, `SpriteAnimator.currentFrame`), with inputs that cause it. To watch something too fast to see,
`set_time_scale`; to check it, pause and `step`, because exact frames repeat and waiting does not.
