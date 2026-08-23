# Enemy AI 3D

Hunters that sense the player in three dimensions and walk a navigation mesh baked
out of the scene's own collision geometry.

- **WASD / arrows** — walk.
- **G** — shut the doorway and open it again.

What the scene authors, and what each part is there to show:

| In the scene | What it demonstrates |
|---|---|
| `NavVolume` | The box the mesh is baked over. Nothing in code bakes anything. |
| `NavLink` | A way onto the terrace that the ground does not provide. |
| `NavObstacle` | A gate across the doorway: shut it and the navigable world is rebuilt while the game runs. |
| `Perceiver` on each hunter | Sight in three dimensions, blocked by the walls between them. |
| `NavAgent` with a `radius` | Hunters that give way to each other instead of arriving as one body. |
| `CharacterController3D` | Agents that are steered rather than moved, so they collide and fall. |

The project ships no art. Both debug overlays are turned on at startup, so what
the solver built and what the bake found are the whole picture.
