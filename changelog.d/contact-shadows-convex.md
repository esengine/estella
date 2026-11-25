---
section: Fixed
commits:
  - fix(postprocess): contact shadows count only what stands above a surface toward the sun
---
**Contact Shadows no longer stripe a rounded thing lit from behind, or speckle the far ground at a low sun.** A ray leaving an arm, a leg or a post thinner than the effect's thickness toward the sun went behind that thing's own near side as the picture sees it, and was counted as blocked, laying a stripe along every facet; ground seen at a grazing angle shadowed itself the same way. A blocker now has to stand above the plane the shaded point lies in, on the sun's side, so a convex surface does not shadow the side that faces the light, while a wall's foot, a crease or a thing standing on the ground still casts its contact shadow.
