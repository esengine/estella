# Example art credits

All bitmap art in these examples comes from **[Kenney](https://kenney.nl)** and is
released under **Creative Commons CC0 1.0 (public domain)**. CC0 requires no attribution
and permits commercial reuse, so these examples — art included — are free to use as the
starting point for a real game. This credit is a courtesy, not an obligation.

## Packs used

| Pack | License | Used by |
| --- | --- | --- |
| [Platformer Art Deluxe](https://kenney.nl/assets/platformer-art-deluxe) | CC0 | platformer, sprite-animation (walk/idle frames), hello-world (gem), effects-gallery (character + ground) |
| [Space Shooter Remastered](https://kenney.nl/assets/space-shooter-remastered) | CC0 | space-shooter (ships, lasers, enemies, life icon, starfield), input-demo (cursor), sprite-rendering (star) |
| [Simple Space](https://kenney.nl/assets/simple-space) | CC0 | input-demo (player ship) |
| [Particle Pack](https://kenney.nl/assets/particle-pack) | CC0 | particle-demo, space-shooter (explosion) |
| [UI Pack](https://kenney.nl/assets/ui-pack) | CC0 | sprite-rendering (arrow) |
| [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | CC0 | tilemap-demo (`tileset.png` terrain atlas; `props.png` is a handful of its tiles repacked into a second tileset) |

## Spine

`spine-demo` uses **Spineboy**, Esoteric Software's official Spine example skeleton
(`spineboy-pro.skel` / `spineboy.atlas` / `spineboy.png`), © Esoteric Software LLC. Unlike
the CC0 art above it is licensed under the **[Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license)**:
using the Spine runtime (and this asset) requires your own Spine Editor license, and any
redistribution must keep the copyright notice. It is **not** CC0 and not free to reuse the
way the Kenney art is.

## DragonBones

`dragonbones-demo` uses **DragonBoy** (`DragonBoy_ske.json` / `DragonBoy_tex.json` /
`DragonBoy_tex.png`), the DragonBones project's own demo armature, taken from
[DragonBonesCPP](https://github.com/DragonBones/DragonBonesCPP) (`SFML/Demos/HelloDragonBones`).
It is **MIT** licensed — © 2012-2016 DragonBones team and other contributors — so unlike
the Spine asset above it is free to reuse, provided the copyright notice travels with it.

## Audio

`audio-demo` uses short synthesized drum one-shots (`assets/audio/*.wav`) generated for
this repo; they are dedicated to the public domain along with the rest of the examples.

## 3D

`lighting-3d` carries no art either. Its `waver.gltf` (a skinned bar and a panel)
and `sky.hdr` (a gradient sky with one sun) were written by a generator for this
repo, so the example ships a whole 3D lighting scene — model, skin, clip, baked
environment — with nothing to credit and nothing to license.

## Replacing or adding art

The pixel/vector PNGs are dropped in under each example's `assets/textures/`. To swap
art for an existing sprite, overwrite the PNG under the same filename so the scene's
UUID reference stays valid (see [ARCHITECTURE.md](./ARCHITECTURE.md#asset-references)).
