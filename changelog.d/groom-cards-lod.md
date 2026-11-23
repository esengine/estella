---
section: Added
commits:
  - feat(groom): a groom draws its cards in place of its strands where it is small in the view
  - feat(editor): Create Hair Cards names the cards in the groom, and the Groom editor sets the screen size they take over at
---
**A groom switches to its cards by itself when it is small on screen.** A `.esgroom` can name its cards
(`cards: { mesh, material, screenSize }`), and **Create Hair Cards** writes them there. Every Groom drawing it then shows
the cards in place of the strands where the groom covers less than `screenSize` of the view's height (default 0.2), and
the strands again above that, with a margin either way so a groom standing at the line does not flicker. It is measured
against the camera the frame was drawn with, or the scene's active camera where the host publishes none. The Groom
editor shows the cards and their screen size; an export ships the cards mesh and material with the groom. The cards
material Create Hair Cards writes now has a softer highlight, which read as patches from afar.
