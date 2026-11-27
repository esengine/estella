---
section: Fixed
commits:
  - fix(editor-tools): wire entity fields by $ref and keep the HUD out of view_from
  - fix(editor): leave the screen HUD out of stills of the world
---
**`apply_scene_ops` wires a widget to the parts it made in the same call, and `view_from` shows the world without the HUD.**
An entity-valued field (`UIMeter.fill`, `UISlider.handle`) takes a `"$ref"` in `fields` or in a create's component data,
and a bare name names an entity unique in the scene. `view_from` and `scene_views` no longer draw the screen HUD hanging in
the world, and `view_from` draws a picture as wide as `size` asks rather than the panel's width.
