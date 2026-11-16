---
section: Fixed
commits:
  - fix(export): the ident is drawn sharp at any size and follows the window - its edges ramped over eight pixels whatever the screen, so the mark and the word were soft everywhere, and its canvas was held to 1800 pixels on its long side and sized once, so a wide screen drew it at seven tenths and a turned phone stretched it; the edges now ramp over two pixels, the canvas is held to six million pixels, and it is sized again when the window changes
---
**The Estella ident is sharp.** The mark and the word were drawn with edges eight pixels soft at every resolution, and the canvas was capped at 1800 pixels on its long side and sized only once, so a wide screen showed it upscaled and a phone turned to landscape showed it stretched. The edges now take two pixels, the canvas keeps up to six million pixels, and it is resized when the window changes.
