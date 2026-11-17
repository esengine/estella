---
section: Changed
commits:
  - perf(render): text and the quads around it draw through one batch program - a sprite, a distance-field glyph and the two halves of a glyph whose outline is baked into its page each took a program of their own, so a screen UI that alternates panels and labels started a new draw at every label; the default batch program now reads which of the four a vertex is from the bits above its texture slot, and the merge keeps those bits when it gives the vertex a slot
---
**Text and the sprites and UI quads around it now draw in the same batch.** A distance-field label, and either half of a label whose outline is baked into its font's page, used a shader program of its own, so a screen UI that alternates panels and labels started a new draw call at every label. One program now draws all of them, choosing per vertex how to read the page. On the space frigate's HUD the frame went from about 180 draw calls to about 97 on the low level, and from about 198 to 116 on high, and the picture is the same.
