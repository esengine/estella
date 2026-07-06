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

- **The room** is a grid of tiles plus a few prop sprites, all with `lit: true`
  on their `Sprite` — the one-flag way to receive 2D lights (in the editor it is
  the **Lit** checkbox). A sprite without the flag stays unlit (full-bright) —
  that is why the light markers and obstacle boxes are always visible. When a
  surface needs more than the flag (a tint, a normal map), give it a `Lit2D`
  material instead — see the [lighting guide](../../docs/astro/src/content/docs/guides/lighting.mdx).
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
  scenes/
    main.esscene      # camera, ambient, torch, the lit tile/prop room, two pillars
src/
  main.ts             # registers the three systems
  config.ts           # shared tuning (colors, radii, caps, fade)
  components.ts       # Torch tag, Fading component
  systems/
    torch.ts          # torch follows the mouse
    place.ts          # click to place lights/obstacles, C to clear
    fade.ts           # fade-out + despawn of removed entities
```
