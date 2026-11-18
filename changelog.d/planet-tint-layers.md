---
section: Added
commits:
  - feat(terrain): a planet can tint its layers by its four layer colours - `tintLayers` multiplies the layers' pictures by the colour the planet gives each layer, so grey pictures of grain serve every world of a game in that world's own colours, where a planet with layers drew them in the pictures' colours alone and its layer colours did nothing
---
**A planet can tint its terrain layers by its own four layer colours.** With `tintLayers` on, each layer's picture is multiplied by the colour the planet gives that layer, so one set of grey pictures of grain (grass, soil, snow, rock) is the ground of every world in a game, each in its own colours. Off, as before, the layers are drawn in their pictures' colours and the layer colours are only what a planet with no layers is drawn in.
