# DragonBones Animation

A DragonBones armature posed by the engine, drawn through the same skeletal
submission path Spine uses.

Open `assets/scenes/main.esscene` and press Play.

## What it shows

- **A `DragonBonesAnimation` component** pointing at a `_ske.json` skeleton and
  its `_tex.json` atlas. The atlas names its own image, so the PNG is never
  referenced by the scene — the cook follows the atlas to keep it.
- **Crossfading with `fadeIn`.** DragonBones blends at the moment of play rather
  than from a mix table set on the skeleton, so the fade is an argument to
  starting an animation. `src/systems/switch.ts` passes 0.25s.
- **One parsed skeleton, two figures.** Both entities reference the same pair, so
  the file is parsed once and the atlas held between them; the second is scaled
  down and flipped through component fields alone.

Press **1–4** for stand / walk / jump / fall, or leave it alone and it cycles.

## Where the pieces live

| | |
|---|---|
| `assets/dragonbones/` | DragonBoy — skeleton, atlas, and the page it names |
| `assets/scenes/main.esscene` | Camera, two armatures, and the UI labels |
| `src/systems/switch.ts` | Reads `Res(DragonBones)` and crossfades on a keypress |

## Assets

DragonBoy is the DragonBones project's own demo armature, MIT licensed. See
[`../ASSETS.md`](../ASSETS.md).
