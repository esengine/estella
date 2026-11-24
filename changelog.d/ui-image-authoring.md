---
section: Fixed
commits:
  - fix(editor): an image placed in the UI is a UI Image that shows, and a Sprite on a UI node says why it does not
---
**An image put in the UI shows up as a UI Image.** Every way of putting a picture in a screen sent people to a Sprite,
which is for things in the world. Create > UI > Image made a box that stayed invisible even with a texture in it, until
its Visual Type was changed by hand; it now starts as an Image (a white box until it has a texture), and giving any
UIVisual set to None a texture turns it to Image in the same undo step. An image dragged onto a Canvas or a UI node, in
the scene view or in the Outliner, is created as a UI Image under it, at the image's size, instead of a world Sprite.
A Sprite added to a UI node draws nothing, and its card in Details now says so and what to use instead.
