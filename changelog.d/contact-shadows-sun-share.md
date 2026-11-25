---
section: Fixed
commits:
  - fix(postprocess): contact shadows take away the sun's light, not the sky's
---
**Contact Shadows no longer paint dark stains where the sky still lights a surface.** The effect darkened the whole pixel, so a point it found blocked from the sun came out darker than a point simply turned away from the sun: the inner thigh of a backlit character, between the legs, read as a brown patch. It now takes away only the sun's diffuse share of the pixel, worked out from the surface's own colour and shading normal and the sun's shadow map, so a contact shadow is as bright as the sky and ambient leave it and nothing the shadow map already darkened goes darker twice. It also always runs ahead of ambient occlusion, bounce light and reflections in a volume's list, which scale the picture it judges. Surfaces that write no colour of their own keep the old darkening.
