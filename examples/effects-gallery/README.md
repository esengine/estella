# Effects Gallery

The built-in material effect templates in one scene:

| Entity | Template | Driven by |
| --- | --- | --- |
| Plain | — (default batch shader) | reference |
| HitFlash | Hit Flash | `FlashPulseSystem` pulses `u_flash` |
| Outline | Outline | static params |
| Dissolve | Dissolve | `DissolveLoopSystem` ping-pongs `u_progress` |
| Pixelate | Pixelate | static params |
| Conveyor | UV Scroll | the shader itself, via the injected `u_time` clock |

Every material here was created from the Content Browser's **New Material**
template menu — each `.esshader` next to the material is an ordinary file you can
open and edit. The two animated ones show the code-driven pattern:
`Material.setUniform(sprite.material, 'u_flash', v)` from a per-frame system.

Art: [Kenney — Platformer Art Deluxe](https://kenney.nl/assets/platformer-art-deluxe) (CC0).
