---
section: Added
commits:
  - perf(postprocess): a sky defined still is read from a panorama below high quality - defineSkyEffect still draws the sky into a 2048 x 1024 panorama an eighth a frame whenever its params change, as Baked Clouds does, and the sky pass looks each pixel up in it once it is whole; QualityProfile.stillSky asks for it (low and medium). A nebula of fifty noise lookups went from 2.8 ms to 0.1 ms of a 2400 x 1080 frame
  - fix(export): the model baker runs from a page opened as a file - it was started as a module worker from a blob, which a page with no origin (a single file double-clicked) refuses, so every model's maps failed to load; it is built and started as a classic script on the web and in a playable
---
**A shader sky can stand still.** `defineSkyEffect({ still: true, ... })` marks a sky that only changes when its params do: below high quality it is drawn once into a panorama, a strip a frame, and every pixel of the sky is then a texture lookup instead of the author's noise (`QualityProfile.stillSky`, on for low and medium). The space frigate's nebula went from 2.8 ms to 0.1 ms of a phone-sized frame. Separately, a single-file playable opened by double-clicking it now bakes its models: the baker is started as a classic worker, which a page with no origin allows.
