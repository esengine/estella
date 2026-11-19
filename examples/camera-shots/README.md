# Camera Shots

A **shot list with no camera code**. A runner laps a track, and three virtual cameras film it, each built only from
engine components in the scene. A Camera Brain blends between them whenever a different one goes live.

| Key | Shot | What it is made of |
|---|---|---|
| 1 | Tracking | `CameraDolly` (Track Target) on the *Tracking Rail* keeps level with the runner, `LookAtTarget` holds it on screen, `CameraNoise` adds a handheld drift. |
| 2 | Crane | `CameraDolly` (Speed) rides the *Crane Orbit* round and round, `LookAtTarget` keeps the runner in the middle. |
| 3 | Wide | A fixed camera with a long lens. `LookAtTarget` has a wide dead zone, so it only pans once the runner nears the frame's edge, and `CameraNoise` keeps it breathing. |

The runner itself is a `PathFollower` on the *Route* spline. The one piece of game code, `src/shots.ts`, picks a
shot (a number key, or the next one every seven seconds) and raises that camera's `priority` above the others. The
*Camera Brain* entity does the rest: the live camera is the active one with the highest priority, and the view eases
to it over 1.6 seconds.

## Controls

| Input | Action |
|---|---|
| 1 / 2 / 3 | Cut to the tracking, crane or wide shot. |
| — | With no key pressed, the next shot comes every seven seconds. |

## What to look at

- The three cameras in `assets/scenes/main.esscene`: change a dolly's `mode`, an aim's `screenX` and dead zone, or a
  noise's `rotation`, and play again.
- The *Camera Brain*: set `defaultBlend` to `0` and the shots cut instead of blending.
- `src/shots.ts`: directing is a priority. Nothing in it moves or turns a camera.

See [Cameras](https://estellaengine.com/docs/graphics/camera/) for the camera pipeline these components make up.
