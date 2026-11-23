---
section: Fixed
commits:
  - fix(water): a waterfall with no other water is drawn and ships, and rain rings are their own size whatever the wind's ripples
---
**A waterfall on its own is drawn, and ships.** A scene with a Waterfall and no Water Body or Water Zone drew no fall at all: the
systems that build it belong to the water module, which stopped after the first frame where it found no body or zone, before the
stock Waterfall shader had loaded. A Waterfall now keeps them running, and an exported game whose only water is a fall (or a
Waterfall Anchor, or a material on the Waterfall shader) now ships the water module, where before it was left out. A stock shader
that fails to load now says so instead of leaving the fall undrawn in silence. Rain rings on water are a raindrop's size, in metres:
they took the size and speed of the Water shader's wind ripples (Ripple Length), so longer wind ripples made rings metres across
spreading at metres a second.
