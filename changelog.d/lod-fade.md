---
section: Added
commits:
  - feat(render): an LODMember group dissolves one level into the next over a third of a second, per view, and lodInspect reports the fade
  - fix(editor): the groom check watches the cards dissolve into the strands when the camera comes near
---
**Levels of detail fade into each other instead of popping.** When a view changes an `LODMember` group's level (a groom
going from its cards to its strands as the camera comes near), both levels are drawn for 0.35 s, the one leaving
fading out and the one arriving fading in, on a monotonic clock so a fade finishes in a paused editor view too. The fade
reaches the material as its instance alpha: a material whose alpha is coverage dissolves with it (strands thin out, cards
cut away from their thinnest strands first), and an opaque one switches as before. `Renderer.lodInspect` reports the
level being left (`fadingFrom`) and how far the new one has come (`fade`).
