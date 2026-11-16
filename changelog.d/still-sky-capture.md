---
section: Changed
commits:
  - perf(postprocess): a still sky lights the scene from one capture - the environment of a sky defined still is drawn and read back once, and again only when its params, its brightness or a directional light change (at most once a second, as before), where it was redrawn and read back every second, 0.4 to 1.7 ms of GPU each time on the frigate's nebula at high and about 4 ms of a desktop CPU to make it an environment
---
**A still sky lights the scene from one capture.** A sky defined with `still: true` that lights the scene was drawn again, read back and made into the environment every second, though nothing in it had changed. It is now captured once, and again only when its params, its brightness or a directional light change, at most once a second as before; a sky that is not still is captured every second as it was. On the space frigate's nebula at high each capture cost 0.4 to 1.7 ms of GPU and about 4 ms of a desktop CPU, once a second, and the picture is the same.
