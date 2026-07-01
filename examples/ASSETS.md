# Example art credits

All bitmap art in these examples comes from **[Kenney](https://kenney.nl)** and is
released under **Creative Commons CC0 1.0 (public domain)**. CC0 requires no attribution
and permits commercial reuse, so these examples — art included — are free to use as the
starting point for a real game. This credit is a courtesy, not an obligation.

## Packs used

| Pack | License | Used by |
| --- | --- | --- |
| [Platformer Art Deluxe](https://kenney.nl/assets/platformer-art-deluxe) | CC0 | platformer, sprite-animation (walk/idle frames), hello-world (gem), physics-playground (crate) |
| [Space Shooter Remastered](https://kenney.nl/assets/space-shooter-remastered) | CC0 | space-shooter (ships, lasers, enemies, life icon, starfield), input-demo (cursor), sprite-rendering (star) |
| [Simple Space](https://kenney.nl/assets/simple-space) | CC0 | input-demo (player ship) |
| [Particle Pack](https://kenney.nl/assets/particle-pack) | CC0 | particle-demo, space-shooter (explosion) |
| [Physics Assets](https://kenney.nl/assets/physics-assets) | CC0 | physics-playground (ball) |
| [UI Pack](https://kenney.nl/assets/ui-pack) | CC0 | sprite-rendering (arrow) |
| [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | CC0 | tilemap-demo (tileset atlas) |

## Audio

`audio-demo` uses short synthesized drum one-shots (`assets/audio/*.wav`) generated for
this repo; they are dedicated to the public domain along with the rest of the examples.

## Replacing or adding art

The pixel/vector PNGs are dropped in under each example's `assets/textures/`. To swap
art for an existing sprite, overwrite the PNG under the same filename so the scene's
UUID reference stays valid (see [ARCHITECTURE.md](./ARCHITECTURE.md#asset-references)).
