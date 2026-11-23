---
section: Fixed
commits:
  - fix(water): the underwater look, the surface seen from below, refraction and caustics drawn as the water is, and the light through wave crests
  - fix(editor): the water outline row lines up with the Details rows
---
**Water looks right from under it, through it and across the floor.** Under the stock water material the underwater fog took a density a
hundred times too thick (a fallback of 0.12 a world unit where the Water shader's own default is 0.0012), so a few metres of water hid
everything; it now takes the shader's default, and a body's own Underwater Density is read per metre as its default of 0.12 implies.
Seen from below, the surface past the critical angle mirrors the water's own light where the screen holds nothing to mirror, instead
of black. Refraction no longer throws single pixels of deep water over shallows: its offset follows the bent ray's length in the
water, not the eye's, and the scene's distances are read texel by texel. Caustics no longer end in a square round the camera: past
the measured window the floor takes the same procedural threads the cheapest quality draws, scaled by the material's caustic strength.
Waves seen against a low sun now let light through their crests (the Water shader's Crest Scatter, 0 for none). The underwater
effect's light shafts take as many steps as a ray needs instead of always the most, which halves its cost on a view of the floor.
In the Details panel a Water Body's settings are grouped Shape, Waves, Look, Rendering, Underwater, Terrain; a Water Zone shows its
legacy ring settings only while Tile Size is 0 and its far distance settings only when the far distance mesh is on.
