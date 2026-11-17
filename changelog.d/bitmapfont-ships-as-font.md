---
note: `Assets.preload` and `loadGroup` load every shipped asset through its own loader.
commits:
  - fix(assets): a bitmap font ships as a font under the .meta type it is minted with now, and a terrain's tiles as json - the loader table reads bitmapfont where it read bitmapFont, and names terrain-tiles, which .esterrain is minted as
---
