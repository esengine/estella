---
section: Changed
commits:
  - feat(weather): 3D rain falls as streaks in the world, drawn on the GPU, and stops on what stands over it
---
**3D rain falls in the world.** The rain effect's falling streaks were three layers painted down the screen, so they ran straight down
the picture whichever way the camera looked: seen from above, rain was vertical lines across the ground. The drops are now streaks
in the world round the camera, falling at a raindrop's speed (scaled by the effect's Speed) and leaning with its Wind toward where
the sky's clouds go, stretched along their fall and turned to the eye: seen level they run down, seen from above they run out from
under the camera, and they stay where they are as the camera moves through them. They end on what stands over them, from the same
overhead map that keeps the ground under a roof dry, so no rain falls under an awning, and anything nearer the camera hides them.
They are drawn on the GPU from their number and the time, with nothing stepped on the CPU, the same in WebGL2 and WebGPU. The wet
ground, puddles and splashes are drawn as before; 2D rain and snow are unchanged.
