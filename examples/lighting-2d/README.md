# 2D Lighting

A hands-on tour of the engine's dynamic 2D lighting: a `Light2D` **torch** that
follows your mouse through a near-dark room, `Light2D` lamps you drop with a
click, and `ShadowCaster2D` boxes that block light and cast **real-time soft
shadows**.

## Controls

| Input          | Action                                                         |
| -------------- | -------------------------------------------------------------- |
| Move mouse     | The torch follows the cursor, revealing walls and casting shadows |
| Left-click     | Drop a fixed colored light (cycles red → green → blue → warm white) |
| Right-click    | Drop a box obstacle that blocks light and casts a shadow       |
| `C`            | Clear everything you placed                                    |

Placed lights are capped at 10 and obstacles at 6; when you exceed a cap the
oldest one fades out and is removed, keeping the scene inside the GPU's 16-light
/ 8-occluder budget.

## How it works

Lighting is **multiplicative**: a lit surface renders as
`albedo × (ambient + Σ lights)`. With the ambient term set very low (~0.06), an
unlit wall is nearly black — so a light does not just brighten the room, it
*reveals* it.

- **The room** is a grid of tiles plus a few prop sprites, all using the
  `assets/materials/lit.esmaterial` material. Its shader declares
  `#pragma domain Lit2D`, which makes the engine inject the per-frame light
  uniforms and the `es_applyLighting2D()` helper the fragment shader calls. A
  sprite with no material stays unlit (full-bright) — that is why the light
  markers and obstacle boxes are always visible.
- **The torch** (`src/systems/torch.ts`) is a `Light2D` of type `Point`. Each
  frame it is moved to `UICameraInfo.worldMouseX/Y`, the cursor already
  projected into world space by the active camera.
- **Placing & clearing** (`src/systems/place.ts`) reads mouse buttons and the
  `C` key from the `Input` resource and uses `Commands` to spawn/despawn
  entities. Left-click spawns a `Light2D`, right-click spawns a `ShadowCaster2D`.
- **Fading** (`src/systems/fade.ts`) dims an evicted or cleared entity's light
  and sprite to zero over a short window, then despawns it.

Shadow softness comes from the light's `shadowSoftness` field: the torch uses a
larger value for a wide penumbra, placed lights a smaller one for crisper edges.

## Files

```
assets/
  materials/
    lit.esshader      # #pragma domain Lit2D — flat-normal lit surface
    lit.esmaterial    # material that binds the shader (no texture → color = albedo)
  scenes/
    main.esscene      # camera, ambient, torch, the tile/prop room, two pillars
src/
  main.ts             # registers the three systems
  config.ts           # shared tuning (colors, radii, caps, fade)
  components.ts       # Torch tag, Fading component
  systems/
    torch.ts          # torch follows the mouse
    place.ts          # click to place lights/obstacles, C to clear
    fade.ts           # fade-out + despawn of removed entities
```
