---
section: Changed
commits:
  - perf(xr): cull and collect the scene once for both eyes, and draw every frame a headset asks for
---
**In VR the scene is culled and collected once a frame, and the game draws every frame the headset asks for.** The first eye
now culls and collects the scene for one view covering both eyes, and the second eye draws that same list from its own view.
Only the work that depends on the view is redone for it: camera constants, tiled lights, the passes it declares, and motion.
On 400 shadowed cubes this halved the scene collect (802 visits a frame to 401). The two eyes' pictures came out
byte-identical to collecting each eye on its own, with world text and translucent sprites in view. Separately, a headset frame
was sometimes passed over when the GPU was still busy with the previous one, or when a frame cap was set, which left the
headset with nothing new for that frame. Neither rule now applies while a headset drives the frames.
