---
section: Changed
commits:
  - perf(xr): plan one shadow atlas for both eyes, and keep each eye's temporal history apart
---
**VR draws its shadows once a frame instead of twice, and temporal effects no longer blend the two eyes.** The eyes of a
headset are 6.4 cm apart, so shadows planned per eye gave each eye its own cascades, each eye invalidated the other's shadow
atlas, and it was redrawn twice every frame even with a still scene and a still head. Shadows are now planned once per frame
from one view covering both eyes. Both eyes read the same atlas, and a still scene keeps it from frame to frame, as a flat
screen does. Measured on 400 shadowed cubes against a stand-in headset: four shadow tiles redrawn per frame before, none
after; shadow work per frame went from 0.62 ms to 0.02 ms. Each eye now keeps its own history for temporal anti-aliasing,
motion blur and the per-camera GI caches; before, the right eye's frame was blended with the left eye's. The scene itself is
still collected and drawn once per eye.
