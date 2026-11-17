---
section: Changed
commits:
  - refactor(render): TextureAtlas packs with the shelf packer and one nextPowerOf2 serves every caller - packRects kept a third packer, the single-open-row heuristic shelfPack.ts was written to retire, and four modules each wrote the next power of two
---
**`TextureAtlas.pack` fits textures into the rows already open before starting a new one.** It filled one row at a time and abandoned what was left of a row when a texture did not fit, so an atlas of mixed sizes could come out taller than it needed to be. Where each texture lands can change; how an atlas is used does not.
