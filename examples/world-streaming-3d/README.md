# World Streaming 3D

A world cut into cells at cook time. Places exist because a source is near them,
and stop existing — really stop, not stop being drawn — when none is.

- **WASD / arrows** — walk. Walking is what makes places arrive and leave.
- **K** — switch the player's streaming source off and on. With nobody asking,
  every cell leaves.
- **L** — switch on a second source parked in the far cell. Two sources are
  unioned, so it brings its own place in without taking the first away.
- **M** — set a third source oscillating across a cell boundary. It crosses the
  load threshold repeatedly and never the unload one, so the place comes in once.
- **J** — aim a blow at the enemy this project *remembered* before its cell
  unloaded, and at a canary that never leaves.

| In the scene | What it is there for |
|---|---|
| `StreamedWorld` on `World` | Declares the scene streamed and the cells 600 units across. |
| `WorldPersistent` | The player, the camera, the sun, the ground, the sources. Never streamed. |
| `WorldStreamingSource` on `Player` | Asks for the places near it: in at 250, out past 450. |
| `Arch` with a child at +400 | A subtree whose child stands in another cell — it still arrives and leaves whole. |
| `Wall` in the middle cell | Something a player can walk into, so "the cell unloaded" can be told from "the cell stopped drawing". |
| `Enemy` in the middle cell | Hunts, navigates and collides — all of which must be gone when its cell is. |

This is a **fixture**. Its cell size, radii and coordinates answer to
`tools/verify-world-residency.mjs` and to nothing else, which is also why the
ground is persistent (so a walk can be repeated with a cell absent rather than
ending in a fall) and why every cell entity carries `Health` (so a blow that
landed on a recycled handle is visible whichever entity inherited it).
